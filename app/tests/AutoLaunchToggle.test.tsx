import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AutoLaunchToggle } from '../src/components/AutoLaunchToggle';

// 只 mock 本组件用到的两个方法（其余 ExposedApi 方法组件不触碰）
function mockAutoLaunch(opts: {
  initial: boolean;
  set?: (enabled: boolean) => Promise<boolean>;
}) {
  const api = {
    getAutoLaunch: vi.fn(() => Promise.resolve(opts.initial)),
    setAutoLaunch: vi.fn(opts.set ?? ((enabled: boolean) => Promise.resolve(enabled))),
  };
  Object.defineProperty(window, 'codemgr', {
    value: api,
    writable: true,
    configurable: true,
  });
  return api;
}

function getSwitch() {
  return screen.getByRole('switch', { name: '开机自启' });
}

describe('AutoLaunchToggle', () => {
  it('挂载时从 getAutoLaunch 读取初始状态（开启）', async () => {
    mockAutoLaunch({ initial: true });
    render(<AutoLaunchToggle />);
    await waitFor(() => expect(getSwitch()).toHaveAttribute('aria-checked', 'true'));
  });

  it('挂载时从 getAutoLaunch 读取初始状态（关闭）', async () => {
    mockAutoLaunch({ initial: false });
    render(<AutoLaunchToggle />);
    await waitFor(() => expect(getSwitch()).toHaveAttribute('aria-checked', 'false'));
  });

  it('点击切换调用 setAutoLaunch 并采用返回的实际状态', async () => {
    const api = mockAutoLaunch({ initial: false });
    render(<AutoLaunchToggle />);
    await waitFor(() => expect(getSwitch()).toHaveAttribute('aria-checked', 'false'));
    fireEvent.click(getSwitch());
    await waitFor(() => expect(getSwitch()).toHaveAttribute('aria-checked', 'true'));
    expect(api.setAutoLaunch).toHaveBeenCalledWith(true);
  });

  it('setAutoLaunch 返回的实际状态与请求不符时以实际状态为准（回滚）', async () => {
    // main 侧 setLoginItemSettings 失败，返回的仍是 false
    mockAutoLaunch({ initial: false, set: () => Promise.resolve(false) });
    render(<AutoLaunchToggle />);
    await waitFor(() => expect(getSwitch()).toHaveAttribute('aria-checked', 'false'));
    fireEvent.click(getSwitch());
    await waitFor(() => expect(getSwitch()).toHaveAttribute('aria-checked', 'false'));
  });

  it('setAutoLaunch 抛错时回滚 UI 状态', async () => {
    mockAutoLaunch({ initial: false, set: () => Promise.reject(new Error('ipc failed')) });
    render(<AutoLaunchToggle />);
    await waitFor(() => expect(getSwitch()).toHaveAttribute('aria-checked', 'false'));
    fireEvent.click(getSwitch());
    await waitFor(() => expect(getSwitch()).toHaveAttribute('aria-checked', 'false'));
  });
});
