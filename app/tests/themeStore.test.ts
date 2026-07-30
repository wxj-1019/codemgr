import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  document.documentElement.classList.remove('dark', 'light');
});

describe('theme root-class contract', () => {
  it.each(['dark', 'light'] as const)(
    'synchronizes a persisted %s theme before rendering',
    async (theme) => {
      localStorage.setItem('codemgr:theme', JSON.stringify({ state: { theme }, version: 0 }));
      const themeModule = await import('../src/store/themeStore');

      themeModule.initializeTheme();

      expect(themeModule.useThemeStore.getState().theme).toBe(theme);
      expect(document.documentElement.classList.contains(theme)).toBe(true);
      expect(document.documentElement.classList.contains(theme === 'dark' ? 'light' : 'dark')).toBe(false);
    },
  );

  it('initializes the root theme explicitly before createRoot renders', () => {
    const main = readFileSync(resolve(__dirname, '../src/main.tsx'), 'utf8');
    const initializeAt = main.indexOf('initializeTheme();');
    const renderAt = main.indexOf('createRoot(rootEl).render');

    expect(initializeAt).toBeGreaterThan(-1);
    expect(initializeAt).toBeLessThan(renderAt);
  });
});
