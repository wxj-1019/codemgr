import { describe, it, expect } from 'vitest';
import { formatBytesPerSec } from '../src/lib/format';

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
