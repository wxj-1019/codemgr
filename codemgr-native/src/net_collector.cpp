// 必须在 <windows.h> 之前定义 WIN32_LEAN_AND_MEAN：阻止 <windows.h> 拉入
// 旧版 <winsock.h>（Winsock 1）。否则 <winsock.h> 与 <winsock2.h> 冲突，
// 导致 <ws2tcpip.h> 解析失败（Filter / IP_MSFILTER / MULTICAST_MODE_TYPE 等
// 未声明，C2065/C1003）。MSDN 推荐顺序：winsock2.h → ws2tcpip.h → iphlpapi.h。
#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <ws2tcpip.h>
#include <iphlpapi.h>

#include "net_collector.h"
#include <windows.h>

// TCP 状态码 → 字符串
static const char* TcpStateStr(DWORD state) {
  switch (state) {
    case 1:  return "CLOSED";
    case 2:  return "LISTENING";
    case 3:  return "SYN_SENT";
    case 4:  return "SYN_RCVD";
    case 5:  return "ESTABLISHED";
    case 6:  return "FIN_WAIT1";
    case 7:  return "FIN_WAIT2";
    case 8:  return "CLOSE_WAIT";
    case 9:  return "CLOSING";
    case 10: return "LAST_ACK";
    case 11: return "TIME_WAIT";
    case 12: return "DELETE_TCB";
    default: return "UNKNOWN";
  }
}

// 把 DWORD IP（网络字节序）转字符串
static std::string IpToStr(DWORD ip) {
  in_addr addr;
  addr.S_un.S_addr = ip;
  char buf[INET_ADDRSTRLEN];
  inet_ntop(AF_INET, &addr, buf, sizeof(buf));
  return std::string(buf);
}

bool CollectAllConnections(std::vector<NetConnRaw>& out, std::string& errMessage) {
  // --- IPv4 TCP ---
  DWORD size = 0;
  GetExtendedTcpTable(nullptr, &size, FALSE, AF_INET, TCP_TABLE_OWNER_PID_ALL, 0);
  std::vector<BYTE> buf(size);
  if (GetExtendedTcpTable(buf.data(), &size, FALSE, AF_INET,
                          TCP_TABLE_OWNER_PID_ALL, 0) == NO_ERROR) {
    auto* tbl = reinterpret_cast<MIB_TCPTABLE_OWNER_PID*>(buf.data());
    for (DWORD i = 0; i < tbl->dwNumEntries; i++) {
      auto& e = tbl->table[i];
      NetConnRaw c{};
      c.protocol = "tcp";
      c.localAddr = IpToStr(e.dwLocalAddr);
      c.localPort = ntohs((USHORT)e.dwLocalPort);
      c.remoteAddr = IpToStr(e.dwRemoteAddr);
      c.remotePort = ntohs((USHORT)e.dwRemotePort);
      c.state = TcpStateStr(e.dwState);
      c.pid = e.dwOwningPid;
      out.push_back(std::move(c));
    }
  }

  // --- IPv4 UDP ---
  size = 0;
  GetExtendedUdpTable(nullptr, &size, FALSE, AF_INET, UDP_TABLE_OWNER_PID, 0);
  buf.assign(size, 0);
  if (GetExtendedUdpTable(buf.data(), &size, FALSE, AF_INET,
                          UDP_TABLE_OWNER_PID, 0) == NO_ERROR) {
    auto* tbl = reinterpret_cast<MIB_UDPTABLE_OWNER_PID*>(buf.data());
    for (DWORD i = 0; i < tbl->dwNumEntries; i++) {
      auto& e = tbl->table[i];
      NetConnRaw c{};
      c.protocol = "udp";
      c.localAddr = IpToStr(e.dwLocalAddr);
      c.localPort = ntohs((USHORT)e.dwLocalPort);
      c.remoteAddr = "*";
      c.remotePort = 0;
      c.state = "-";
      c.pid = e.dwOwningPid;
      out.push_back(std::move(c));
    }
  }

  // v0.1 暂不做 IPv6（后续按需加 AF_INET6）
  return true;
}

Napi::Value NetScan(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::vector<NetConnRaw> conns;
  std::string err;
  if (!CollectAllConnections(conns, err)) {
    Napi::Error::New(env, err).ThrowAsJavaScriptException();
    return env.Null();
  }

  Napi::Array result = Napi::Array::New(env, conns.size());
  for (size_t i = 0; i < conns.size(); i++) {
    Napi::Object obj = Napi::Object::New(env);
    obj.Set("protocol", Napi::String::New(env, conns[i].protocol));
    obj.Set("localAddr", Napi::String::New(env, conns[i].localAddr));
    obj.Set("localPort", Napi::Number::New(env, conns[i].localPort));
    obj.Set("remoteAddr", Napi::String::New(env, conns[i].remoteAddr));
    obj.Set("remotePort", Napi::Number::New(env, conns[i].remotePort));
    obj.Set("state", Napi::String::New(env, conns[i].state));
    obj.Set("pid", Napi::Number::New(env, conns[i].pid));
    // processName 留空，由 TS 层用 processScan 结果填充
    obj.Set("processName", Napi::String::New(env, ""));
    result.Set((uint32_t)i, obj);
  }
  return result;
}
