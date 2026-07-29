import { describe, it, expect } from 'vitest';
import { formatBytesPerSec, formatDuration, formatCpuTime, formatBytes, formatRelativeTime } from '../src/lib/format';

describe('formatBytesPerSec', () => {
  it('formats bytes', () => {
    expect(formatBytesPerSec(500)).toBe('500 B/s');
  });
  it('formats KB', () => {
    expect(formatBytesPerSec(2048)).toBe('2.0 KB/s');
  });
  it('formats MB', () => {
    expect(formatBytesPerSec(5 * 1048576)).toBe('5.0 MB/s');
  });
  it('formats GB', () => {
    expect(formatBytesPerSec(1.5 * 1073741824)).toBe('1.5 GB/s');
  });
  it('zero', () => {
    expect(formatBytesPerSec(0)).toBe('0 B/s');
  });
});

describe('formatDuration', () => {
  it('formats seconds', () => {
    expect(formatDuration(45 * 1000)).toBe('45 秒');
  });
  it('formats minutes:seconds', () => {
    expect(formatDuration(125 * 1000)).toBe('2 分 5 秒');
  });
  it('formats hours:minutes', () => {
    expect(formatDuration((3 * 3600 + 5 * 60) * 1000)).toBe('3 时 5 分');
  });
  it('formats days', () => {
    expect(formatDuration(2 * 24 * 3600 * 1000)).toBe('2 天');
  });
});

describe('formatCpuTime', () => {
  it('formats ms', () => {
    expect(formatCpuTime(500)).toBe('500 毫秒');
  });
  it('formats seconds', () => {
    expect(formatCpuTime(2500)).toBe('2.5 秒');
  });
  it('formats minutes', () => {
    expect(formatCpuTime(125000)).toBe('2 分 5 秒');
  });
});

describe('formatBytes', () => {
  it('formats MB', () => {
    expect(formatBytes(100 * 1048576)).toBe('100.0 MB');
  });
  it('formats GB', () => {
    expect(formatBytes(2 * 1073741824)).toBe('2.0 GB');
  });
});

describe('formatRelativeTime', () => {
  it('shows seconds ago for < 60s', () => {
    const now = 100_000;
    expect(formatRelativeTime(now - 5_000, now)).toBe('5 秒前');
    expect(formatRelativeTime(now - 59_999, now)).toBe('59 秒前');
  });
  it('shows minutes for >= 60s', () => {
    const now = 100_000;
    expect(formatRelativeTime(now - 120_000, now)).toBe('2 分 0 秒');
    expect(formatRelativeTime(now - 3_600_000, now)).toBe('60 分 0 秒');
  });
  it('defaults nowMs to Date.now when omitted', () => {
    // 只验证不抛错且返回非空字符串（不依赖真实时钟断言具体值）
    const s = formatRelativeTime(Date.now() - 10_000);
    expect(typeof s).toBe('string');
    expect(s.length).toBeGreaterThan(0);
  });
});
