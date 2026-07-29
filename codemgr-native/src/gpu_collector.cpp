// GPU/显存采集（v2.1，spec D5）。
//
// 关键设计（见 spec §1.2 "与现有 disk PDH 的关键差异"）：
//   - 用 PdhAddEnglishCounterW（非 disk 的 PdhAddCounterW）—— GPU 计数器名免本地化
//   - DXGI <dxgi1_6.h> 取显存总量（dxgi.lib，CMakeLists WIN_LIBS 需加）
//   - 实例名宽松解析：只认 pid_ 前缀，其余段不假设格式（R1 对策）

#include "gpu_collector.h"

#include <pdh.h>
#include <pdhmsg.h>
#include <dxgi1_6.h>
#pragma comment(lib, "dxgi.lib")

#include <string>
#include <unordered_map>
#include <vector>

namespace gpu_collector {

// ---------------------------------------------------------------------------
// 纯函数：从 GPU Engine 实例名解析 pid（宽松，只认 pid_ 前缀）
// 实例名形如 pid_1234_luid_0x00000000_0x00004501_phys_0_eng_2_engtype_3D
// 失败（无 pid_ 前缀或非数字）返回 0 = 未知进程（归入聚合但不分进程）。
// ---------------------------------------------------------------------------
static DWORD ParseGpuEnginePid(const std::wstring& instance) {
  const std::wstring marker = L"pid_";
  size_t pos = instance.find(marker);
  if (pos == std::wstring::npos) return 0;
  size_t start = pos + marker.size();
  DWORD pid = 0;
  size_t i = start;
  for (; i < instance.size() && instance[i] >= L'0' && instance[i] <= L'9'; ++i) {
    pid = pid * 10 + (instance[i] - L'0');
  }
  // 必须至少消费一个数字，且后面是 _ 或字符串尾
  return (i > start) ? pid : 0;
}

// ---------------------------------------------------------------------------
// PDH 状态（照 disk PDH 模式：静态、进程生命周期持有、周期重展开）
// ---------------------------------------------------------------------------
struct GpuPdhState {
  PDH_HQUERY query = nullptr;
  // 展开后的实例路径列表（Utilization + Dedicated 各一份，同序）
  std::vector<std::wstring> utilPaths;
  std::vector<std::wstring> dedicatedPaths;
  std::vector<PDH_HCOUNTER> utilCounters;
  std::vector<PDH_HCOUNTER> dedicatedCounters;
  bool initialized = false;       // 是否已尝试 init（避免反复失败重试）
  int samplesSinceExpand = 0;     // 距上次展开的采样数（每 5 次重展开）
};
static GpuPdhState g_gpuPdh;

// 展开 \GPU Engine(*)\... 通配符路径为具体实例路径列表。
// 用 PdhExpandWildCardPathW（展开已注册实例名，实例名本身不含本地化文本）。
static std::vector<std::wstring> ExpandGpuCounterPaths(LPCWSTR counterName) {
  std::wstring pattern = std::wstring(L"\\GPU Engine(*)\\") + counterName;
  // 先查所需长度
  DWORD bufLen = 0;
  PDH_STATUS s = PdhExpandWildCardPathW(nullptr, pattern.c_str(), nullptr, &bufLen, 0);
  if (s != PDH_MORE_DATA || bufLen == 0) return {};
  std::vector<wchar_t> buf(bufLen);
  s = PdhExpandWildCardPathW(nullptr, pattern.c_str(), buf.data(), &bufLen, 0);
  if (s != ERROR_SUCCESS) return {};
  // 解析双 null 终止的路径列表
  std::vector<std::wstring> paths;
  size_t i = 0;
  while (i < buf.size()) {
    std::wstring p(&buf[i]);
    if (p.empty()) break;
    paths.push_back(p);
    i += p.size() + 1;
  }
  return paths;
}

static void InitGpuPdh() {
  if (g_gpuPdh.initialized) return;
  g_gpuPdh.initialized = true;  // 标记已尝试（即使失败也不重试 init，仅周期重展开）

  if (PdhOpenQueryW(nullptr, 0, &g_gpuPdh.query) != ERROR_SUCCESS) {
    g_gpuPdh.query = nullptr;
    return;
  }
  g_gpuPdh.utilPaths = ExpandGpuCounterPaths(L"Utilization Percentage");
  g_gpuPdh.dedicatedPaths = ExpandGpuCounterPaths(L"Dedicated Usage");
  if (g_gpuPdh.utilPaths.empty()) return;  // 无 GPU 计数器（虚拟机等）

  // 逐个用 English API 加计数器（实例名路径非本地化，English API 稳定）
  for (const auto& path : g_gpuPdh.utilPaths) {
    PDH_HCOUNTER h = nullptr;
    if (PdhAddEnglishCounterW(g_gpuPdh.query, path.c_str(), 0, &h) == ERROR_SUCCESS) {
      g_gpuPdh.utilCounters.push_back(h);
    }
  }
  for (const auto& path : g_gpuPdh.dedicatedPaths) {
    PDH_HCOUNTER h = nullptr;
    if (PdhAddEnglishCounterW(g_gpuPdh.query, path.c_str(), 0, &h) == ERROR_SUCCESS) {
      g_gpuPdh.dedicatedCounters.push_back(h);
    }
  }
  g_gpuPdh.samplesSinceExpand = 0;
}

// 每 5 个采样周期重展开（进程进出致实例集变化）。重建计数器列表。
static void MaybeRefreshGpuPdh() {
  if (++g_gpuPdh.samplesSinceExpand < 5) return;
  g_gpuPdh.samplesSinceExpand = 0;
  if (!g_gpuPdh.query) return;
  // 清旧计数器（PdhRemoveCounter），重新展开+添加
  for (auto h : g_gpuPdh.utilCounters) PdhRemoveCounter(h);
  for (auto h : g_gpuPdh.dedicatedCounters) PdhRemoveCounter(h);
  g_gpuPdh.utilCounters.clear();
  g_gpuPdh.dedicatedCounters.clear();
  g_gpuPdh.utilPaths = ExpandGpuCounterPaths(L"Utilization Percentage");
  g_gpuPdh.dedicatedPaths = ExpandGpuCounterPaths(L"Dedicated Usage");
  for (const auto& path : g_gpuPdh.utilPaths) {
    PDH_HCOUNTER h = nullptr;
    if (PdhAddEnglishCounterW(g_gpuPdh.query, path.c_str(), 0, &h) == ERROR_SUCCESS) {
      g_gpuPdh.utilCounters.push_back(h);
    }
  }
  for (const auto& path : g_gpuPdh.dedicatedPaths) {
    PDH_HCOUNTER h = nullptr;
    if (PdhAddEnglishCounterW(g_gpuPdh.query, path.c_str(), 0, &h) == ERROR_SUCCESS) {
      g_gpuPdh.dedicatedCounters.push_back(h);
    }
  }
}

// ---------------------------------------------------------------------------
// DXGI 显存总量/用量（第一块硬件适配器 Local 段）
// ---------------------------------------------------------------------------
static bool CollectVramViaDxgi(unsigned long long& used, unsigned long long& budget) {
  used = 0; budget = 0;
  IDXGIFactory4* factory = nullptr;
  if (FAILED(CreateDXGIFactory1(IID_PPV_ARGS(&factory))) || !factory) return false;
  IDXGIAdapter1* adapter1 = nullptr;
  bool ok = false;
  for (UINT i = 0; factory->EnumAdapters1(i, &adapter1) != DXGI_ERROR_NOT_FOUND; ++i) {
    IDXGIAdapter3* adapter3 = nullptr;
    if (SUCCEEDED(adapter1->QueryInterface(IID_PPV_ARGS(&adapter3))) && adapter3) {
      DXGI_QUERY_VIDEO_MEMORY_INFO info{};
      if (SUCCEEDED(adapter3->QueryVideoMemoryInfo(0, DXGI_MEMORY_SEGMENT_GROUP_LOCAL, &info))) {
        // 取第一块有 Budget 的硬件适配器（跳过软件适配器 Microsoft Basic Render）
        DXGI_ADAPTER_DESC1 desc{};
        adapter1->GetDesc1(&desc);
        if (info.Budget > 0 && desc.VendorId != 0x1414 /* MS Basic Render */) {
          used = info.CurrentUsage;
          budget = info.Budget;
          ok = true;
          adapter3->Release();
          adapter1->Release();
          break;
        }
      }
      adapter3->Release();
    }
    adapter1->Release();
  }
  factory->Release();
  return ok;
}

// ---------------------------------------------------------------------------
// 采集入口：聚合 PDH + DXGI，写入 raw
// ---------------------------------------------------------------------------
void CollectGpu(GpuRaw& raw) {
  InitGpuPdh();
  // 无 GPU 计数器 → 降级
  if (!g_gpuPdh.query || g_gpuPdh.utilCounters.empty()) {
    raw.available = false;
    return;
  }
  MaybeRefreshGpuPdh();

  // 采样：PdhCollectQueryData 后逐计数器取值
  if (PdhCollectQueryData(g_gpuPdh.query) != ERROR_SUCCESS) {
    raw.available = false;
    return;
  }
  raw.available = true;

  // 聚合 per-pid：pid → {gpuPercent 累加, vramBytes 累加}
  std::unordered_map<DWORD, std::pair<double, unsigned long long>> byPid;
  double totalUtilSum = 0.0;
  unsigned long long dedicatedSum = 0;

  for (size_t i = 0; i < g_gpuPdh.utilCounters.size() && i < g_gpuPdh.utilPaths.size(); ++i) {
    PDH_FMT_COUNTERVALUE val{};
    if (PdhGetFormattedCounterValue(g_gpuPdh.utilCounters[i], PDH_FMT_DOUBLE, nullptr, &val) == ERROR_SUCCESS) {
      double util = val.doubleValue;
      totalUtilSum += util;
      DWORD pid = ParseGpuEnginePid(g_gpuPdh.utilPaths[i]);
      if (pid > 0) byPid[pid].first += util;
    }
  }
  for (size_t i = 0; i < g_gpuPdh.dedicatedCounters.size() && i < g_gpuPdh.dedicatedPaths.size(); ++i) {
    PDH_FMT_COUNTERVALUE val{};
    if (PdhGetFormattedCounterValue(g_gpuPdh.dedicatedCounters[i], PDH_FMT_LARGE, nullptr, &val) == ERROR_SUCCESS) {
      unsigned long long bytes = (unsigned long long)val.largeValue;
      dedicatedSum += bytes;
      DWORD pid = ParseGpuEnginePid(g_gpuPdh.dedicatedPaths[i]);
      if (pid > 0) byPid[pid].second += bytes;
    }
  }

  // 总 GPU%：所有引擎 utilization 之和 clamp 100（任务管理器近似口径，spec 不追求精确）
  raw.totalPercent = totalUtilSum > 100.0 ? 100.0 : totalUtilSum;

  // 显存总量：优先 DXGI；失败 fallback per-process dedicated 求和（budget=0 = 未知）
  unsigned long long dxgiUsed = 0, dxgiBudget = 0;
  if (CollectVramViaDxgi(dxgiUsed, dxgiBudget)) {
    raw.vramUsedBytes = dxgiUsed;
    raw.vramBudgetBytes = dxgiBudget;
  } else {
    raw.vramUsedBytes = dedicatedSum;
    raw.vramBudgetBytes = 0;  // 未知
  }

  // perProcess 数组
  raw.perProcess.clear();
  raw.perProcess.reserve(byPid.size());
  for (const auto& [pid, v] : byPid) {
    raw.perProcess.push_back({pid, v.first, v.second});
  }
}

}  // namespace gpu_collector
