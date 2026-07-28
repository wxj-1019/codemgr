// perfCounters() —— 系统级 CPU / 内存 / 磁盘 / 网络 指标采集
//
// 实现要点：
//   - 内存：GlobalMemoryStatusEx（一次调用即可，无需快照）
//   - CPU 总占用：GetSystemTimes（双快照差分，kernel 包含 idle）
//   - CPU 每核：NtQuerySystemInformation(SystemProcessorPerformanceInformation = 8)
//               动态加载 ntdll，本地定义结构，按返回长度推导 entry stride，
//               规避 x64 上 entry 大小（40 vs 48）的文档不一致问题。
//   - 磁盘：GetLogicalDriveStringsA 枚举，GetDiskFreeSpaceExA 取容量；
//           读/写速率与 activePercent 通过 PDH \LogicalDisk(...)\* 计数器
//           采集（PDH 内部维护差分时间窗，直接给出 per-sec 速率）。
//   - 网络：GetIfTable2 → MIB_IF_ROW2，按 InterfaceIndex 维护双快照，
//           InOctets/OutOctets 差分 ÷ dt 得到 bytes/sec。
//
// 所有“速率”类字段首次调用返回 0 并建立基线，后续调用才有意义。

// 必须在 <windows.h> 之前引入 winsock2：与 net_collector.cpp 同理，
// 否则 <iphlpapi.h> 会拉入旧版 <winsock.h> 与 ws2tcpip 冲突。
#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <ws2tcpip.h>
#include <iphlpapi.h>

#include "perf_collector.h"
#include <windows.h>
#include <pdh.h>
#include <pdhmsg.h>

#include <chrono>
#include <string>
#include <tuple>
#include <unordered_map>
#include <vector>

// ---------------------------------------------------------------------------
// 本地 NT 声明（不引入 <winternl.h>，避免与本项目其它类型冲突，保持与
// process_collector.cpp 一致的防御风格）
// ---------------------------------------------------------------------------
#ifndef _NTSTATUS_DEFINED
typedef LONG NTSTATUS;
#define _NTSTATUS_DEFINED
#endif

#ifndef STATUS_INFO_LENGTH_MISMATCH
#define STATUS_INFO_LENGTH_MISMATCH ((NTSTATUS)0xC0000004L)
#endif

extern "C" {
typedef NTSTATUS(NTAPI* pNtQuerySystemInformation)(
    ULONG SystemInformationClass,
    PVOID SystemInformation,
    ULONG SystemInformationLength,
    PULONG ReturnLength);
}

// SystemProcessorPerformanceInformation（class = 8）
static constexpr ULONG SystemProcessorPerformanceInformationClass = 8;

// ---------------------------------------------------------------------------
// 全局双快照状态
//   - 注意：NAPI_DISABLE_CPP_EXCEPTIONS 下不要在采集函数里抛异常；
//     所有失败都回退为“返回 0 + 不更新基线”。
// ---------------------------------------------------------------------------

// CPU 总占用（GetSystemTimes，100ns 单位）
struct CpuTotalState {
  bool valid;
  ULONGLONG idle;
  ULONGLONG kernel;
  ULONGLONG user;
};
static CpuTotalState g_cpuTotal = { false, 0, 0, 0 };

// CPU 每核（按返回长度推导 stride，存储每核 idle/kernel/user，100ns 单位）
struct CpuPerCoreState {
  bool valid;
  size_t count;
  std::vector<ULONGLONG> idle;
  std::vector<ULONGLONG> kernel;
  std::vector<ULONGLONG> user;
};
static CpuPerCoreState g_cpuPerCore = { false, 0, {}, {}, {} };

// 网络每接口（InterfaceIndex → (inOctets, outOctets, steady_ns)）
struct NetSample {
  unsigned long long inOctets;
  unsigned long long outOctets;
  long long steadyNs;
};
static std::unordered_map<DWORD, NetSample> g_netLast;
static bool g_netValid = false;

