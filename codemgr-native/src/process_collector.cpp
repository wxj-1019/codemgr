#include "process_collector.h"

#include <windows.h>

#include <cstring>
#include <string>
#include <vector>

// ----------------------------------------------------------------------------
// 不包含 <winternl.h>：它声明了最小版 SYSTEM_PROCESS_INFORMATION（仅 3 字段），
// 与本文件下面完整的 _SYSTEM_PROCESS_INFORMATION 定义会冲突（重复定义）。
// 因此这里自行前向声明所需符号：
//   - NtQuerySystemInformation（ntdll.dll 导出）
//   - SYSTEM_PROCESS_INFORMATION（完整字段，参照 phnt/ntexapi.h）
// UNICODE_STRING / LARGE_INTEGER / NTSTATUS / ULONG 等均由 <windows.h> 提供。
// ----------------------------------------------------------------------------

// <windows.h> 不定义 NTSTATUS（它在 <winternl.h>，但我们刻意不引入该头以
// 避免 SYSTEM_PROCESS_INFORMATION 重复定义）。这里自行定义。
#ifndef _NTSTATUS_DEFINED
typedef LONG NTSTATUS;
#define _NTSTATUS_DEFINED
#endif

// UNICODE_STRING 同样不在用户态 <windows.h> 中（属 NT/内核结构），自行定义。
// 布局与 <winternl.h> / <ntdef.h> 完全一致。
#ifndef _UNICODE_STRING_DEFINED
typedef struct _MY_UNICODE_STRING {
  USHORT Length;        // 字节数（不含终止符）
  USHORT MaximumLength;
  PWSTR Buffer;
} MY_UNICODE_STRING, *PMY_UNICODE_STRING;
#define _UNICODE_STRING_DEFINED
#endif

// KPRIORITY（线程/进程基本优先级）也不在用户态 <windows.h>，自行定义。
#ifndef _KPRIORITY_DEFINED
typedef LONG KPRIORITY;
#define _KPRIORITY_DEFINED
#endif

#ifndef STATUS_INFO_LENGTH_MISMATCH
#define STATUS_INFO_LENGTH_MISMATCH ((NTSTATUS)0xC0000004L)
#endif

// SystemInformationClass = 5 → SystemProcessInformation
static constexpr ULONG SystemProcessInformationClass = 5;

extern "C" {

// ntdll 导出的未文档化系统信息查询函数
typedef NTSTATUS(NTAPI* pNtQuerySystemInformation)(
    ULONG SystemInformationClass,
    PVOID SystemInformation,
    ULONG SystemInformationLength,
    PULONG ReturnLength);

}  // extern "C"

// 完整的 SYSTEM_PROCESS_INFORMATION，字段顺序严格匹配 NT 内核布局
// （phnt/ntexapi.h / ntDoc.m417z.com 验证）。
// 注意：不包含尾部 Threads[] 数组 —— 我们从不遍历线程，进程记录间跳转依赖
// NextEntryOffset（而非结构体总大小），因此截断尾部不影响前序字段偏移，
// 亦无需引入仅内核态可用的 KWAIT_REASON / SYSTEM_THREAD_INFORMATION。
typedef struct _MY_SYSTEM_PROCESS_INFORMATION {
  ULONG NextEntryOffset;            // 0 = 链表最后一项
  ULONG NumberOfThreads;
  ULONGLONG WorkingSetPrivateSize;
  ULONG HardFaultCount;
  ULONG NumberOfThreadsHighWatermark;
  ULONGLONG CycleTime;
  LARGE_INTEGER CreateTime;
  LARGE_INTEGER UserTime;
  LARGE_INTEGER KernelTime;
  MY_UNICODE_STRING ImageName;
  KPRIORITY BasePriority;
  HANDLE UniqueProcessId;           // 进程 PID（Idle = 0）
  HANDLE InheritedFromUniqueProcessId;  // 父进程 PID
  ULONG HandleCount;
  ULONG SessionId;
  ULONG_PTR UniqueProcessKey;
  SIZE_T PeakVirtualSize;
  SIZE_T VirtualSize;
  ULONG PageFaultCount;
  SIZE_T PeakWorkingSetSize;
  SIZE_T WorkingSetSize;
  SIZE_T QuotaPeakPagedPoolUsage;
  SIZE_T QuotaPagedPoolUsage;
  SIZE_T QuotaPeakNonPagedPoolUsage;
  SIZE_T QuotaNonPagedPoolUsage;
  SIZE_T PagefileUsage;
  SIZE_T PeakPagefileUsage;
  SIZE_T PrivatePageCount;
  LARGE_INTEGER ReadOperationCount;
  LARGE_INTEGER WriteOperationCount;
  LARGE_INTEGER OtherOperationCount;
  LARGE_INTEGER ReadTransferCount;
  LARGE_INTEGER WriteTransferCount;
  LARGE_INTEGER OtherTransferCount;
} MY_SYSTEM_PROCESS_INFORMATION, *PMY_SYSTEM_PROCESS_INFORMATION;

