#pragma once
#include <napi.h>
#include <windows.h>
#include <vector>
#include <string>

Napi::Value KillProcess(const Napi::CallbackInfo& info);
Napi::Value KillByName(const Napi::CallbackInfo& info);
Napi::Value KillByPidsJS(const Napi::CallbackInfo& info);

// Protection list (case-insensitive). Never kill these.
bool IsProtected(const std::string& name);

// Kill 逐 pid 结果（UX-02/04）：区分失败原因，UI 据此给准确反馈。
enum class KillStatus { Killed, Protected, Denied, NotFound };

struct KillOutcome {
  DWORD pid;
  KillStatus status;
};

// Kill by explicit PID list. Skips protected names + own process.
// Returns per-pid outcomes (killed / protected / denied / not-found).
std::vector<KillOutcome> KillByPidsDetailed(const std::vector<DWORD>& pids);

// Kill by explicit PID list. Skips protected names + own process.
// Returns actual killed count (sum over KillByPidsDetailed).
size_t KillByPids(const std::vector<DWORD>& pids);

// Kill a process and all its descendants (DFS over ppid chain).
// Reuses KillByPids: protection list + self-pid guard still apply per pid.
// Returns actual killed count.
size_t KillTree(DWORD rootPid);

Napi::Value KillTreeJS(const Napi::CallbackInfo& info);