// 磁盘 IO 速率（PDH \LogicalDisk(C:)\* 计数器）
//   - PDH 内部维护采样时间窗，单次 PdhGetFormattedCounterValue 即给出
//     当前 per-sec 速率，不需要像 CPU/网络那样自己做差分。
//   - 一个 query 持有每个盘 3 个计数器（read/write bytes/sec + % Disk Time）。
//   - query/counter 随进程生命周期存在，不做 per-call 关闭。
struct DiskPdhState {
  PDH_HQUERY query = nullptr;
  // (盘符, hRead, hWrite, hActive)
  std::vector<std::tuple<std::string, PDH_HCOUNTER, PDH_HCOUNTER, PDH_HCOUNTER>> counters;
  bool initialized = false;
};
static DiskPdhState g_diskPdh;

// ASCII 盘符（如 "C"）→ 宽字符计数器路径前缀 "\LogicalDisk(C:)\"
static std::wstring BuildLogicalDiskBasePath(const std::string& letter) {
  // letter 为单字节 ASCII，可直接扩展到 wchar_t
  return L"\\LogicalDisk(" + std::wstring(letter.begin(), letter.end()) + L":)\\";
}

static void InitDiskPdh() {
  if (g_diskPdh.initialized) return;
  if (PdhOpenQueryW(nullptr, 0, &g_diskPdh.query) != ERROR_SUCCESS) {
    g_diskPdh.query = nullptr;
    g_diskPdh.initialized = true;  // 避免反复尝试失败
    return;
  }

  // 枚举逻辑驱动器，为每个盘添加 3 个计数器
  char drives[512];
  DWORD len = GetLogicalDriveStringsA(sizeof(drives), drives);
  if (len == 0 || len >= sizeof(drives)) {
    g_diskPdh.initialized = true;
    return;
  }
  for (const char* p = drives; *p != '\0'; p += strlen(p) + 1) {
    std::string letter(1, p[0]);
    std::wstring basePath = BuildLogicalDiskBasePath(letter);
    PDH_HCOUNTER hRead = nullptr, hWrite = nullptr, hActive = nullptr;
    if (PdhAddCounterW(g_diskPdh.query,
            (basePath + L"Disk Read Bytes/sec").c_str(), 0, &hRead) == ERROR_SUCCESS &&
        PdhAddCounterW(g_diskPdh.query,
            (basePath + L"Disk Write Bytes/sec").c_str(), 0, &hWrite) == ERROR_SUCCESS &&
        PdhAddCounterW(g_diskPdh.query,
            (basePath + L"% Disk Time").c_str(), 0, &hActive) == ERROR_SUCCESS) {
      g_diskPdh.counters.push_back({letter, hRead, hWrite, hActive});
    }
    // 某些盘（网络/无介质可移动盘）添加失败是正常的，跳过即可
  }

  // 首次采集建立基线，否则首次取格式化值会返回 PDH_CALC_NEGATIVE_DENOMINATOR
  PdhCollectQueryData(g_diskPdh.query);
  g_diskPdh.initialized = true;
}

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

// 当前 epoch 毫秒（1601 FILETIME → Unix ms）
static inline long long NowEpochMs() {
  FILETIME ft;
  GetSystemTimeAsFileTime(&ft);
  ULONGLONG v = ((ULONGLONG)ft.dwHighDateTime << 32) | ft.dwLowDateTime;
  return (long long)((v - 116444736000000000ULL) / 10000ULL);
}

// steady_clock 纳秒，用于差分计时
static inline long long NowSteadyNs() {
  auto tp = std::chrono::steady_clock::now();
  return std::chrono::duration_cast<std::chrono::nanoseconds>(
             tp.time_since_epoch()).count();
}

// FILETIME（4+4 字节）→ 100ns 计数
static inline ULONGLONG FileTimeTo100ns(const FILETIME& ft) {
  return ((ULONGLONG)ft.dwHighDateTime << 32) | ft.dwLowDateTime;
}

