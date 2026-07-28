#pragma once
#include <napi.h>

Napi::Value KillProcess(const Napi::CallbackInfo& info);
Napi::Value KillByName(const Napi::CallbackInfo& info);
