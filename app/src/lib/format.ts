// 渲染层通用格式化纯函数（无副作用，便于 TDD）。

// 将字节/秒速率格式化为带合适单位的可读字符串。
// 阈值：1024 B = 1 KB, 1024 KB = 1 MB, 1024 MB = 1 GB。
export function formatBytesPerSec(bytesPerSec: number): string {
  if (bytesPerSec >= 1073741824) return (bytesPerSec / 1073741824).toFixed(1) + ' GB/s';
  if (bytesPerSec >= 1048576) return (bytesPerSec / 1048576).toFixed(1) + ' MB/s';
  if (bytesPerSec >= 1024) return (bytesPerSec / 1024).toFixed(1) + ' KB/s';
  return bytesPerSec.toFixed(0) + ' B/s';
}

// 将字节数格式化为带合适单位的可读字符串（不带 "/s" 后缀）。
// 用于进程详情侧栏的内存、磁盘容量等"瞬时量"展示。
export function formatBytes(bytes: number): string {
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB';
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return bytes + ' B';
}

// 将毫秒数格式化为人类可读的运行时长（天/时/分/秒）。
// 用于进程详情侧栏的"运行时长"。
export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (days > 0) return `${days} 天${hours > 0 ? ' ' + hours + ' 时' : ''}`;
  if (hours > 0) return `${hours} 时 ${mins} 分`;
  if (mins > 0) return `${mins} 分 ${secs} 秒`;
  return `${secs} 秒`;
}

// 将毫秒数格式化为累计 CPU 时间（毫秒/秒.十分之一/分:秒）。
// 用于进程详情侧栏的"累计 CPU 时间"（kernel + user 之和）。
export function formatCpuTime(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} 毫秒`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} 秒`;
  const mins = Math.floor(s / 60);
  const secs = Math.round(s % 60);
  return `${mins} 分 ${secs} 秒`;
}
