import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ContextMenu, type ContextMenuItem } from '../src/components/ContextMenu';

const items: ContextMenuItem[] = [
  { label: '结束进程', danger: true, onSelect: vi.fn() },
  { label: '复制 PID', onSelect: vi.fn() },
  { label: '禁用项', onSelect: vi.fn(), disabled: true },
];

describe('ContextMenu', () => {
  it('open=false 时不渲染', () => {
    const { container } = render(
      <ContextMenu open={false} x={0} y={0} items={items} onClose={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('open 时渲染所有菜单项', () => {
    render(<ContextMenu open={true} x={100} y={100} items={items} onClose={() => {}} />);
    expect(screen.getByText('结束进程')).toBeInTheDocument();
    expect(screen.getByText('复制 PID')).toBeInTheDocument();
    expect(screen.getByText('禁用项')).toBeInTheDocument();
  });

  it('点击菜单项触发 onSelect 并关闭', () => {
    const onClose = vi.fn();
    render(<ContextMenu open={true} x={100} y={100} items={items} onClose={onClose} />);
    fireEvent.click(screen.getByText('复制 PID'));
    expect(items[1].onSelect).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('禁用项不触发 onSelect', () => {
    const onClose = vi.fn();
    render(<ContextMenu open={true} x={100} y={100} items={items} onClose={onClose} />);
    const disabledBtn = screen.getByText('禁用项').closest('button')!;
    expect(disabledBtn).toBeDisabled();
    fireEvent.click(disabledBtn);
    expect(items[2].onSelect).not.toHaveBeenCalled();
    // 禁用按钮的 click 不应触发关闭（被 disabled 拦截）
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Esc 关闭菜单', () => {
    const onClose = vi.fn();
    render(<ContextMenu open={true} x={100} y={100} items={items} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('点击菜单外部关闭', () => {
    const onClose = vi.fn();
    render(<ContextMenu open={true} x={100} y={100} items={items} onClose={onClose} />);
    // mousedown 在菜单外的元素（document body）
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('点击菜单内部不关闭（由 item onClick 处理）', () => {
    const onClose = vi.fn();
    render(<ContextMenu open={true} x={100} y={100} items={items} onClose={onClose} />);
    // mousedown 在菜单项上
    fireEvent.mouseDown(screen.getByText('复制 PID'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('dividerBefore 渲染分隔线', () => {
    const itemsWithDivider: ContextMenuItem[] = [
      { label: 'A', onSelect: vi.fn() },
      { label: 'B', onSelect: vi.fn(), dividerBefore: true },
    ];
    const { container } = render(
      <ContextMenu open={true} x={100} y={100} items={itemsWithDivider} onClose={() => {}} />,
    );
    expect(container.querySelector('hr')).toBeInTheDocument();
  });
});

describe('ContextMenu keyboard navigation', () => {
  const threeItems = (): ContextMenuItem[] => [
    { label: 'A', onSelect: vi.fn() },
    { label: 'B', onSelect: vi.fn() },
    { label: 'C', onSelect: vi.fn() },
  ];
  const mixedItems = (): ContextMenuItem[] => [
    { label: 'A', onSelect: vi.fn() },
    { label: 'B', onSelect: vi.fn(), disabled: true },
    { label: 'C', onSelect: vi.fn() },
  ];
  const menuEl = () => screen.getByRole('menu');

  it('打开时焦点落在第一个可用菜单项', () => {
    render(<ContextMenu open={true} x={0} y={0} items={threeItems()} onClose={() => {}} />);
    expect(screen.getByText('A')).toHaveFocus();
  });

  it('打开时跳过禁用项，焦点落在第一个可用项', () => {
    const items: ContextMenuItem[] = [
      { label: 'X', onSelect: vi.fn(), disabled: true },
      { label: 'Y', onSelect: vi.fn() },
    ];
    render(<ContextMenu open={true} x={0} y={0} items={items} onClose={() => {}} />);
    expect(screen.getByText('Y')).toHaveFocus();
  });

  it('ArrowDown 循环移动焦点并跳过禁用项', () => {
    render(<ContextMenu open={true} x={0} y={0} items={mixedItems()} onClose={() => {}} />);
    // A →（跳过禁用的 B）→ C
    fireEvent.keyDown(menuEl(), { key: 'ArrowDown' });
    expect(screen.getByText('C')).toHaveFocus();
    // C → 回卷到 A
    fireEvent.keyDown(menuEl(), { key: 'ArrowDown' });
    expect(screen.getByText('A')).toHaveFocus();
  });

  it('ArrowUp 从首项循环回末项（跳过禁用）', () => {
    render(<ContextMenu open={true} x={0} y={0} items={mixedItems()} onClose={() => {}} />);
    fireEvent.keyDown(menuEl(), { key: 'ArrowUp' });
    expect(screen.getByText('C')).toHaveFocus();
  });

  it('Home/End 跳到首/末可用项', () => {
    render(<ContextMenu open={true} x={0} y={0} items={mixedItems()} onClose={() => {}} />);
    fireEvent.keyDown(menuEl(), { key: 'End' });
    expect(screen.getByText('C')).toHaveFocus();
    fireEvent.keyDown(menuEl(), { key: 'Home' });
    expect(screen.getByText('A')).toHaveFocus();
  });

  it('Enter 触发焦点菜单项并关闭', () => {
    const onClose = vi.fn();
    const items = threeItems();
    render(<ContextMenu open={true} x={0} y={0} items={items} onClose={onClose} />);
    fireEvent.keyDown(menuEl(), { key: 'ArrowDown' }); // → B
    fireEvent.keyDown(menuEl(), { key: 'Enter' });
    expect(items[1].onSelect).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('Space 触发焦点菜单项并关闭', () => {
    const onClose = vi.fn();
    const items = threeItems();
    render(<ContextMenu open={true} x={0} y={0} items={items} onClose={onClose} />);
    fireEvent.keyDown(menuEl(), { key: ' ' });
    expect(items[0].onSelect).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
