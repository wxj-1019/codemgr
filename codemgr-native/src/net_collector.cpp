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

#include <unordered_map>

// ----------------------------------------------------------------------------
// 不包含 <winternl.h>：其 UNICODE_STRING 等声明可能与下方 MY_ 前缀自定义
// 结构冲突（同 process_collector.cpp 的处理）。只需 NtQuerySystemInformation
// 的 SystemProcessIdInformation(class 88) 按 pid 查映像路径。
// ----------------------------------------------------------------------------

#ifndef _NTSTATUS_DEFINED
typedef LONG NTSTATUS;
#define _NTSTATUS_DEFINED
#endif

typedef struct _MY_UNICODE_STRING {
  USHORT Length;        // 字节数（不含终止符）
  USHORT MaximumLength;
  PWSTR Buffer;
} MY_UNICODE_STRING, *PMY_UNICODE_STRING;

// NtQuerySystemInformation(SystemProcessIdInformation = 88) 的输入/输出结构：
// 传入 ProcessId + ImageName 缓冲区，返回该进程映像的 NT 设备路径
// （\Device\HarddiskVolumeX\...\foo.exe）。自 XP 起布局稳定。
typedef struct _MY_SYSTEM_PROCESS_ID_INFORMATION {
  HANDLE ProcessId;
  MY_UNICODE_STRING ImageName;
} MY_SYSTEM_PROCESS_ID_INFORMATION;

static constexpr ULONG SystemProcessIdInformationClass = 88;  // 0x58

extern "C" {
typedef NTSTATUS(NTAPI* pNtQuerySystemInformation)(
    ULONG SystemInformationClass,
    PVOID SystemInformation,
    ULONG SystemInformationLength,
    PULONG ReturnLength);
}  // extern "C"

// 从完整路径（DOS 或 NT 设备路径）取文件名并转 UTF-8
static std::string BaseNameUtf8(const WCHAR* path, int charCount) {
  const WCHAR* base = path + charCount;
  while (base > path && base[-1] != L'\\') --base;  // 最后一个 '\' 之后
  int baseChars = charCount - (int)(base - path);
  if (baseChars <= 0) return std::string();
  int len = WideCharToMultiByte(CP_UTF8, 0, base, baseChars,
                                nullptr, 0, nullptr, nullptr);
  if (len <= 0) return std::string();
  std::string out(static_cast<size_t>(len), '\0');
  WideCharToMultiByte(CP_UTF8, 0, base, baseChars, &out[0], len,
                      nullptr, nullptr);
  return out;
}

// 为连接表中出现的 pid 解析进程名（只取 name，不读 PEB/cmdline）。
// 选型说明（本机 360+ 进程实测，netScan 基线 3ms）：
//   - 整表枚举 NtQuerySystemInformation(SystemProcessInformation) 会收集全部
//     线程信息 ~+6ms；Toolhelp32 快照 ~+12ms；逐个 OpenProcess ~+4ms，均超标。
//   - SystemProcessIdInformation 按 pid 直查、无需打开句柄，每次仅数 µs，
//     连接表去重后几十个 pid 总开销 <1ms；且能解析 OpenProcess 打不开的
//     受保护进程。查不到的（如 pid 4 System）留空，不影响连接列表本身。
static void FillProcessNames(std::vector<NetConnRaw>& conns) {
  HMODULE ntdll = GetModuleHandleW(L"ntdll.dll");
  if (ntdll == nullptr) return;
  auto NtQuerySystemInformation = reinterpret_cast<pNtQuerySystemInformation>(
      GetProcAddress(ntdll, "NtQuerySystemInformation"));
  if (NtQuerySystemInformation == nullptr) return;

  std::unordered_map<ULONG, std::string> cache;  // pid → name（含失败=空串）
  for (auto& c : conns) {
    if (c.pid == 0) continue;
    auto it = cache.find(c.pid);
    if (it != cache.end()) {
      c.processName = it->second;
      continue;
    }

    WCHAR buf[512];
    MY_SYSTEM_PROCESS_ID_INFORMATION info{};
    info.ProcessId = reinterpret_cast<HANDLE>(static_cast<ULONG_PTR>(c.pid));
    info.ImageName.Buffer = buf;
    info.ImageName.MaximumLength = (USHORT)sizeof(buf);
    NTSTATUS st = NtQuerySystemInformation(SystemProcessIdInformationClass,
                                           &info, sizeof(info), nullptr);
    if (st == 0 && info.ImageName.Length > 0) {
      c.processName = BaseNameUtf8(buf, info.ImageName.Length / 2);
    }
    cache.emplace(c.pid, c.processName);
  }
}

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

// 把 16 字节 IPv6 地址（网络字节序）转字符串（inet_ntop 不输出 scope id 后缀）
static std::string Ipv6ToStr(const UCHAR* addr) {
  char buf[INET6_ADDRSTRLEN];
  inet_ntop(AF_INET6, addr, buf, sizeof(buf));
  return std::string(buf);
}