// 宽字符 → UTF-8（截断到首个 \0）
static std::string WcharsToUtf8(const WCHAR* ws, size_t maxChars) {
  if (ws == nullptr) return std::string();
  size_t n = 0;
  while (n < maxChars && ws[n] != L'\0') ++n;
  if (n == 0) return std::string();
  int len = WideCharToMultiByte(CP_UTF8, 0, ws, (int)n,
                                nullptr, 0, nullptr, nullptr);
  if (len <= 0) return std::string();
  std::string out((size_t)len, '\0');
  WideCharToMultiByte(CP_UTF8, 0, ws, (int)n, &out[0], len, nullptr, nullptr);
  return out;
}

// ---------------------------------------------------------------------------
// 内存
// ---------------------------------------------------------------------------
static void CollectMemory(PerfDataRaw& out) {
  MEMORYSTATUSEX mem{};
  mem.dwLength = sizeof(mem);
  if (!GlobalMemoryStatusEx(&mem)) return;
  out.memTotalBytes = mem.ullTotalPhys;
  out.memAvailableBytes = mem.ullAvailPhys;
  out.memUsedPercent = (double)mem.dwMemoryLoad;  // 已是 0-100
}

// ---------------------------------------------------------------------------
// CPU 总占用 —— GetSystemTimes
// KernelTime 包含 IdleTime，故 busy = (deltaKernel - deltaIdle) + deltaUser
// total = deltaKernel + deltaUser
// ---------------------------------------------------------------------------
static void CollectCpuTotal(PerfDataRaw& out) {
  FILETIME ftIdle, ftKernel, ftUser;
  if (!GetSystemTimes(&ftIdle, &ftKernel, &ftUser)) return;

  ULONGLONG idle = FileTimeTo100ns(ftIdle);
  ULONGLONG kernel = FileTimeTo100ns(ftKernel);
  ULONGLONG user = FileTimeTo100ns(ftUser);

  if (g_cpuTotal.valid) {
    ULONGLONG dK = kernel - g_cpuTotal.kernel;
    ULONGLONG dU = user - g_cpuTotal.user;
    ULONGLONG dI = idle - g_cpuTotal.idle;
    // 防御：计数器非单调递减（理论上不会，但跨核汇总偶尔会因 SMT/调度抖动）
    ULONGLONG total = (dK + dU);
    if (total > 0) {
      double busy = (double)((dK - dI) + dU);  // kernel 已含 idle，减回
      double pct = busy / (double)total * 100.0;
      if (pct < 0) pct = 0;
      if (pct > 100) pct = 100;
      out.cpuTotalPercent = pct;
    }
  }
  g_cpuTotal = { true, idle, kernel, user };
}

