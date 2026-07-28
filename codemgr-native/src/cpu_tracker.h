#pragma once
#include <napi.h>
#include <windows.h>
#include <unordered_map>

// CPU% 追踪器：维护上次快照，计算两次之间的差值
class CpuTracker {
public:
  // 采集一次并返回各进程的 CPU%（相对单核 0-100）
  // 内部复用 process_collector 的时间字段
  static Napi::Value CpuDelta(const Napi::CallbackInfo& info);

private:
  // pid → (kernelTime, userTime, timestamp)
  struct Sample {
    long long kernelMs;
    long long userMs;
    long long timeMs;  // 调用时刻
  };
  static std::unordered_map<ULONG, Sample> last_;
};
