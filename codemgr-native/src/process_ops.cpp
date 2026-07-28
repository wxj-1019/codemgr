#include "process_ops.h"
#include "process_collector.h"
#include <windows.h>

Napi::Value KillProcess(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "expected pid:number").ThrowAsJavaScriptException();
    return env.Null();
  }
  DWORD pid = (DWORD)info[0].As<Napi::Number>().Int32Value();

  HANDLE h = OpenProcess(PROCESS_TERMINATE, FALSE, pid);
  if (!h) {
    return Napi::Boolean::New(env, false);  // 失败：权限不足或进程已退出
  }
  BOOL ok = TerminateProcess(h, 1);
  CloseHandle(h);
  return Napi::Boolean::New(env, ok != 0);
}

Napi::Value KillByName(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "expected name:string").ThrowAsJavaScriptException();
    return env.Null();
  }
  std::string target = info[0].As<Napi::String>().Utf8Value();

  // 采集后匹配名
  std::vector<ProcessInfoRaw> procs;
  std::string err;
  if (!CollectAllProcesses(procs, err)) {
    Napi::Error::New(env, err).ThrowAsJavaScriptException();
    return env.Null();
  }

  int killed = 0;
  for (const auto& p : procs) {
    // 大小写不敏感比较（Windows 进程名不区分大小写）
    if (_stricmp(p.name.c_str(), target.c_str()) == 0) {
      HANDLE h = OpenProcess(PROCESS_TERMINATE, FALSE, p.pid);
      if (h) {
        if (TerminateProcess(h, 1)) killed++;
        CloseHandle(h);
      }
    }
  }
  return Napi::Number::New(env, killed);
}
