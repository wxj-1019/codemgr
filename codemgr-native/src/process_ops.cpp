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

// KillStatus → JS 状态字符串（UX-02/04，UI 的 KillStatus 类型对齐）。
static const char* KillStatusStr(KillStatus s) {
  switch (s) {
    case KillStatus::Killed: return "killed";
    case KillStatus::Protected: return "protected";
    case KillStatus::Denied: return "denied";
    case KillStatus::NotFound: return "not-found";
  }
  return "denied";
}

// Kill by explicit PID list with per-pid outcomes (UX-02/04).
// Skips protected names + own process; each pid reported as
// killed / protected / denied / not-found so the UI can explain failures.
std::vector<KillOutcome> KillByPidsDetailed(const std::vector<DWORD>& pids) {
  std::vector<KillOutcome> outcomes;
  outcomes.reserve(pids.size());
  DWORD selfPid = GetCurrentProcessId();

  // Build pid->name map once via process enumeration (reuse process_collector's CollectAllProcesses)
  std::vector<ProcessInfoRaw> procs;
  std::string err;
  if (!CollectAllProcesses(procs, err)) {
    // 采集失败（罕见）：无法判断保护/存在性，全部按 denied 报，避免误杀
    for (DWORD pid : pids) outcomes.push_back({ pid, KillStatus::Denied });
    return outcomes;
  }

  std::unordered_map<DWORD, std::string> nameMap;
  nameMap.reserve(procs.size());
  for (const auto& p : procs) nameMap[p.pid] = p.name;

  for (DWORD pid : pids) {
    if (pid == selfPid) {
      outcomes.push_back({ pid, KillStatus::Protected });
      continue;
    }
    auto it = nameMap.find(pid);
    if (it == nameMap.end()) {
      outcomes.push_back({ pid, KillStatus::NotFound });  // 进程已退出（或 PID 复用前的残留）
      continue;
    }
    if (IsProtected(it->second)) {
      outcomes.push_back({ pid, KillStatus::Protected });
      continue;
    }
    HANDLE h = OpenProcess(PROCESS_TERMINATE, FALSE, pid);
    if (h) {
      if (TerminateProcess(h, 1)) {
        outcomes.push_back({ pid, KillStatus::Killed });
      } else {
        outcomes.push_back({ pid, KillStatus::Denied });  // 句柄拿到但终止失败（权限边界）
      }
      CloseHandle(h);
    } else {
      outcomes.push_back({ pid, KillStatus::Denied });  // 权限不足（或竞态退出）
    }
  }
  return outcomes;
}

// Kill by explicit PID list. Skips protected names + own process. Returns actual killed count.
size_t KillByPids(const std::vector<DWORD>& pids) {
  size_t killed = 0;
  for (const auto& o : KillByPidsDetailed(pids)) {
    if (o.status == KillStatus::Killed) killed++;
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

  // 与 killByPids 对齐（UX-02/04）：返回状态字符串，UI 据此区分
  // 受保护 / 权限不足 / 已退出，不再把三种失败揉成一个 false。
  std::vector<DWORD> pids = { pid };
  auto outcomes = KillByPidsDetailed(pids);
  KillStatus st = outcomes.empty() ? KillStatus::Denied : outcomes[0].status;
  return Napi::String::New(env, KillStatusStr(st));
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

// killByPids(pids: number[]) -> Array<{pid, status}> (UX-02/04: per-pid outcomes)
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
  auto outcomes = KillByPidsDetailed(pids);
  Napi::Array result = Napi::Array::New(env, outcomes.size());
  for (size_t i = 0; i < outcomes.size(); i++) {
    Napi::Object o = Napi::Object::New(env);
    o.Set("pid", Napi::Number::New(env, (double)outcomes[i].pid));
    o.Set("status", Napi::String::New(env, KillStatusStr(outcomes[i].status)));
    result.Set((uint32_t)i, o);
  }
  return result;
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