bool CollectAllConnections(std::vector<NetConnRaw>& out, std::string& errMessage) {
  // --- IPv4 TCP ---
  // 首次调用只为探测所需缓冲区大小，期望返回 ERROR_INSUFFICIENT_BUFFER；
  // 其他返回值视为枚举失败：该协议返回空表并记录 errMessage。
  DWORD size = 0;
  DWORD rc = GetExtendedTcpTable(nullptr, &size, FALSE, AF_INET,
                                 TCP_TABLE_OWNER_PID_ALL, 0);
  if (rc != ERROR_INSUFFICIENT_BUFFER) {
    errMessage += "GetExtendedTcpTable(size query) failed: " + std::to_string(rc) + "; ";
  } else {
    std::vector<BYTE> buf(size);
    rc = GetExtendedTcpTable(buf.data(), &size, FALSE, AF_INET,
                             TCP_TABLE_OWNER_PID_ALL, 0);
    if (rc == NO_ERROR) {
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
    } else {
      errMessage += "GetExtendedTcpTable failed: " + std::to_string(rc) + "; ";
    }
  }

  // --- IPv4 UDP ---
  size = 0;
  rc = GetExtendedUdpTable(nullptr, &size, FALSE, AF_INET, UDP_TABLE_OWNER_PID, 0);
  if (rc != ERROR_INSUFFICIENT_BUFFER) {
    errMessage += "GetExtendedUdpTable(size query) failed: " + std::to_string(rc) + "; ";
  } else {
    std::vector<BYTE> buf(size);
    rc = GetExtendedUdpTable(buf.data(), &size, FALSE, AF_INET,
                             UDP_TABLE_OWNER_PID, 0);
    if (rc == NO_ERROR) {
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
    } else {
      errMessage += "GetExtendedUdpTable failed: " + std::to_string(rc) + "; ";
    }
  }

  // --- IPv6 TCP ---
  // 表为空时 size 查询直接返回 NO_ERROR（与 v4 表非空时的
  // ERROR_INSUFFICIENT_BUFFER 不同），两者都进入取数据分支。
  size = 0;
  rc = GetExtendedTcpTable(nullptr, &size, FALSE, AF_INET6,
                           TCP_TABLE_OWNER_PID_ALL, 0);
  if (rc != ERROR_INSUFFICIENT_BUFFER && rc != NO_ERROR) {
    errMessage += "GetExtendedTcpTable6(size query) failed: " + std::to_string(rc) + "; ";
  } else {
    std::vector<BYTE> buf(size);
    rc = GetExtendedTcpTable(buf.data(), &size, FALSE, AF_INET6,
                             TCP_TABLE_OWNER_PID_ALL, 0);
    if (rc == NO_ERROR) {
      auto* tbl = reinterpret_cast<MIB_TCP6TABLE_OWNER_PID*>(buf.data());
      for (DWORD i = 0; i < tbl->dwNumEntries; i++) {
        auto& e = tbl->table[i];
        NetConnRaw c{};
        c.protocol = "tcp";
        c.localAddr = Ipv6ToStr(e.ucLocalAddr);
        c.localPort = ntohs((USHORT)e.dwLocalPort);
        c.remoteAddr = Ipv6ToStr(e.ucRemoteAddr);
        c.remotePort = ntohs((USHORT)e.dwRemotePort);
        c.state = TcpStateStr(e.dwState);
        c.pid = e.dwOwningPid;
        out.push_back(std::move(c));
      }
    } else {
      errMessage += "GetExtendedTcpTable6 failed: " + std::to_string(rc) + "; ";
    }
  }

  // --- IPv6 UDP ---
  size = 0;
  rc = GetExtendedUdpTable(nullptr, &size, FALSE, AF_INET6, UDP_TABLE_OWNER_PID, 0);
  if (rc != ERROR_INSUFFICIENT_BUFFER && rc != NO_ERROR) {
    errMessage += "GetExtendedUdpTable6(size query) failed: " + std::to_string(rc) + "; ";
  } else {
    std::vector<BYTE> buf(size);
    rc = GetExtendedUdpTable(buf.data(), &size, FALSE, AF_INET6,
                             UDP_TABLE_OWNER_PID, 0);
    if (rc == NO_ERROR) {
      auto* tbl = reinterpret_cast<MIB_UDP6TABLE_OWNER_PID*>(buf.data());
      for (DWORD i = 0; i < tbl->dwNumEntries; i++) {
        auto& e = tbl->table[i];
        NetConnRaw c{};
        c.protocol = "udp";
        c.localAddr = Ipv6ToStr(e.ucLocalAddr);
        c.localPort = ntohs((USHORT)e.dwLocalPort);
        c.remoteAddr = "*";
        c.remotePort = 0;
        c.state = "-";
        c.pid = e.dwOwningPid;
        out.push_back(std::move(c));
      }
    } else {
      errMessage += "GetExtendedUdpTable6 failed: " + std::to_string(rc) + "; ";
    }
  }

  // --- 填充 processName：只对连接表中出现的 pid 逐个解析 ---
  // 解析失败的进程 processName 留空（降级，不影响连接列表本身）。
  FillProcessNames(out);

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
    obj.Set("processName", Napi::String::New(env, conns[i].processName));
    result.Set((uint32_t)i, obj);
  }
  return result;
}
