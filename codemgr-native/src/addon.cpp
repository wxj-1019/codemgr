#include <napi.h>

// 占位函数：验证模块能加载
Napi::Value Hello(const Napi::CallbackInfo& info) {
  return Napi::String::New(info.Env(), "codemgr-native alive");
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set(Napi::String::New(env, "hello"), Napi::Function::New(env, Hello));
  return exports;
}

NODE_API_MODULE(codemgr_native, Init)
