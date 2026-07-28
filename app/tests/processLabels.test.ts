import { describe, it, expect } from 'vitest';
import { labelForProcess, type ProcessLabel } from '../src/lib/processLabels';

describe('labelForProcess', () => {
  it('labels npm run dev as dev server', () => {
    const r = labelForProcess('node.exe', 'node /app/node_modules/.bin/vite --port 5173');
    expect(r?.label).toContain('dev server');
    expect(r?.kind).toBe('dev');
  });

  it('labels jest as test', () => {
    const r = labelForProcess('node.exe', 'node --experimental-vm-modules node_modules/jest/bin/jest.js');
    expect(r?.label).toContain('test');
  });

  it('labels vite build as build tool', () => {
    const r = labelForProcess('node.exe', 'node node_modules/vite/bin/vite.js build');
    expect(r?.label).toBe('build task');
  });

  it('labels docker processes', () => {
    const r = labelForProcess('docker.exe', 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe');
    expect(r?.kind).toBe('container');
  });

  it('labels python processes', () => {
    const r = labelForProcess('python.exe', 'python manage.py runserver');
    expect(r?.kind).toBe('dev');
  });

  it('returns null for unrecognized', () => {
    const r = labelForProcess('explorer.exe', 'C:\\WINDOWS\\explorer.exe');
    expect(r).toBeNull();
  });
});
