#include <napi.h>

#include "process_collector.h"
#include "net_collector.h"
#include "cpu_tracker.h"
#include "process_ops.h"

// 占位函数：验证模块能加载
Napi::Value Hello(const Napi::CallbackInfo& info) {
  return Napi::String::New(info.Env(), "codemgr-native alive");
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set(Napi::String::New(env, "hello"), Napi::Function::New(env, Hello));
  exports.Set(Napi::String::New(env, "processScan"), Napi::Function::New(env, ProcessScan));
  exports.Set(Napi::String::New(env, "netScan"), Napi::Function::New(env, NetScan));
  exports.Set(Napi::String::New(env, "cpuDelta"), Napi::Function::New(env, CpuTracker::CpuDelta));
  exports.Set(Napi::String::New(env, "killProcess"), Napi::Function::New(env, KillProcess));
  exports.Set(Napi::String::New(env, "killByName"), Napi::Function::New(env, KillByName));
  return exports;
}

NODE_API_MODULE(codemgr_native, Init)
