#include "cpu_tracker.h"
#include "process_collector.h"
#include <windows.h>

std::unordered_map<ULONG, CpuTracker::Sample> CpuTracker::last_;

Napi::Value CpuTracker::CpuDelta(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  // 拿当前进程列表
  std::vector<ProcessInfoRaw> procs;
  std::string err;
  if (!CollectAllProcesses(procs, err)) {
    Napi::Error::New(env, err).ThrowAsJavaScriptException();
    return env.Null();
  }

  // 当前时间（毫秒）
  FILETIME ft;
  GetSystemTimeAsFileTime(&ft);
  long long nowMs = ((long long)ft.dwHighDateTime << 32 | ft.dwLowDateTime) / 10000;

  Napi::Array result = Napi::Array::New(env, procs.size());
  uint32_t outIdx = 0;

  for (const auto& p : procs) {
    auto it = last_.find(p.pid);
    double cpuPercent = 0.0;

    if (it != last_.end()) {
      long long dt = nowMs - it->second.timeMs;
      if (dt > 0) {
        long long cpuMs = (p.kernelTimeMs - it->second.kernelMs)
                        + (p.userTimeMs - it->second.userMs);
        // CPU% = 进程占用CPU时间 / 实际流逝时间 * 100（相对单核）
        cpuPercent = (double)cpuMs / dt * 100.0;
        if (cpuPercent < 0) cpuPercent = 0;
        if (cpuPercent > 100) cpuPercent = 100;
      }
    }

    Napi::Object obj = Napi::Object::New(env);
    obj.Set("pid", Napi::Number::New(env, (double)p.pid));
    obj.Set("cpuPercent", Napi::Number::New(env, cpuPercent));
    result.Set(outIdx++, obj);

    // 更新快照
    last_[p.pid] = {p.kernelTimeMs, p.userTimeMs, nowMs};
  }

  // 清理已退出的进程（避免 map 无限增长）
  // 简化策略：若 map 比当前进程列表大很多，整体重建
  if (last_.size() > procs.size() * 2) {
    last_.clear();
    for (const auto& p : procs) {
      last_[p.pid] = {p.kernelTimeMs, p.userTimeMs, nowMs};
    }
  }

  return result;
}
