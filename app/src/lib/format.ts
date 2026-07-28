// 渲染层通用格式化纯函数（无副作用，便于 TDD）。

// 将字节/秒速率格式化为带合适单位的可读字符串。
// 阈值：1024 B = 1 KB, 1024 KB = 1 MB, 1024 MB = 1 GB。
export function formatBytesPerSec(bytesPerSec: number): string {
  if (bytesPerSec >= 1073741824) return (bytesPerSec / 1073741824).toFixed(1) + ' GB/s';
  if (bytesPerSec >= 1048576) return (bytesPerSec / 1048576).toFixed(1) + ' MB/s';
  if (bytesPerSec >= 1024) return (bytesPerSec / 1024).toFixed(1) + ' KB/s';
  return bytesPerSec.toFixed(0) + ' B/s';
}
