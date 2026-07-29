#include "cwd_collector.h"
#include <windows.h>
#include <string>

// PEB 行走骨架与 env_collector.cpp 同源（OpenProcess + WoW64 拒绝 + NtQIP 取 PEB）。
// 差异：cwd 读的是 CurrentDirectory.DosPath（一个 UNICODE_STRING，非裸指针），
// 偏移 0x38（CURDIR 在 RTL_USER_PROCESS_PARAMETERS 内，DosPath 是其首字段）。

typedef NTSTATUS(NTAPI* NtQueryInformationProcess_t)(
  HANDLE ProcessHandle, ULONG ProcessInformationClass,
  PVOID ProcessInformation, ULONG ProcessInformationLength, PULONG ReturnLength);

struct PBI_LOCAL {
  PVOID Reserved1;
  PVOID PebBaseAddress;
  PVOID Reserved2[2];
  ULONG_PTR UniqueProcessId;
  PVOID Reserved3;
};

// 远程 UNICODE_STRING：USHORT Length（字节数，不含终止符）、USHORT MaximumLength、
// 4 字节填充、PWSTR Buffer（指向目标进程地址空间内的字符串体）。
struct MY_UNICODE_STRING {
  USHORT Length;
  USHORT MaximumLength;
  PVOID Buffer;
};

// x64 PEB 布局偏移：PEB+0x20 = ProcessParameters；
// RTL_USER_PROCESS_PARAMETERS+0x38 = CurrentDirectory.DosPath（UNICODE_STRING）
static const SIZE_T OFFSET_PEB_PROCESS_PARAMETERS = 0x20;
static const SIZE_T OFFSET_RUPP_CURRENT_DIRECTORY_DOSPATH = 0x38;

// 从远程进程读一段已知大小的内存；失败返回 false。
static bool ReadRemoteBytes(HANDLE h, const void* addr, void* dst, SIZE_T size) {
  SIZE_T read = 0;
  return ReadProcessMemory(h, addr, dst, size, &read) && read == size;
}

// 剥离 NT 命名空间前缀（\??\ 和 \\?\）。PEB 的 DosPath 通常是 Win32 路径，
// 但有时带这些前缀；剥掉后即可用于分组。纯 NT 设备路径（\Device\...）罕见于
// dev server 的 cwd，此处不转换（返回原值，调用方可见）。
static std::wstring StripNtPrefix(std::wstring s) {
  // \??\C:\...  →  C:\...
  if (s.size() >= 4 && s[0] == L'\\' && s[1] == L'?' && s[2] == L'?' && s[3] == L'\\') {
    return s.substr(4);
  }
  // \\?\C:\...  →  C:\...
  if (s.size() >= 4 && s[0] == L'\\' && s[1] == L'\\' && s[2] == L'?' && s[3] == L'\\') {
    return s.substr(4);
  }
  return s;
}

Napi::Value ReadProcessCwd(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "expected pid:number").ThrowAsJavaScriptException();
    return env.Null();
  }
  DWORD pid = (DWORD)info[0].As<Napi::Number>().Int32Value();

  HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, FALSE, pid);
  if (!h) {
    DWORD gle = GetLastError();
    Napi::Error::New(env, "open process failed for pid " + std::to_string(pid) +
                          " gle=" + std::to_string(gle) + " (access denied or exited)")
      .ThrowAsJavaScriptException();
    return env.Null();
  }

  // 拒绝 WoW64：32 位目标的 x64 PEB 偏移会错位（与 env_collector 同理）。
  BOOL wow64 = FALSE;
  if (IsWow64Process(h, &wow64) && wow64) {
    CloseHandle(h);
    Napi::Error::New(env, "32-bit (WoW64) process not supported (pid " +
                          std::to_string(pid) + ")").ThrowAsJavaScriptException();
    return env.Null();
  }

  auto ntqip = (NtQueryInformationProcess_t)GetProcAddress(
    GetModuleHandleW(L"ntdll.dll"), "NtQueryInformationProcess");
  if (!ntqip) {
    CloseHandle(h);
    Napi::Error::New(env, "NtQueryInformationProcess unavailable").ThrowAsJavaScriptException();
    return env.Null();
  }

  PBI_LOCAL pbi{};
  NTSTATUS st = ntqip(h, 0 /*ProcessBasicInformation*/, &pbi, sizeof(pbi), nullptr);
  if (st != 0 || !pbi.PebBaseAddress) {
    CloseHandle(h);
    Napi::Error::New(env, "query PEB failed for pid " + std::to_string(pid) +
                          " ntstatus=" + std::to_string(st)).ThrowAsJavaScriptException();
    return env.Null();
  }

  // 1) PEB → ProcessParameters 指针
  ULONG_PTR paramsAddr = 0;
  if (!ReadRemoteBytes(h, (const BYTE*)pbi.PebBaseAddress + OFFSET_PEB_PROCESS_PARAMETERS,
                       &paramsAddr, sizeof(paramsAddr)) || paramsAddr == 0) {
    DWORD gle = GetLastError();
    CloseHandle(h);
    Napi::Error::New(env, "read ProcessParameters pointer failed for pid " + std::to_string(pid) +
                          " gle=" + std::to_string(gle)).ThrowAsJavaScriptException();
    return env.Null();
  }

  // 2) ProcessParameters → CurrentDirectory.DosPath（UNICODE_STRING，16 字节）
  MY_UNICODE_STRING dosPath{};
  if (!ReadRemoteBytes(h, (const BYTE*)paramsAddr + OFFSET_RUPP_CURRENT_DIRECTORY_DOSPATH,
                       &dosPath, sizeof(dosPath)) || dosPath.Length == 0 || dosPath.Buffer == nullptr) {
    DWORD gle = GetLastError();
    CloseHandle(h);
    Napi::Error::New(env, "read CurrentDirectoryDosPath header failed for pid " +
                          std::to_string(pid) + " gle=" + std::to_string(gle))
      .ThrowAsJavaScriptException();
    return env.Null();
  }

  // 3) 读字符串体（Length 是字节数，wchar_t 个数 = Length/2）
  SIZE_T charBytes = dosPath.Length;  // 上限保护
  if (charBytes > 32768) charBytes = 32768;
  std::wstring buf(charBytes / sizeof(wchar_t), L'\0');
  if (!ReadRemoteBytes(h, dosPath.Buffer, &buf[0], charBytes)) {
    DWORD gle = GetLastError();
    CloseHandle(h);
    Napi::Error::New(env, "read CurrentDirectoryDosPath body failed for pid " +
                          std::to_string(pid) + " gle=" + std::to_string(gle))
      .ThrowAsJavaScriptException();
    return env.Null();
  }
  CloseHandle(h);

  buf = StripNtPrefix(buf);
  return Napi::String::New(env, (const char16_t*)buf.data(), buf.size());
}
