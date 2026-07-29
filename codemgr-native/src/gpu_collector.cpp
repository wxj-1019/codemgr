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
#include <unordered_set>
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
// 纯函数：从 GPU Engine 实例名解析 luid 段（适配器标识）。
// 实例名形如 pid_1234_luid_0x00000000_0x00004501_phys_0_eng_2_engtype_3D
// 提取 "0x00000000_0x00004501" 部分（luid Low_High）。找不到返空串。
// 用于多适配器分组聚合：同 luid 的引擎属于同一 GPU。
// ---------------------------------------------------------------------------
static std::wstring ParseGpuEngineLuid(const std::wstring& instance) {
  const std::wstring marker = L"luid_";
  size_t pos = instance.find(marker);
  if (pos == std::wstring::npos) return L"";
  size_t start = pos + marker.size();
  // luid 段格式：0xHHHHHHHH_0xHHHH（两个 hex 段，中间一个 _）
  // 宽松取到下一个非 hex/下划线字符为止
  size_t end = start;
  int underscoreSeen = 0;
  while (end < instance.size()) {
    wchar_t c = instance[end];
    if ((c >= L'0' && c <= L'9') || (c >= L'a' && c <= L'f') ||
        (c >= L'A' && c <= L'F') || c == L'x' || c == L'X') {
      ++end;
    } else if (c == L'_' && underscoreSeen == 0) {
      ++end; ++underscoreSeen;  // luid 内部的 Low_High 分隔符
    } else {
      break;  // phys_ 等后续段的下划线，停止
    }
  }
  return (end > start) ? instance.substr(start, end - start) : L"";
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

// 对展开后的实例路径做 per-pid 去重：同一 pid 只保留首个引擎实例。
// 一个进程有多个引擎（3D/Copy/Video/Compute），全加会导致数百计数器拖慢
// PdhCollectQueryData（实测 329 个 → ~30ms）。per-pid 取首个实例足以反映"该进程
// 是否在用 GPU"（spec §1.2 不追求多引擎精确累加）。无 pid_ 前缀的实例（系统级）保留。
static std::vector<std::wstring> DedupByPid(const std::vector<std::wstring>& paths) {
  std::vector<std::wstring> out;
  std::unordered_set<DWORD> seenPids;
  for (const auto& p : paths) {
    DWORD pid = ParseGpuEnginePid(p);
    if (pid == 0) {
      out.push_back(p);  // 系统/未知实例，保留
    } else if (seenPids.insert(pid).second) {
      out.push_back(p);  // 该 pid 首次出现，保留
    }
    // 同 pid 的后续引擎实例跳过（降计数器数量）
  }
  return out;
}

static void InitGpuPdh() {
  if (g_gpuPdh.initialized) return;
  g_gpuPdh.initialized = true;  // 标记已尝试（即使失败也不重试 init，仅周期重展开）

  if (PdhOpenQueryW(nullptr, 0, &g_gpuPdh.query) != ERROR_SUCCESS) {
    g_gpuPdh.query = nullptr;
    return;
  }
  // per-pid 去重：329 个引擎实例 → ~50 个唯一 pid，大幅降低 PdhCollectQueryData 开销
  g_gpuPdh.utilPaths = DedupByPid(ExpandGpuCounterPaths(L"Utilization Percentage"));
  g_gpuPdh.dedicatedPaths = DedupByPid(ExpandGpuCounterPaths(L"Dedicated Usage"));
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
  g_gpuPdh.utilPaths = DedupByPid(ExpandGpuCounterPaths(L"Utilization Percentage"));
  g_gpuPdh.dedicatedPaths = DedupByPid(ExpandGpuCounterPaths(L"Dedicated Usage"));
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
// DXGI 显存：枚举所有硬件适配器（缓存），各取 name + luid + vram。
// 过滤虚拟显示适配器（Microsoft Basic Render + 无 VRAM 的 Idd 类驱动）。
// ---------------------------------------------------------------------------
struct DxgiAdapterInfo {
  IDXGIAdapter3* adapter;       // 缓存引用（进程生命周期持有，不释放）
  std::wstring name;            // Description
  std::wstring luidKey;         // "0x00000000_0x00004501"（关联 PDH 实例名 luid 段）
};
static std::vector<DxgiAdapterInfo> g_dxgiAdapters;
static bool g_dxgiEnumerated = false;

// LUID → "0x{Low:08x}_0x{High:04x}"（与 PDH 实例名 luid_ 段格式对齐）
static std::wstring LuidToKey(LUID luid) {
  wchar_t buf[32];
  swprintf(buf, 32, L"0x%08x_0x%04x", luid.LowPart, (unsigned)luid.HighPart);
  return buf;
}

static void EnumerateDxgiAdapters() {
  if (g_dxgiEnumerated) return;
  g_dxgiEnumerated = true;
  IDXGIFactory4* factory = nullptr;
  if (FAILED(CreateDXGIFactory1(IID_PPV_ARGS(&factory))) || !factory) return;
  IDXGIAdapter1* adapter1 = nullptr;
  for (UINT i = 0; factory->EnumAdapters1(i, &adapter1) != DXGI_ERROR_NOT_FOUND; ++i) {
    DXGI_ADAPTER_DESC1 desc{};
    adapter1->GetDesc1(&desc);
    // 跳过 Microsoft Basic Render（VendorId 0x1414）。
    if (desc.VendorId == 0x1414) {
      adapter1->Release();
      continue;
    }
    IDXGIAdapter3* adapter3 = nullptr;
    if (SUCCEEDED(adapter1->QueryInterface(IID_PPV_ARGS(&adapter3))) && adapter3) {
      std::wstring luidKey = LuidToKey(desc.AdapterLuid);
      // 按 name 去重：核显可能为每个输出/复制源枚举出多个不同 LUID 的副本
      // （Intel UHD Graphics 出现 3 次），按 Description 去重保留首个。
      bool dup = false;
      for (const auto& existing : g_dxgiAdapters) {
        if (existing.name == desc.Description) { dup = true; break; }
      }
      if (dup) {
        adapter3->Release();
      } else {
        DxgiAdapterInfo info;
        info.adapter = adapter3;  // 缓存引用，不释放
        info.name = desc.Description;
        info.luidKey = luidKey;
        g_dxgiAdapters.push_back(info);
      }
    }
    adapter1->Release();
  }
  factory->Release();
}

// 模块加载时预热 PDH（ExpandWildCardPath + AddEnglishCounter ×N 冷启动）。
// DXGI 枚举不放静态初始化器（CreateDXGIFactory1 在 DLL 加载时可能失败），
// 改在首次 CollectGpu 时懒初始化。
static bool g_gpuPreheated = ([]() { InitGpuPdh(); return g_gpuPdh.initialized; })();

// ---------------------------------------------------------------------------
// 采集入口：聚合 PDH + DXGI，写入 raw
// ---------------------------------------------------------------------------
// GPU 采集降频：perfCounters 是 1s 节奏，但 PdhCollectQueryData 对数百个引擎实例
// 约 12-36ms。GPU%/VRAM 变化慢，3s 足够。每 GPU_SAMPLE_INTERVAL 次 perfCounters
// 才真正采集 GPU，其间复用上次结果。
static constexpr int GPU_SAMPLE_INTERVAL = 3;  // 每 3 次 perfCounters 采集一次（≈3s）
static int g_gpuSkipCount = 0;
static GpuRaw g_lastGpu = {};  // 上次采集结果缓存

void CollectGpu(GpuRaw& raw) {
  InitGpuPdh();  // 幂等：已初始化则立即返回（预热后此处为 no-op）
  EnumerateDxgiAdapters();  // DXGI 懒初始化（首次 CollectGpu 时枚举适配器）
  // 无 GPU 计数器 → 降级
  if (!g_gpuPdh.query || g_gpuPdh.utilCounters.empty()) {
    raw.available = false;
    g_lastGpu.available = false;
    return;
  }

  // 降频：未到采集周期且已有缓存 → 复用上次结果（首次无缓存时仍采集建立基线）
  if (g_gpuSkipCount > 0 && g_lastGpu.available) {
    raw = g_lastGpu;
    g_gpuSkipCount = (g_gpuSkipCount + 1) % GPU_SAMPLE_INTERVAL;
    return;
  }
  g_gpuSkipCount = 1;  // 本次采集了，下次开始计数

  MaybeRefreshGpuPdh();

  // 采样：PdhCollectQueryData 后逐计数器取值
  if (PdhCollectQueryData(g_gpuPdh.query) != ERROR_SUCCESS) {
    raw.available = false;
    return;
  }
  raw.available = true;

  // 聚合：按 luid（适配器）分组，每组内按 pid 聚合。
  // luid → (pid → {gpuPercent, vramBytes})
  struct AdapterAgg {
    double totalUtilSum = 0;
    unsigned long long dedicatedSum = 0;
    std::unordered_map<DWORD, std::pair<double, unsigned long long>> byPid;
  };
  std::unordered_map<std::wstring, AdapterAgg> byLuid;

  for (size_t i = 0; i < g_gpuPdh.utilCounters.size() && i < g_gpuPdh.utilPaths.size(); ++i) {
    PDH_FMT_COUNTERVALUE val{};
    if (PdhGetFormattedCounterValue(g_gpuPdh.utilCounters[i], PDH_FMT_DOUBLE, nullptr, &val) == ERROR_SUCCESS) {
      double util = val.doubleValue;
      std::wstring luid = ParseGpuEngineLuid(g_gpuPdh.utilPaths[i]);
      auto& agg = byLuid[luid];
      agg.totalUtilSum += util;
      DWORD pid = ParseGpuEnginePid(g_gpuPdh.utilPaths[i]);
      if (pid > 0) agg.byPid[pid].first += util;
    }
  }
  for (size_t i = 0; i < g_gpuPdh.dedicatedCounters.size() && i < g_gpuPdh.dedicatedPaths.size(); ++i) {
    PDH_FMT_COUNTERVALUE val{};
    if (PdhGetFormattedCounterValue(g_gpuPdh.dedicatedCounters[i], PDH_FMT_LARGE, nullptr, &val) == ERROR_SUCCESS) {
      unsigned long long bytes = (unsigned long long)val.largeValue;
      std::wstring luid = ParseGpuEngineLuid(g_gpuPdh.dedicatedPaths[i]);
      auto& agg = byLuid[luid];
      agg.dedicatedSum += bytes;
      DWORD pid = ParseGpuEnginePid(g_gpuPdh.dedicatedPaths[i]);
      if (pid > 0) agg.byPid[pid].second += bytes;
    }
  }

  // 构建 adapters 数组：DXGI 适配器（有 name/vram）+ PDH 聚合（有 utilization/perpid）
  // 按 DXGI 枚举顺序（硬件适配器在前），用 luidKey 关联 PDH 聚合
  raw.adapters.clear();
  raw.totalPercent = 0;
  raw.vramUsedBytes = 0;
  raw.vramBudgetBytes = 0;
  raw.perProcess.clear();

  for (const auto& dxgi : g_dxgiAdapters) {
    GpuRaw::AdapterRaw a;
    a.name = dxgi.name;
    // DXGI 显存（每适配器）
    DXGI_QUERY_VIDEO_MEMORY_INFO info{};
    if (SUCCEEDED(dxgi.adapter->QueryVideoMemoryInfo(0, DXGI_MEMORY_SEGMENT_GROUP_LOCAL, &info))) {
      a.vramUsedBytes = info.CurrentUsage;
      a.vramBudgetBytes = info.Budget;
    }
    // PDH 聚合（按 luid 匹配）
    auto it = byLuid.find(dxgi.luidKey);
    if (it != byLuid.end()) {
      a.totalPercent = it->second.totalUtilSum > 100.0 ? 100.0 : it->second.totalUtilSum;
      for (const auto& [pid, v] : it->second.byPid) {
        a.perProcess.push_back({pid, v.first, v.second});
      }
    }
    raw.adapters.push_back(std::move(a));

    // 累加到顶层总计
    raw.totalPercent += a.totalPercent;
    raw.vramUsedBytes += a.vramUsedBytes;
    raw.vramBudgetBytes += a.vramBudgetBytes;
    for (const auto& p : a.perProcess) raw.perProcess.push_back(p);
  }
  // 顶层总 GPU% clamp 100
  raw.totalPercent = raw.totalPercent > 100.0 ? 100.0 : raw.totalPercent;

  // 缓存本次结果供降频复用
  g_lastGpu = raw;
}

}  // namespace gpu_collector
