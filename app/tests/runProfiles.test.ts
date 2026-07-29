import { describe, it, expect } from 'vitest';
import { validateProfile, RUN_COMMAND_WHITELIST } from '../electron/runProfiles';

const valid = {
  id: '11111111-2222-3333-4444-555555555555',
  name: '前端',
  command: 'pnpm',
  args: ['dev'],
  cwd: 'E:\\repo\\app',
};

describe('RUN_COMMAND_WHITELIST', () => {
  it('contains common dev executables', () => {
    expect(RUN_COMMAND_WHITELIST.has('node')).toBe(true);
    expect(RUN_COMMAND_WHITELIST.has('pnpm')).toBe(true);
    expect(RUN_COMMAND_WHITELIST.has('npm')).toBe(true);
    expect(RUN_COMMAND_WHITELIST.has('python')).toBe(true);
    expect(RUN_COMMAND_WHITELIST.has('git')).toBe(true);
  });
  it('excludes dangerous executables', () => {
    expect(RUN_COMMAND_WHITELIST.has('calc')).toBe(false);
    expect(RUN_COMMAND_WHITELIST.has('cmd')).toBe(false);
    expect(RUN_COMMAND_WHITELIST.has('powershell')).toBe(false);
  });
});

describe('validateProfile', () => {
  it('accepts a valid profile', () => {
    const p = validateProfile(valid);
    expect(p).not.toBeNull();
    expect(p!.command).toBe('pnpm');
  });

  it('rejects non-whitelist command', () => {
    expect(validateProfile({ ...valid, command: 'calc' })).toBeNull();
  });

  it('rejects relative cwd', () => {
    expect(validateProfile({ ...valid, cwd: 'relative/path' })).toBeNull();
  });

  it('rejects non-array args', () => {
    expect(validateProfile({ ...valid, args: 'dev' as unknown as string[] })).toBeNull();
  });

  it('rejects empty name', () => {
    expect(validateProfile({ ...valid, name: '' })).toBeNull();
  });

  it('rejects non-object', () => {
    expect(validateProfile(null)).toBeNull();
    expect(validateProfile('x')).toBeNull();
  });

  it('preserves optional expectedPorts', () => {
    const p = validateProfile({ ...valid, expectedPorts: [5173, 3000] });
    expect(p!.expectedPorts).toEqual([5173, 3000]);
  });
});
