import { describe, it, expect } from 'vitest';
import { labelForPort, isDevPort, DEV_PORT_HINTS } from '../src/lib/portLabels';

describe('labelForPort', () => {
  it('labels known dev ports', () => {
    expect(labelForPort(3000)).toBe('dev server');
    expect(labelForPort(5173)).toBe('vite');
    expect(labelForPort(8080)).toBe('dev server');
    expect(labelForPort(3306)).toBe('MySQL');
    expect(labelForPort(5432)).toBe('PostgreSQL');
    expect(labelForPort(27017)).toBe('MongoDB');
    expect(labelForPort(6379)).toBe('Redis');
  });

  it('returns null for unknown ports', () => {
    expect(labelForPort(12345)).toBeNull();
    expect(labelForPort(0)).toBeNull();
  });
});

describe('isDevPort', () => {
  it('true for app dev ports', () => {
    expect(isDevPort(3000)).toBe(true);
    expect(isDevPort(5173)).toBe(true);
    expect(isDevPort(8080)).toBe(true);
  });
  it('false for db ports (they are services, not dev servers)', () => {
    expect(isDevPort(3306)).toBe(false);
    expect(isDevPort(5432)).toBe(false);
  });
  it('false for unknown', () => {
    expect(isDevPort(12345)).toBe(false);
  });
});
