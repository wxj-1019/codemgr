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

// Kill by explicit PID list. Skips protected names + own process.
// Returns actual killed count.
size_t KillByPids(const std::vector<DWORD>& pids);

// Kill a process and all its descendants (DFS over ppid chain).
// Reuses KillByPids: protection list + self-pid guard still apply per pid.
// Returns actual killed count.
size_t KillTree(DWORD rootPid);

Napi::Value KillTreeJS(const Napi::CallbackInfo& info);
