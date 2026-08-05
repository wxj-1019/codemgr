import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CleanupDialog } from '../src/components/CleanupDialog';
import { ToastHost } from '../src/components/ToastHost';
import { useProcessPanelStore } from '../src/store/processPanelStore';
import { useHomeStore } from '../src/store/homeStore';
import { ipc } from '../src/lib/ipc';
import { __resetToastStoreForTests } from '../src/store/toastStore';

beforeEach(() => {
  __resetToastStoreForTests();
  useProcessPanelStore.getState().reset();
  useHomeStore.getState().reset();
  vi.restoreAllMocks();
});

const seed = () => {
  useProcessPanelStore.setState({
    processes: [{ pid: 42, ppid: 0, name: 'node.exe', cmdline: '', cwd: '', kernelTimeMs: 0, userTimeMs: 0, workingSetBytes: 2e9, createTimeMs: 0, threadCount: 1, handleCount: 1 }],
    cpuMap: { 42: 120 },
  } as never);
  useHomeStore.setState({ issues: [{
    id: 'process-cpu:42', rule: 'process-cpu', severity: 'attention',
    title: 'node.exe CPU 占用持续偏高', detail: 'CPU 120%', processId: 42, action: 'locate-process',
  }] } as never);
};

describe('CleanupDialog', () => {
  it('渲染候选清单（默认全选）与确认按钮', () => {
    seed();
    render(<><ToastHost /><CleanupDialog open onOpenChange={vi.fn()} /></>);
    expect(screen.getByText('node.exe')).toBeInTheDocument();
    expect(screen.getByText(/将结束 1 个进程/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('确认调用 killByPids 并 toast 反馈', async () => {
    seed();
    const kill = vi.spyOn(ipc, 'killByPids').mockResolvedValue([{ pid: 42, status: 'killed' }] as never);
    render(<><ToastHost /><CleanupDialog open onOpenChange={vi.fn()} /></>);
    fireEvent.click(screen.getByRole('button', { name: /确认清理/ }));
    expect(kill).toHaveBeenCalledWith([42]);
    expect(await screen.findByText(/已清理 1 个进程/)).toBeInTheDocument();
  });

  it('无候选时确认禁用并提示', () => {
    render(<><ToastHost /><CleanupDialog open onOpenChange={vi.fn()} /></>);
    expect(screen.getByText(/暂无可清理进程/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /确认清理/ })).toBeDisabled();
  });

  it('取消不执行', () => {
    seed();
    const onClose = vi.fn();
    const kill = vi.spyOn(ipc, 'killByPids').mockResolvedValue([] as never);
    render(<><ToastHost /><CleanupDialog open onOpenChange={onClose} /></>);
    fireEvent.click(screen.getByRole('button', { name: /取消/ }));
    expect(kill).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledWith(false);
  });
});
