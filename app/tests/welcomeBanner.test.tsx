import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WelcomeBanner } from '../src/components/workspace/WelcomeBanner';

describe('WelcomeBanner（UX-08 首启引导）', () => {
  it('渲染引导文案（点出 8 面板与侧栏入口）', () => {
    render(<WelcomeBanner onClose={() => {}} />);
    expect(screen.getByText(/欢迎使用 CodeMgr/)).toBeInTheDocument();
    expect(screen.getByText(/首页 \/ 性能 \/ 进程 \/ 端口雷达 \/ 启动项 \/ 快照 \/ AI 会话 \/ 运行配置/)).toBeInTheDocument();
  });

  it('关闭按钮触发 onClose', () => {
    const onClose = vi.fn();
    render(<WelcomeBanner onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: '关闭欢迎提示' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
