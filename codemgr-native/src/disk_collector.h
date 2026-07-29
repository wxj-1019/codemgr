#pragma once
#include <napi.h>

// 枚举本机所有逻辑磁盘卷（盘符 + 类型 + 空间）。返回 Napi::Array，每项含
// letter/type/totalBytes/freeBytes/availableBytes。纯 Win32 API（kernel32，默认链接）。
// 错误（GetLogicalDriveStringsW 失败）抛 JS 异常，gle= 错误码便于诊断。
Napi::Value DiskVolumes(const Napi::CallbackInfo& info);
