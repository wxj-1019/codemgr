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
// ReadProcessCmdline — 通过官方 API 读取进程命令行
// 流程：OpenProcess → NtQueryInformationProcess(ProcessCommandLineInformation)
//       直接返回 { UNICODE_STRING Commandline; WCHAR Buffer[]; }
// ---------------------------------------------------------------------------

typedef NTSTATUS (NTAPI *pNtQueryInformationProcess_t)(
    HANDLE ProcessHandle,
    ULONG ProcessInformationClass,
    PVOID ProcessInformation,
    ULONG ProcessInformationLength,
    PULONG ReturnLength);

// ProcessCommandLineInformation (class = 60)
// 微软文档化的命令行查询类（Win 8.1+）。返回结构布局：
//   struct { UNICODE_STRING Commandline; WCHAR Buffer[ANYSIZE_ARRAY]; }
// 即首部一个 16 字节的 UNICODE_STRING 头（Length/MaxLength/Buffer），
// 紧跟宽字符命令行数据。关键点：Commandline.Buffer 指向【同一返回缓冲内部】
// （头之后），而非目标进程地址空间 —— 因此读完后无需再 NtReadVirtualMemory。
// 相比旧 PEB 偏移试探（{0x60,0x68,0x70,0x78}，x64 上 0x60 命中 ImagePathName
// 导致 96% 进程只拿到 exe 路径），本 API 语义明确、稳定。
static constexpr ULONG ProcessCommandLineInformationClass = 60;

static std::wstring ReadProcessCmdline(HANDLE hProcess) {
    // 用官方 API ProcessCommandLineInformation (class 60)，直接返回命令行 UNICODE_STRING。
    // 比 PEB 偏移试探稳：微软保证语义，不依赖未文档化布局。
    static pNtQueryInformationProcess_t NtQIP = nullptr;
    if (!NtQIP) {
        HMODULE ntdll = GetModuleHandleW(L"ntdll.dll");
        if (!ntdll) return L"";
        NtQIP = reinterpret_cast<pNtQueryInformationProcess_t>(
            GetProcAddress(ntdll, "NtQueryInformationProcess"));
    }
    if (!NtQIP) return L"";

    // 先查所需长度
    ULONG returnLen = 0;
    NTSTATUS st = NtQIP(hProcess, ProcessCommandLineInformationClass,
                        nullptr, 0, &returnLen);
    if (returnLen == 0) return L"";

    std::vector<BYTE> buf(returnLen);
    st = NtQIP(hProcess, ProcessCommandLineInformationClass,
               buf.data(), returnLen, &returnLen);
    if (st < 0) return L"";

    // 首 16 字节是 UNICODE_STRING 头：
    //   { USHORT Length; USHORT MaxLength; [4B pad]; PWSTR Buffer; }
    // 对 ProcessCommandLineInformation，Buffer 指针指向【本调用返回缓冲内部】
    // （头之后），而非跨进程地址 —— 故直接读 buf，无需 NtReadVirtualMemory。
    MY_UNICODE_STRING* u = reinterpret_cast<MY_UNICODE_STRING*>(buf.data());
    if (u->Length == 0 || u->Buffer == nullptr) return L"";

    size_t charCount = u->Length / 2;
    if (charCount == 0) return L"";

    // 数据紧随 UNICODE_STRING 头（x64 上 16 字节）之后。
    const size_t headerBytes = sizeof(MY_UNICODE_STRING);  // 16
    const WCHAR* data = reinterpret_cast<const WCHAR*>(buf.data() + headerBytes);

    // 安全校验：数据应落在 buf 范围内。若越界（理论上不该发生），兜底用 Buffer 指针。
    if (headerBytes + charCount * 2 > buf.size()) {
        data = u->Buffer;
    }
    return std::wstring(data, charCount);
}

