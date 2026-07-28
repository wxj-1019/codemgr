#pragma once
#include <napi.h>
#include <windows.h>
#include <string>
#include <vector>

// 单个进程信息（C++ 侧结构，转 JS 前的中间态）
struct ProcessInfoRaw {
  ULONG pid;
  ULONG ppid;
  std::string name;
  std::string cmdline;
  std::string cwd;          // 当前工作目录（PEB ProcessParameters.CurrentDirectory）
  long long kernelTimeMs;
  long long userTimeMs;
  long long workingSetBytes;
  long long createTimeMs;
  ULONG threadCount;
  ULONG handleCount;
};

// 采集所有进程。失败返回 false，errMessage 填错误描述。
bool CollectAllProcesses(std::vector<ProcessInfoRaw>& out, std::string& errMessage);

// 把 C++ 结构转成 JS 对象数组
Napi::Value ProcessScan(const Napi::CallbackInfo& info);