// Windows FILETIME（1601-01-01 起，100ns 单位）→ Unix epoch 毫秒
static inline long long FileTimeToEpochMs(LONGLONG fileTime100ns) {
  // 116444736000000000 = 1601→1970 的 100ns 间隔数；/10000 → 毫秒
  return (fileTime100ns - 116444736000000000LL) / 10000LL;
}

// UTF-16 → UTF-8。UNICODE_STRING.Length 单位是字节（= 字符数 * 2）
static inline std::string UnicodeToUtf8(const MY_UNICODE_STRING& u) {
  if (u.Buffer == nullptr || u.Length == 0) return std::string();
  int charCount = u.Length / 2;  // 字节数 → UTF-16 码元数
  if (charCount <= 0) return std::string();
  // 先查询所需字节数
  int len = WideCharToMultiByte(CP_UTF8, 0, u.Buffer, charCount,
                                nullptr, 0, nullptr, nullptr);
  if (len <= 0) return std::string();
  std::string out(static_cast<size_t>(len), '\0');
  WideCharToMultiByte(CP_UTF8, 0, u.Buffer, charCount, &out[0], len,
                      nullptr, nullptr);
  return out;
}

// ---------------------------------------------------------------------------
// ReadProcessCmdline — 通过 PEB 读取进程命令行
// 流程：OpenProcess → NtQueryInformationProcess(ProcessBasicInformation)
//       → PEB → ProcessParameters → CommandLine UNICODE_STRING
// ---------------------------------------------------------------------------

// PROCESS_BASIC_INFORMATION for NtQueryInformationProcess (class = 0)
typedef struct _MY_PROCESS_BASIC_INFORMATION {
    NTSTATUS ExitStatus;
    PVOID PebBaseAddress;
    ULONG_PTR AffinityMask;
    KPRIORITY BasePriority;
    ULONG_PTR UniqueProcessId;
    ULONG_PTR InheritedFromUniqueProcessId;
} MY_PROCESS_BASIC_INFORMATION;

static constexpr ULONG ProcessBasicInformationClass = 0;

typedef NTSTATUS (NTAPI *pNtQueryInformationProcess_t)(
    HANDLE ProcessHandle,
    ULONG ProcessInformationClass,
    PVOID ProcessInformation,
    ULONG ProcessInformationLength,
    PULONG ReturnLength);

typedef NTSTATUS (NTAPI *pNtReadVirtualMemory_t)(
    HANDLE ProcessHandle,
    PVOID BaseAddress,
    PVOID Buffer,
    ULONG NumberOfBytesToRead,
    PULONG NumberOfBytesRead);