// ---------------------------------------------------------------------------
// ExtractCwdFromCmdline — 从命令行里启发式推断工作目录（零额外系统调用）
// ---------------------------------------------------------------------------
// 设计取舍（重要）：
// 理想方案是直读 PEB ProcessParameters.CurrentDirectory（offset 0x38，CURDIR
// DosPath），那样能拿到 96% 进程的【真实】cwd。但实测每进程需 1 次 NtQIP +
// 3 次 NtReadVirtualMemory，~360 进程下单次采集 p99 从 ~16ms 升到 ~21ms，
// 超过 20ms 的 Go/No-Go 红线（见 bench/process.bench.ts）。
//
// 因此这里退而求其次：从已读到的 cmdline 字符串里抽取【首个盘符路径】作为
// cwd 近似。命令行已由 ProcessCommandLineInformation(class 60) 零额外读取得
// 到，本函数纯字符串处理，不再产生系统调用 → bench 不回归。
//
// 已知局限（必须知道）：
//   1. 仅当命令行显式包含项目路径时才有效。`node server.js`（相对路径）、
//      `npm run dev` 这类不含绝对路径的命令行 → cwd 为空 → 进程归到「未分组」。
//   2. 抽到的是首个盘符路径，可能是脚本路径而非工作目录本身；这里取其【目录
//      部分】作为分组键——同目录下启动的多个脚本仍能正确归到一组。
//   3. 对开发场景的核心价值成立：dev server / 构建工具常以绝对路径启动
//      （如 IDE 启动的 node、docker 挂载路径），这些是 CodeMgr 最想分组的对象。
//
// 返回推断出的目录（已规范化为去尾部反斜杠的盘符路径），无匹配返回空串。
// ---------------------------------------------------------------------------
static std::wstring ExtractCwdFromCmdline(const std::wstring& cmdline) {
    if (cmdline.empty()) return L"";
    // 扫描首个 "盘符:\" 形态（如 C:\），这是 Windows 绝对路径的可靠标志。
    for (size_t i = 0; i + 2 < cmdline.size(); ++i) {
        wchar_t c0 = cmdline[i];
        // 盘符：A-Z / a-z
        bool isDrive = (c0 >= L'a' && c0 <= L'z') || (c0 >= L'A' && c0 <= L'Z');
        if (!isDrive) continue;
        if (cmdline[i + 1] != L':') continue;
        if (cmdline[i + 2] != L'\\') continue;

        // 找到绝对路径起点 i。向后延展到路径末尾：兼容 \ / 两种分隔符，并在
        // 引号/空白处终止。我们取到路径末尾，再去掉最后一段（文件名/参数），
        // 保留目录部分作为分组键——这样同目录下不同脚本能归到同一组。
        size_t end = i + 3;
        while (end < cmdline.size()) {
            wchar_t ch = cmdline[end];
            if (ch == L'"' || ch == L' ' || ch == L'\t') break;
            ++end;
        }
        std::wstring path = cmdline.substr(i, end - i);
        // 去掉尾部反斜杠
        while (path.size() > 1 && path.back() == L'\\') path.pop_back();
        // 取目录部分：最后一个分隔符之前。若无分隔符（理论上不会，因为至少有 C:\），
        // 就用整条路径。
        size_t lastSep = std::wstring::npos;
        for (size_t k = path.size(); k > 0; --k) {
            if (path[k - 1] == L'\\' || path[k - 1] == L'/') {
                lastSep = k - 1;
                break;
            }
        }
        // 保留至少 "X:\" —— 不把盘符根当成有意义的项目目录，丢弃。
        if (lastSep == std::wstring::npos || lastSep <= 2) return L"";
        std::wstring dir = path.substr(0, lastSep);
        while (dir.size() > 1 && dir.back() == L'\\') dir.pop_back();
        // 去掉后若只剩盘符根（如 "C:"），视为无效
        if (dir.size() <= 2) return L"";
        return dir;
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
	    // 读取命令行 + 当前工作目录（v0.2 — 需要打开进程句柄）
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
		            // cwd：从命令行启发式抽取首个盘符路径的目录部分（见
		            // ExtractCwdFromCmdline 注释——为不回归 bench 而放弃了 PEB 直读）。
		            // 零额外系统调用：复用已读到的 cmd 字符串。
		            std::wstring cwd = ExtractCwdFromCmdline(cmd);
		            if (!cwd.empty()) {
		                int utf8Len = WideCharToMultiByte(CP_UTF8, 0, cwd.c_str(), -1,
		                                                  nullptr, 0, nullptr, nullptr);
		                if (utf8Len > 1) {
		                    info.cwd.resize(utf8Len - 1);
		                    WideCharToMultiByte(CP_UTF8, 0, cwd.c_str(), -1,
		                                        &info.cwd[0], utf8Len, nullptr, nullptr);
		                }
		            }
	            CloseHandle(hProc);
	        }
	    }
	    // 对打不开的进程，cmdline/cwd 保持默认空字符串
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
    obj.Set("cwd", Napi::String::New(env, p.cwd));
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
