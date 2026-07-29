import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmDialog } from '../src/components/ConfirmDialog';

describe('ConfirmDialog', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <ConfirmDialog
        open={false}
        title="t"
        message="m"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows title and message when open', () => {
    render(
      <ConfirmDialog
        open={true}
        title="确认操作"
        message="确定吗？"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.getByText('确认操作')).toBeInTheDocument();
    expect(screen.getByText('确定吗？')).toBeInTheDocument();
  });

  it('calls onConfirm when confirm button clicked', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="t"
        message="m"
        onConfirm={onConfirm}
        onCancel={() => {}}
        confirmLabel="执行"
      />
    );
    fireEvent.click(screen.getByText('执行'));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('calls onCancel when cancel button clicked', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="t"
        message="m"
        onConfirm={() => {}}
        onCancel={onCancel}
        cancelLabel="返回"
      />
    );
    fireEvent.click(screen.getByText('返回'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('disables actions and shows busy label when busy', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="t"
        message="m"
        confirmLabel="执行"
        busy
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
    const confirmBtn = screen.getByText('处理中…');
    const cancelBtn = screen.getByText('取消');
    expect(confirmBtn).toBeDisabled();
    expect(cancelBtn).toBeDisabled();
    fireEvent.click(confirmBtn);
    fireEvent.click(cancelBtn);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('closes on Escape when not busy', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="t"
        message="m"
        onConfirm={() => {}}
        onCancel={onCancel}
      />
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
