#pragma once
#include <napi.h>
#include <vector>
#include <windows.h>

// GPU/显存采集（v2.1，spec D5）。
//
// 用 PDH English counters（PdhAddEnglishCounterW，免本地化）采集 GPU Engine
// 的 Utilization Percentage + Dedicated Usage，按 pid 聚合；DXGI 取显存总量/用量。
// 无 GPU 环境（虚拟机/远程桌面）→ available=false 降级，不报错。
//
// 聚合结果通过 CollectGpu(raw) 并入 PerfCounters 返回（见 perf_collector.cpp），
// 不单独导出 JS 函数——与 cpu/disk/net 同为 perfCounters 的内部组成。
namespace gpu_collector {
struct GpuRaw {
  bool available = false;
  double totalPercent = 0.0;
  unsigned long long vramUsedBytes = 0;
  unsigned long long vramBudgetBytes = 0;
  struct ProcGpu { DWORD pid; double gpuPercent; unsigned long long vramBytes; };
  std::vector<ProcGpu> perProcess;
};
// 采集一次 GPU 数据，写入 raw。无 GPU 计数器时 available=false（不抛错）。
void CollectGpu(GpuRaw& raw);
}  // namespace gpu_collector
