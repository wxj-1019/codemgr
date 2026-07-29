#include "disk_collector.h"
#include <windows.h>
#include <string>
#include <vector>

// 把 GetDriveTypeW 的数值返回映射成可读字符串（与 spec 的 type 字段对齐）。
static const char* DriveTypeName(UINT t) {
  switch (t) {
    case DRIVE_FIXED:     return "fixed";      // 硬盘
    case DRIVE_REMOVABLE: return "removable";  // 软盘/U 盘
    case DRIVE_CDROM:     return "cdrom";      // 光驱
    case DRIVE_REMOTE:    return "network";    // 网络盘
    case DRIVE_RAMDISK:   return "ram";        // RAM 盘
    default:              return "unknown";    // DRIVE_NO_ROOT_DIR / 未知
  }
}

// 解析 GetLogicalDriveStringsW 返回的双 null 终止字符串列表，切成单个卷路径（如 "C:\"）。
static std::vector<std::wstring> SplitDriveStrings(const std::wstring& s) {
  std::vector<std::wstring> out;
  size_t i = 0;
  while (i < s.size()) {
    std::wstring entry(&s[i]);
    if (entry.empty()) break;
    out.push_back(entry);
    i += entry.size() + 1;  // 跳过末尾 null
  }
  return out;
}

Napi::Value DiskVolumes(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  // GetLogicalDriveStringsW：缓冲区装双 null 终止的卷路径列表。先查所需长度再分配。
  DWORD len = GetLogicalDriveStringsW(0, nullptr);
  if (len == 0) {
    DWORD gle = GetLastError();
    Napi::Error::New(env, "GetLogicalDriveStringsW(length query) failed gle=" +
                          std::to_string(gle)).ThrowAsJavaScriptException();
    return env.Null();
  }
  std::wstring buf(len, L'\0');
  DWORD written = GetLogicalDriveStringsW(len, buf.data());
  if (written == 0) {
    DWORD gle = GetLastError();
    Napi::Error::New(env, "GetLogicalDriveStringsW failed gle=" +
                          std::to_string(gle)).ThrowAsJavaScriptException();
    return env.Null();
  }
  buf.resize(written);  // 去掉尾部多余 null

  const auto volumes = SplitDriveStrings(buf);
  std::vector<Napi::Object> objs;
  objs.reserve(volumes.size());

  for (const auto& vol : volumes) {
    UINT driveType = GetDriveTypeW(vol.c_str());
    // GetDiskFreeSpaceExW：单卷可能失败（如未插入的可移动盘、不可达网络盘）。
    // 失败时空间字段置 0，不跳过该卷（仍返回盘符/类型）。
    ULARGE_INTEGER avail = {0}, total = {0}, free = {0};
    GetDiskFreeSpaceExW(vol.c_str(), &avail, &total, &free);

    Napi::Object obj = Napi::Object::New(env);
    obj.Set("letter", Napi::String::New(env, (const char16_t*)vol.c_str(), vol.size()));
    obj.Set("type", Napi::String::New(env, DriveTypeName(driveType)));
    obj.Set("totalBytes", Napi::Number::New(env, (double)total.QuadPart));
    obj.Set("freeBytes", Napi::Number::New(env, (double)free.QuadPart));
    obj.Set("availableBytes", Napi::Number::New(env, (double)avail.QuadPart));
    objs.push_back(obj);
  }

  Napi::Array result = Napi::Array::New(env, objs.size());
  for (size_t i = 0; i < objs.size(); i++) {
    result.Set((uint32_t)i, objs[i]);
  }
  return result;
}
