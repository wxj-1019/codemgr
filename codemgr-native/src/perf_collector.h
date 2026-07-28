#pragma once
#include <napi.h>
#include <windows.h>
#include <string>
#include <vector>

// perfCounters() —— 系统级 CPU/内存/磁盘/网络 指标采集
// 所有“速率”字段（readBytesPerSec、recvBytesPerSec 等）依赖双快照差分，
// 首次调用返回 0 并建立基线，之后调用才有意义。

struct DiskPerf {
  std::string name;                  // "C:\\"
  unsigned long long totalBytes;
  unsigned long long freeBytes;
  unsigned long long readBytesPerSec;   // PDH \LogicalDisk(*)\Disk Read Bytes/sec
  unsigned long long writeBytesPerSec;  // PDH \LogicalDisk(*)\Disk Write Bytes/sec
  double activePercent;                 // PDH \LogicalDisk(*)\% Disk Time (0-100)
};

struct NetPerf {
  std::string name;
  unsigned long long recvBytesPerSec;
  unsigned long long sendBytesPerSec;
};

struct PerfDataRaw {
  double cpuTotalPercent;             // 0-100
  std::vector<double> cpuPerCore;     // [core0%, core1%, ...] 每个 0-100
  unsigned long long memTotalBytes;
  unsigned long long memAvailableBytes;
  double memUsedPercent;              // 0-100
  std::vector<DiskPerf> disks;
  std::vector<NetPerf> networks;
  long long timestampMs;
};

Napi::Value PerfCounters(const Napi::CallbackInfo& info);
