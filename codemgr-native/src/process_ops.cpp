#include "process_ops.h"
#include "process_collector.h"
#include <windows.h>

#include <algorithm>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

// Protection list (case-insensitive). Never kill these.
bool IsProtected(const std::string& name) {
  static const char* protectedNames[] = {
    "System", "Registry", "smss.exe", "csrss.exe", "wininit.exe", "winlogon.exe",
    "services.exe", "lsass.exe", "svchost.exe", "CodeMgr.exe", "electron.exe",
    "Idle", nullptr
  };
  std::string lower = name;
  std::transform(lower.begin(), lower.end(), lower.begin(),
                 [](unsigned char c) { return (char)::tolower(c); });
  for (int i = 0; protectedNames[i]; i++) {
    std::string p = protectedNames[i];
    std::transform(p.begin(), p.end(), p.begin(),
                   [](unsigned char c) { return (char)::tolower(c); });
    if (lower == p) return true;
  }
  return false;
}

// Kill by explicit PID list. Skips protected names + own process. Returns actual killed count.
size_t KillByPids(const std::vector<DWORD>& pids) {
  size_t killed = 0;
  DWORD selfPid = GetCurrentProcessId();

  // Build pid->name map once via process enumeration (reuse process_collector's CollectAllProcesses)
  std::vector<ProcessInfoRaw> procs;
  std::string err;
  if (!CollectAllProcesses(procs, err)) return 0;

  std::unordered_map<DWORD, std::string> nameMap;
  nameMap.reserve(procs.size());
  for (const auto& p : procs) nameMap[p.pid] = p.name;

  for (DWORD pid : pids) {
    if (pid == selfPid) continue;
    auto it = nameMap.find(pid);
    if (it != nameMap.end() && IsProtected(it->second)) continue;
    HANDLE h = OpenProcess(PROCESS_TERMINATE, FALSE, pid);
    if (h) {
      if (TerminateProcess(h, 1)) killed++;
      CloseHandle(h);
    }
  }
  return killed;
}

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

  DWORD selfPid = GetCurrentProcessId();
  int killed = 0;
  for (const auto& p : procs) {
    // 跳过保护名单（即便名字匹配，也不杀 System/svchost/electron 等）
    if (IsProtected(p.name)) continue;
    // 跳过自身
    if (p.pid == selfPid) continue;
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

// killByPids(pids: number[]) -> number : actual killed count
Napi::Value KillByPidsJS(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsArray()) {
    Napi::TypeError::New(env, "expected pids:number[]").ThrowAsJavaScriptException();
    return env.Null();
  }
  Napi::Array arr = info[0].As<Napi::Array>();
  std::vector<DWORD> pids;
  pids.reserve(arr.Length());
  for (uint32_t i = 0; i < arr.Length(); i++) {
    pids.push_back((DWORD)arr.Get(i).As<Napi::Number>().Int32Value());
  }
  return Napi::Number::New(env, (double)KillByPids(pids));
}

size_t KillTree(DWORD rootPid) {
  std::vector<ProcessInfoRaw> procs;
  std::string err;
  if (!CollectAllProcesses(procs, err)) return 0;

  // ppid -> children pids
  std::unordered_map<DWORD, std::vector<DWORD>> children;
  children.reserve(procs.size());
  for (const auto& p : procs) children[(DWORD)p.ppid].push_back((DWORD)p.pid);

  // 根进程在保护名单 → 整棵树拒绝。services.exe 的子树里有不在名单内的
  // 服务进程（spoolsv/dllhost 等），按名字逐个放行会把系统服务树砍掉。
  for (const auto& p : procs) {
    if ((DWORD)p.pid == rootPid && IsProtected(p.name)) return 0;
  }
  if (rootPid == 0) return 0; // Idle：其子树是整个用户态

  // 迭代式 DFS 收集整棵子树（含根）。visited 防环 + 防自引用。
  std::vector<DWORD> pids;
  std::vector<DWORD> stack;
  std::unordered_set<DWORD> visited;
  visited.insert(rootPid);
  stack.push_back(rootPid);
  while (!stack.empty()) {
    DWORD pid = stack.back();
    stack.pop_back();
    pids.push_back(pid);
    auto it = children.find(pid);
    if (it == children.end()) continue;
    for (DWORD c : it->second) {
      // visited 防环：PID 复用可造成 A.ppid==B.pid && B.ppid==A.pid 的快照环
      if (visited.insert(c).second) stack.push_back(c);
    }
  }
  return KillByPids(pids);
}

Napi::Value KillTreeJS(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "expected pid:number").ThrowAsJavaScriptException();
    return env.Null();
  }
  DWORD pid = (DWORD)info[0].As<Napi::Number>().Int32Value();
  return Napi::Number::New(env, (double)KillTree(pid));
}
