#pragma once
#include <napi.h>
#include <windows.h>
#include <string>
#include <vector>

struct NetConnRaw {
  std::string protocol;     // "tcp" | "udp"
  std::string localAddr;
  USHORT localPort;
  std::string remoteAddr;
  USHORT remotePort;
  std::string state;        // "LISTEN" / "ESTABLISHED" / ...
  ULONG pid;
  std::string processName;  // 占用进程名（查不到时为空）
};

bool CollectAllConnections(std::vector<NetConnRaw>& out, std::string& errMessage);

Napi::Value NetScan(const Napi::CallbackInfo& info);
