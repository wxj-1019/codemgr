#pragma once
#include <napi.h>

// 读取目标进程的【精确】工作目录（PEB ProcessParameters.CurrentDirectory.DosPath）。
// 成功返回 JS string（已剥离 \??\ / \\?\ NT 前缀）；失败抛 JS 异常，由调用方降级处理。
// 仅支持 x64 Windows（PEB 偏移为 64 位布局）。
// 与热路径 processScan 隔离：按需触发，不在每轮采集里调用（直读 PEB cwd 每进程多
// 1 次 NtQIP + 2 次 ReadProcessMemory，全量采集会把 p99 推过 20ms 红线）。
Napi::Value ReadProcessCwd(const Napi::CallbackInfo& info);
