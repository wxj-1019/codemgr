#pragma once
#include <napi.h>

// 读取目标进程环境变量。成功返回 JS 对象 {KEY: value}；
// 失败（权限不足 / 进程已退出 / 读取失败）抛 JS 异常，由调用方降级处理。
// 仅支持 x64 Windows（PEB 偏移为 64 位布局）。
Napi::Value ReadProcessEnv(const Napi::CallbackInfo& info);