// ---------------------------------------------------------------------------
// CPU 每核 —— NtQuerySystemInformation(class 8)
// 返回缓冲区为连续 N 个条目，按 returnLength/numCpus 推导 stride，
// 读取偏移 0=IdleTime / 8=KernelTime / 16=UserTime（每个 LARGE_INTEGER）。
// ---------------------------------------------------------------------------
static void CollectCpuPerCore(PerfDataRaw& out) {
  HMODULE ntdll = GetModuleHandleW(L"ntdll.dll");
  if (!ntdll) return;
  auto NtQuerySystemInformation = reinterpret_cast<pNtQuerySystemInformation>(
      GetProcAddress(ntdll, "NtQuerySystemInformation"));
  if (!NtQuerySystemInformation) return;

  SYSTEM_INFO si{};
  GetSystemInfo(&si);
  DWORD numCpus = si.dwNumberOfProcessors;
  if (numCpus == 0) return;

  // SystemProcessorPerformanceInformation（class 8）对缓冲区大小较挑剔：
  // 偏大也可能返回 STATUS_INFO_LENGTH_MISMATCH。策略：先按每核 48 字节申请，
  // 若返回 LENGTH_MISMATCH，则用内核报告的 returnLength 精确重试一次。
  ULONG bufSize = numCpus * 48;
  std::vector<unsigned char> buffer(bufSize);
  ULONG returnLength = 0;
  NTSTATUS status = NtQuerySystemInformation(
      SystemProcessorPerformanceInformationClass,
      buffer.data(), bufSize, &returnLength);
  if (status == STATUS_INFO_LENGTH_MISMATCH && returnLength > 0) {
    buffer.resize(returnLength);
    status = NtQuerySystemInformation(
        SystemProcessorPerformanceInformationClass,
        buffer.data(), returnLength, &returnLength);
  }
  if (status != 0) return;  // 不成功直接放弃，不更新基线

  size_t stride = (size_t)(returnLength / numCpus);
  if (stride < 24) stride = 24;  // 至少要能覆盖 Idle/Kernel/User

  std::vector<ULONGLONG> idle, kernel, user;
  idle.reserve(numCpus);
  kernel.reserve(numCpus);
  user.reserve(numCpus);
  for (DWORD i = 0; i < numCpus; ++i) {
    size_t base = (size_t)i * stride;
    if (base + 24 > returnLength) break;
    ULONGLONG id = *(ULONGLONG*)(buffer.data() + base + 0);
    ULONGLONG kn = *(ULONGLONG*)(buffer.data() + base + 8);
    ULONGLONG us = *(ULONGLONG*)(buffer.data() + base + 16);
    idle.push_back(id);
    kernel.push_back(kn);
    user.push_back(us);
  }
  size_t n = idle.size();
  if (n == 0) return;

  out.cpuPerCore.assign(n, 0.0);
  bool totalIsBaseline = !g_cpuTotal.valid;  // GetSystemTimes 此前失败
  if (g_cpuPerCore.valid && g_cpuPerCore.count == n) {
    double sum = 0.0;
    for (size_t i = 0; i < n; ++i) {
      ULONGLONG dK = kernel[i] - g_cpuPerCore.kernel[i];
      ULONGLONG dU = user[i] - g_cpuPerCore.user[i];
      ULONGLONG dI = idle[i] - g_cpuPerCore.idle[i];
      ULONGLONG total = dK + dU;
      double pct = 0.0;
      if (total > 0) {
        double busy = (double)((dK - dI) + dU);
        pct = busy / (double)total * 100.0;
        if (pct < 0) pct = 0;
        if (pct > 100) pct = 100;
      }
      out.cpuPerCore[i] = pct;
      sum += pct;
    }
    // 若 GetSystemTimes 没给出总占用，用每核平均兜底
    if (totalIsBaseline) out.cpuTotalPercent = sum / (double)n;
  }
  g_cpuPerCore = { true, n, std::move(idle), std::move(kernel), std::move(user) };
}

