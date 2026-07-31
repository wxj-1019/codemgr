import { describe, it, expect, beforeEach } from 'vitest';
import { useStartupStore } from '../src/store/startupStore';
import { useToastStore, __resetToastStoreForTests } from '../src/store/toastStore';
import type { StartupItem } from '../electron/ipc-types';

const item: StartupItem = { id: 'hkcu:A', name: 'A', command: 'C:\\a.exe', source: 'hkcu-run', enabled: true };

function mockApi(impl: Partial<{ listStartupItems: () => Promise<StartupItem[]>; setStartupItemEnabled: (id: string, en: boolean) => Promise<string> }>) {
  Object.defineProperty(window, 'codemgr', { value: impl, writable: true, configurable: true });
}

beforeEach(() => {
  __resetToastStoreForTests();
  useStartupStore.setState({ items: [], loading: false, error: null, toggling: new Set() });
});

describe('startupStore', () => {
  it('refresh 成功写入 items；失败进 error', async () => {
    mockApi({ listStartupItems: async () => [item] });
    await useStartupStore.getState().refresh();
    expect(useStartupStore.getState().items).toEqual([item]);
    mockApi({ listStartupItems: async () => { throw new Error('x'); } });
    await useStartupStore.getState().refresh();
    expect(useStartupStore.getState().error).toBeTruthy();
  });

  it('toggle 乐观翻转，成功保持；失败回滚并 toast', async () => {
    // 模拟真实 main：toggle 成功后重采应返回新状态
    let current: StartupItem[] = [item];
    mockApi({
      listStartupItems: async () => current,
      setStartupItemEnabled: async () => { current = [{ ...item, enabled: false }]; return ''; },
    });
    await useStartupStore.getState().refresh();
    await useStartupStore.getState().toggle('hkcu:A');
    expect(useStartupStore.getState().items[0]!.enabled).toBe(false);

    mockApi({
      listStartupItems: async () => [item],
      setStartupItemEnabled: async () => '拒绝访问',
    });
    await useStartupStore.getState().refresh();
    await useStartupStore.getState().toggle('hkcu:A');
    expect(useStartupStore.getState().items[0]!.enabled).toBe(true); // 回滚
    expect(useToastStore.getState().toasts.some((t) => t.message.includes('拒绝访问'))).toBe(true);
  });
});
