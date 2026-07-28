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
};

bool CollectAllConnections(std::vector<NetConnRaw>& out, std::string& errMessage);

Napi::Value NetScan(const Napi::CallbackInfo& info);
