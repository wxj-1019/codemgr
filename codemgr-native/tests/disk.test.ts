import { describe, it, expect } from 'vitest';
import native from '../index';

describe('diskVolumes', () => {
  it('returns an array', () => {
    const vols = native.diskVolumes();
    expect(Array.isArray(vols)).toBe(true);
  });

  it('includes at least C:\\ (system drive always present on Windows)', () => {
    const vols = native.diskVolumes();
    expect(vols.some((v) => v.letter.toUpperCase().startsWith('C:'))).toBe(true);
  });

  it('each volume has valid field types', () => {
    const vols = native.diskVolumes();
    for (const v of vols) {
      expect(typeof v.letter).toBe('string');
      expect(v.letter.length).toBeGreaterThan(0);
      expect(typeof v.type).toBe('string');
      expect(typeof v.totalBytes).toBe('number');
      expect(typeof v.freeBytes).toBe('number');
      expect(typeof v.availableBytes).toBe('number');
    }
  });

  it('type is a known drive-type value', () => {
    const known = ['fixed', 'removable', 'cdrom', 'network', 'ram', 'unknown'];
    const vols = native.diskVolumes();
    for (const v of vols) {
      expect(known).toContain(v.type);
    }
  });

  it('fixed drives have totalBytes >= freeBytes', () => {
    const vols = native.diskVolumes();
    for (const v of vols) {
      if (v.type === 'fixed') {
        expect(v.totalBytes).toBeGreaterThanOrEqual(v.freeBytes);
      }
    }
  });
});