// ---------------------------------------------------------------------------
// 磁盘 —— 枚举逻辑驱动器 + 容量；读/写速率与 active% 来自 PDH 计数器
// ---------------------------------------------------------------------------
static void CollectDisks(PerfDataRaw& out) {
  InitDiskPdh();

  // 每次采集刷新 PDH 数据（per-sec 速率需要时间窗）
  if (g_diskPdh.query) {
    PdhCollectQueryData(g_diskPdh.query);
  }

  // 盘符 → (readBps, writeBps, activePct)
  std::unordered_map<std::string, std::tuple<unsigned long long,
                                              unsigned long long, double>> pdhVals;
  if (g_diskPdh.query) {
    for (auto& entry : g_diskPdh.counters) {
      const std::string& letter = std::get<0>(entry);
      PDH_HCOUNTER hRead = std::get<1>(entry);
      PDH_HCOUNTER hWrite = std::get<2>(entry);
      PDH_HCOUNTER hActive = std::get<3>(entry);
      PDH_FMT_COUNTERVALUE vRead{}, vWrite{}, vActive{};
      unsigned long long readBps = 0, writeBps = 0;
      double activePct = 0.0;
      if (PdhGetFormattedCounterValue(hRead, PDH_FMT_LARGE, nullptr, &vRead) == ERROR_SUCCESS) {
        readBps = (unsigned long long)vRead.largeValue;
      }
      if (PdhGetFormattedCounterValue(hWrite, PDH_FMT_LARGE, nullptr, &vWrite) == ERROR_SUCCESS) {
        writeBps = (unsigned long long)vWrite.largeValue;
      }
      if (PdhGetFormattedCounterValue(hActive, PDH_FMT_DOUBLE, nullptr, &vActive) == ERROR_SUCCESS) {
        activePct = vActive.doubleValue;
      }
      pdhVals[letter] = {readBps, writeBps, activePct};
    }
  }

  char drives[512];
  DWORD len = GetLogicalDriveStringsA(sizeof(drives), drives);
  if (len == 0 || len >= sizeof(drives)) return;

  // drives 为以 \0 分隔、以 \0\0 结尾的字符串序列
  for (const char* p = drives; *p != '\0'; p += strlen(p) + 1) {
    // 仅对固定盘/可移动盘尝试；GetDiskFreeSpaceExA 对光驱/无介质盘会失败
    UINT type = GetDriveTypeA(p);
    if (type != DRIVE_FIXED && type != DRIVE_REMOVABLE) continue;

    ULONGLONG freeBytesAvail = 0, totalBytes = 0, totalFreeBytes = 0;
    if (!GetDiskFreeSpaceExA(p,
          (PULARGE_INTEGER)&freeBytesAvail,
          (PULARGE_INTEGER)&totalBytes,
          (PULARGE_INTEGER)&totalFreeBytes)) {
      continue;
    }

    std::string letter(1, p[0]);
    DiskPerf d{};
    d.name = std::string(p);  // 形如 "C:\\"
    d.totalBytes = totalBytes;
    d.freeBytes = totalFreeBytes;
    d.readBytesPerSec = 0;
    d.writeBytesPerSec = 0;
    d.activePercent = 0.0;
    auto it = pdhVals.find(letter);
    if (it != pdhVals.end()) {
      d.readBytesPerSec = std::get<0>(it->second);
      d.writeBytesPerSec = std::get<1>(it->second);
      d.activePercent = std::get<2>(it->second);
      // % Disk Time 偶尔会略超 100 或为负（驱动报告），钳到 0-100
      if (d.activePercent < 0) d.activePercent = 0;
      if (d.activePercent > 100) d.activePercent = 100;
    }
    out.disks.push_back(std::move(d));
  }
}

