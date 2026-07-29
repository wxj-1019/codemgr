import { describe, it, expect } from 'vitest';
import native from '../index';

describe('readProcessEnv', () => {
  it('reads env of the current process (PATH must exist)', () => {
    const env = native.readProcessEnv(process.pid);
    expect(typeof env).toBe('object');
    const keys = Object.keys(env);
    expect(keys.length).toBeGreaterThan(10);
    expect(keys.some((k) => k.toUpperCase() === 'PATH')).toBe(true);
  });

  it('skips hidden entries like =C:= (drive-letter vars)', () => {
    const env = native.readProcessEnv(process.pid);
    for (const k of Object.keys(env)) {
      expect(k.startsWith('=')).toBe(false);
    }
  });

  it('throws for a non-existent pid', () => {
    expect(() => native.readProcessEnv(0x7ffffff0)).toThrow();
  });
});
