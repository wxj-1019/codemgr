#include "env_collector.h"
#include <windows.h>
#include <string>

// --- NT 类型（遵循项目惯例：自定义结构避免 winternl.h 冲突，见 AGENTS.md 陷阱 #3） ---
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

// x64 PEB 布局偏移：PEB+0x20 = ProcessParameters；RTL_USER_PROCESS_PARAMETERS+0x80 = Environment
static const SIZE_T OFFSET_PEB_PROCESS_PARAMETERS = 0x20;
static const SIZE_T OFFSET_RUPP_ENVIRONMENT = 0x80;

// 从远程进程读一个指针；失败返回 false
static bool ReadRemotePtr(HANDLE h, const void* addr, ULONG_PTR& out) {
  SIZE_T read = 0;
  return ReadProcessMemory(h, addr, &out, sizeof(out), &read) && read == sizeof(out) && out != 0;
}

Napi::Value ReadProcessEnv(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "expected pid:number").ThrowAsJavaScriptException();
    return env.Null();
  }
  DWORD pid = (DWORD)info[0].As<Napi::Number>().Int32Value();

  HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, FALSE, pid);
  if (!h) {
    Napi::Error::New(env, "open process failed (access denied or exited)")
      .ThrowAsJavaScriptException();
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
    Napi::Error::New(env, "query PEB failed").ThrowAsJavaScriptException();
    return env.Null();
  }

  ULONG_PTR paramsAddr = 0, envAddr = 0;
  if (!ReadRemotePtr(h, (const BYTE*)pbi.PebBaseAddress + OFFSET_PEB_PROCESS_PARAMETERS, paramsAddr) ||
      !ReadRemotePtr(h, (const BYTE*)paramsAddr + OFFSET_RUPP_ENVIRONMENT, envAddr)) {
    CloseHandle(h);
    Napi::Error::New(env, "read environment pointer failed").ThrowAsJavaScriptException();
    return env.Null();
  }

  // 环境块 = UTF-16 "K=V\0" 序列，双 \0 结尾。分块读直到拿到结尾；上限 64 块（512KB）防坏数据。
  // 注意1：环境块所在内存区域末尾通常不足一整块，ReadProcessMemory 会以
  //   ERROR_PARTIAL_COPY 返回 FALSE 但 read>0（已拷出部分字节），这部分必须收下，
  //   否则会丢失块尾的环境变量（如 PATH）。
  // 注意2：判断结尾不能用 block.find(L"\0\0")——该字面量作为 const wchar_t*
  //   长度为 0，find 空串恒返回 0。用显式构造的双 null wstring。
  const std::wstring kDoubleNull(2, L'\0');
  std::wstring block;
  wchar_t chunk[4096];
  for (int i = 0; i < 64; i++) {
    SIZE_T read = 0;
    BOOL ok = ReadProcessMemory(h, (const BYTE*)envAddr + (SIZE_T)i * sizeof(chunk),
                                chunk, sizeof(chunk), &read);
    if (read == 0) break;                       // 完全读不到：区域结束或失败
    block.append(chunk, read / sizeof(wchar_t));
    if (!ok) break;                             // 部分拷贝：已到区域末尾
    if (block.find(kDoubleNull) != std::wstring::npos) break;
  }
  CloseHandle(h);

  if (block.empty()) {
    Napi::Error::New(env, "environment block empty or unreadable").ThrowAsJavaScriptException();
    return env.Null();
  }

  // 解析为 JS 对象。跳过以 '=' 开头的隐藏变量（如 =C:=、=ExitCode）。
  // Napi::String::New 支持 char16_t* 重载，Windows wchar_t 即 16 位，直接强转。
  Napi::Object result = Napi::Object::New(env);
  size_t pos = 0;
  while (pos < block.size()) {
    size_t start = pos;                       // entry 起点
    size_t end = block.find(L'\0', start);    // entry 末尾 '\0' 的位置
    if (end == std::wstring::npos || end == start) break; // 无结尾或空 entry（双 \0 终止）
    const wchar_t* entry = block.data() + start;
    size_t len = end - start;
    pos = end + 1;
    size_t eq = block.find(L'=', start);      // 在 entry 内找 '='
    if (eq == std::wstring::npos || eq >= end) continue;    // entry 内无 '='
    if (eq == start) continue;                // 首字符为 '=' 的隐藏变量，跳过
    size_t keyLen = eq - start;
    size_t valLen = len - keyLen - 1;
    result.Set(
      Napi::String::New(env, (const char16_t*)entry, keyLen),
      Napi::String::New(env, (const char16_t*)(entry + keyLen + 1), valLen));
  }
  return result;
}