static std::wstring ReadProcessCmdline(HANDLE hProcess) {
    // 动态获取 ntdll 导出函数
    static pNtQueryInformationProcess_t NtQIP = nullptr;
    static pNtReadVirtualMemory_t NtRVM = nullptr;
    if (!NtQIP) {
        HMODULE ntdll = GetModuleHandleW(L"ntdll.dll");
        if (!ntdll) return L"";
        NtQIP = reinterpret_cast<pNtQueryInformationProcess_t>(
            GetProcAddress(ntdll, "NtQueryInformationProcess"));
        NtRVM = reinterpret_cast<pNtReadVirtualMemory_t>(
            GetProcAddress(ntdll, "NtReadVirtualMemory"));
    }
    if (!NtQIP || !NtRVM) return L"";

    // 1. 获取 PEB 地址
    MY_PROCESS_BASIC_INFORMATION pbi{};
    ULONG retLen = 0;
    NTSTATUS st = NtQIP(hProcess, ProcessBasicInformationClass,
                        &pbi, sizeof(pbi), &retLen);
    if (st < 0 || !pbi.PebBaseAddress) return L"";

    // 2. 读取 PEB（前 256 字节，覆盖到 ProcessParameters 之后）
    BYTE peb[256] = {};
    ULONG nread = 0;
    st = NtRVM(hProcess, pbi.PebBaseAddress, peb, sizeof(peb), &nread);
    if (st < 0) return L"";

    // 3. ProcessParameters 在 x64 PEB 中偏移为 0x20（稳定 ABI）
    ULONG_PTR pp = *(ULONG_PTR*)(peb + 0x20);
    if (!pp) return L"";

    // 4. 读取 RTL_USER_PROCESS_PARAMETERS（512 字节足够覆盖所有字段）
    BYTE par[512] = {};
    st = NtRVM(hProcess, (PVOID)pp, par, sizeof(par), &nread);
    if (st < 0) return L"";

    // 5. 定位 CommandLine UNICODE_STRING。
    //    RTL_USER_PROCESS_PARAMETERS 中 CommandLine 偏移因版本而异：
    //      Win10 1607–21H2: 0x60
    //      Win11 22000+:    0x70
    //    UNICODE_STRING(x64) = { USHORT Length(2) + USHORT MaxLen(2)
    //                            + 4B padding + PWSTR Buffer(8) } = 16B
    //    Buffer 字段在 UNICODE_STRING 起始 +8 处。
    //    试探一组常见偏移，通过 Length/Buffer 合法性筛选。
    static const ULONG_PTR offsets[] = { 0x60, 0x68, 0x70, 0x78 };
    for (auto off : offsets) {
        if (off + 16 > sizeof(par)) break;
        USHORT len = *(USHORT*)(par + off);
        ULONG_PTR buf = *(ULONG_PTR*)(par + off + 8);
        // Length 非零、偶数、<32KB，且 Buffer 指向用户态地址
        if (len > 0 && len < 32768 && (len & 1) == 0 && buf >= 0x10000) {
            ULONG cb = len < 4096 ? (ULONG)len : (ULONG)4096;
            std::vector<WCHAR> cmd(cb / 2 + 1, 0);
            st = NtRVM(hProcess, (PVOID)buf, cmd.data(), cb, &nread);
            if (st >= 0 && nread > 0) {
                cmd[nread / 2] = L'\0';
                return std::wstring(cmd.data());
            }
        }
    }
    return L"";
}