// ---------------------------------------------------------------------------
// 网络 —— GetIfTable2 + 每接口 InOctets/OutOctets 双快照差分
// ---------------------------------------------------------------------------
static void CollectNetworks(PerfDataRaw& out) {
  PMIB_IF_TABLE2 table = nullptr;
  // GetIfTable2 分配内存，必须用 FreeMibTable 释放
  if (GetIfTable2(&table) != NO_ERROR || table == nullptr) return;

  long long nowNs = NowSteadyNs();

  // 先把当前快照按 InterfaceIndex 收集
  for (ULONG i = 0; i < table->NumEntries; ++i) {
    MIB_IF_ROW2& r = table->Table[i];

    // 跳过 In/Out 都为 0 的接口（环回/未用虚拟适配器）
    if (r.InOctets == 0 && r.OutOctets == 0) continue;

    std::string name = WcharsToUtf8(r.Alias, 258);
    if (name.empty()) name = WcharsToUtf8(r.Description, 256);
    if (name.empty()) name = std::string("if") + std::to_string(r.InterfaceIndex);

    unsigned long long recvBps = 0, sendBps = 0;
    auto it = g_netLast.find(r.InterfaceIndex);
    if (g_netValid && it != g_netLast.end()) {
      double dt = (double)(nowNs - it->second.steadyNs) / 1e9;
      if (dt > 0.0) {
        unsigned long long dIn = r.InOctets - it->second.inOctets;
        unsigned long long dOut = r.OutOctets - it->second.outOctets;
        recvBps = (unsigned long long)((double)dIn / dt);
        sendBps = (unsigned long long)((double)dOut / dt);
      }
    }

    NetPerf np{};
    np.name = std::move(name);
    np.recvBytesPerSec = recvBps;
    np.sendBytesPerSec = sendBps;
    out.networks.push_back(std::move(np));

    // 更新基线
    g_netLast[r.InterfaceIndex] = { r.InOctets, r.OutOctets, nowNs };
  }

  g_netValid = true;
  FreeMibTable(table);
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------
Napi::Value PerfCounters(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  PerfDataRaw raw{};
  // 默认值：CPU/mem 为 0，时间戳取当前
  raw.cpuTotalPercent = 0.0;
  raw.memTotalBytes = 0;
  raw.memAvailableBytes = 0;
  raw.memUsedPercent = 0.0;
  raw.timestampMs = NowEpochMs();

  CollectMemory(raw);
  CollectCpuTotal(raw);
  CollectCpuPerCore(raw);  // 可能用每核平均兜底 total
  CollectDisks(raw);
  CollectNetworks(raw);

  // ---- 组装 JS 对象 ----
  Napi::Object result = Napi::Object::New(env);

  Napi::Object cpu = Napi::Object::New(env);
  cpu.Set("totalPercent", Napi::Number::New(env, raw.cpuTotalPercent));
  Napi::Array perCore = Napi::Array::New(env, raw.cpuPerCore.size());
  for (size_t i = 0; i < raw.cpuPerCore.size(); ++i) {
    perCore[(uint32_t)i] = Napi::Number::New(env, raw.cpuPerCore[i]);
  }
  cpu.Set("perCore", perCore);
  result.Set("cpu", cpu);

  Napi::Object memory = Napi::Object::New(env);
  memory.Set("totalBytes", Napi::Number::New(env, (double)raw.memTotalBytes));
  memory.Set("availableBytes", Napi::Number::New(env, (double)raw.memAvailableBytes));
  memory.Set("usedPercent", Napi::Number::New(env, raw.memUsedPercent));
  result.Set("memory", memory);

  Napi::Array disks = Napi::Array::New(env, raw.disks.size());
  for (size_t i = 0; i < raw.disks.size(); ++i) {
    const DiskPerf& d = raw.disks[i];
    Napi::Object obj = Napi::Object::New(env);
    obj.Set("name", Napi::String::New(env, d.name));
    obj.Set("totalBytes", Napi::Number::New(env, (double)d.totalBytes));
    obj.Set("freeBytes", Napi::Number::New(env, (double)d.freeBytes));
    obj.Set("readBytesPerSec", Napi::Number::New(env, (double)d.readBytesPerSec));
    obj.Set("writeBytesPerSec", Napi::Number::New(env, (double)d.writeBytesPerSec));
    obj.Set("activePercent", Napi::Number::New(env, d.activePercent));
    disks[(uint32_t)i] = obj;
  }
  result.Set("disks", disks);

  Napi::Array networks = Napi::Array::New(env, raw.networks.size());
  for (size_t i = 0; i < raw.networks.size(); ++i) {
    const NetPerf& n2 = raw.networks[i];
    Napi::Object obj = Napi::Object::New(env);
    obj.Set("name", Napi::String::New(env, n2.name));
    obj.Set("recvBytesPerSec", Napi::Number::New(env, (double)n2.recvBytesPerSec));
    obj.Set("sendBytesPerSec", Napi::Number::New(env, (double)n2.sendBytesPerSec));
    networks[(uint32_t)i] = obj;
  }
  result.Set("networks", networks);

  result.Set("timestamp", Napi::Number::New(env, (double)raw.timestampMs));

  return result;
}