bool CollectAllProcesses(std::vector<ProcessInfoRaw>& out, std::string& errMessage) {
  out.clear();

  // 动态获取 NtQuerySystemInformation
  HMODULE ntdll = GetModuleHandleW(L"ntdll.dll");
  if (ntdll == nullptr) {
    errMessage = "GetModuleHandleW(ntdll.dll) failed";
    return false;
  }
  auto NtQuerySystemInformation = reinterpret_cast<pNtQuerySystemInformation>(
      GetProcAddress(ntdll, "NtQuerySystemInformation"));
  if (NtQuerySystemInformation == nullptr) {
    errMessage = "GetProcAddress(NtQuerySystemInformation) failed";
    return false;
  }

  // 缓冲区从小开始，遇 INFO_LENGTH_MISMATCH 倍增
  ULONG bufSize = 1024 * 256;  // 256 KB 起步
  std::vector<unsigned char> buffer(bufSize);

  NTSTATUS status;
  ULONG returnLength = 0;
  for (int attempt = 0; attempt < 8; ++attempt) {
    status = NtQuerySystemInformation(SystemProcessInformationClass,
                                     buffer.data(),
                                     static_cast<ULONG>(buffer.size()),
                                     &returnLength);
    if (status == STATUS_INFO_LENGTH_MISMATCH) {
      // 倍增（至少按内核报告的 returnLength）
      ULONG newSize = static_cast<ULONG>(buffer.size()) * 2;
      if (returnLength > newSize) newSize = returnLength + 0x1000;
      buffer.resize(newSize);
      continue;
    }
    break;
  }

  if (status != 0) {  // NT_SUCCESS 等价于 status >= 0
    errMessage = "NtQuerySystemInformation failed: NTSTATUS=0x" +
                 std::to_string(static_cast<unsigned long>(status));
    return false;
  }

  // 遍历 NextEntryOffset 链表
  unsigned char* base = buffer.data();
  ULONG offset = 0;
  while (true) {
    auto* p = reinterpret_cast<PMY_SYSTEM_PROCESS_INFORMATION>(base + offset);

    ProcessInfoRaw info{};
    info.pid = static_cast<ULONG>(reinterpret_cast<ULONG_PTR>(p->UniqueProcessId));
    info.ppid = static_cast<ULONG>(
        reinterpret_cast<ULONG_PTR>(p->InheritedFromUniqueProcessId));
    info.name = UnicodeToUtf8(p->ImageName);
    // Idle 进程（pid 0）的 ImageName 通常为空，规范化为 "Idle"
    if (info.pid == 0 && info.name.empty()) {
      info.name = "Idle";
    }
	    // 读取命令行（v0.2 — 需要打开进程句柄）
	    if (info.pid > 0) {  // 跳过 Idle（pid=0）
	        HANDLE hProc = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ,
	                                   FALSE, info.pid);
	        if (hProc) {
	            std::wstring cmd = ReadProcessCmdline(hProc);
	            if (!cmd.empty()) {
	                int utf8Len = WideCharToMultiByte(CP_UTF8, 0, cmd.c_str(), -1,
	                                                  nullptr, 0, nullptr, nullptr);
	                if (utf8Len > 1) {
	                    info.cmdline.resize(utf8Len - 1);
	                    WideCharToMultiByte(CP_UTF8, 0, cmd.c_str(), -1,
	                                        &info.cmdline[0], utf8Len, nullptr, nullptr);
	                }
	            }
	            CloseHandle(hProc);
	        }
	    }
	    // 对打不开的进程，cmdline 保持默认空字符串
    info.kernelTimeMs = p->KernelTime.QuadPart / 10000LL;
    info.userTimeMs = p->UserTime.QuadPart / 10000LL;
    info.workingSetBytes = static_cast<long long>(p->WorkingSetSize);
    info.createTimeMs = FileTimeToEpochMs(p->CreateTime.QuadPart);
    info.threadCount = p->NumberOfThreads;
    info.handleCount = p->HandleCount;

    out.push_back(std::move(info));

    if (p->NextEntryOffset == 0) break;
    offset += p->NextEntryOffset;
    // 安全边界：避免越界
    if (offset >= buffer.size()) break;
  }

  return true;
}

Napi::Value ProcessScan(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  std::vector<ProcessInfoRaw> procs;
  std::string err;
  if (!CollectAllProcesses(procs, err)) {
    Napi::TypeError::New(env, "processScan failed: " + err)
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  Napi::Array result = Napi::Array::New(env, procs.size());
  for (size_t i = 0; i < procs.size(); ++i) {
    const ProcessInfoRaw& p = procs[i];
    Napi::Object obj = Napi::Object::New(env);
    obj.Set("pid", Napi::Number::New(env, static_cast<double>(p.pid)));
    obj.Set("ppid", Napi::Number::New(env, static_cast<double>(p.ppid)));
    obj.Set("name", Napi::String::New(env, p.name));
    obj.Set("cmdline", Napi::String::New(env, p.cmdline));
    obj.Set("kernelTimeMs", Napi::Number::New(env, static_cast<double>(p.kernelTimeMs)));
    obj.Set("userTimeMs", Napi::Number::New(env, static_cast<double>(p.userTimeMs)));
    obj.Set("workingSetBytes", Napi::Number::New(env, static_cast<double>(p.workingSetBytes)));
    obj.Set("createTimeMs", Napi::Number::New(env, static_cast<double>(p.createTimeMs)));
    obj.Set("threadCount", Napi::Number::New(env, static_cast<double>(p.threadCount)));
    obj.Set("handleCount", Napi::Number::New(env, static_cast<double>(p.handleCount)));
    result[static_cast<uint32_t>(i)] = obj;
  }

  return result;
}
