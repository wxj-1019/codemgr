import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LabelRuleEditor } from '../src/components/LabelRuleEditor';
import { useLabelRulesStore } from '../src/store/labelRulesStore';

// 模态内可聚焦元素（与实现的选择器保持一致：排除 disabled）
const focusables = (container: HTMLElement) =>
  Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  );

describe('LabelRuleEditor a11y', () => {
  beforeEach(() => {
    localStorage.clear();
    useLabelRulesStore.getState().resetAll();
  });

  it('打开时焦点落在首个输入框', () => {
    render(<LabelRuleEditor onClose={() => {}} />);
    expect(screen.getByPlaceholderText('标签文本 (如 my-tool)')).toHaveFocus();
  });

  it('Esc 关闭模态', () => {
    const onClose = vi.fn();
    render(<LabelRuleEditor onClose={onClose} />);
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('Tab 在末位元素时循环回首位（不逃逸到背景）', () => {
    const { container } = render(<LabelRuleEditor onClose={() => {}} />);
    const els = focusables(container);
    expect(els.length).toBeGreaterThan(1);
    const first = els[0];
    const last = els[els.length - 1];
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
  });

  it('Shift+Tab 在首位元素时循环回末位', () => {
    const { container } = render(<LabelRuleEditor onClose={() => {}} />);
    const els = focusables(container);
    const first = els[0];
    const last = els[els.length - 1];
    first.focus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('Tab 在中间元素正常前进（不拦截）', () => {
    const { container } = render(<LabelRuleEditor onClose={() => {}} />);
    const els = focusables(container);
    els[1].focus();
    fireEvent.keyDown(els[1], { key: 'Tab' });
    // 未被陷阱拦截：焦点不被强制改写（jsdom 不做原生 Tab 移动，activeElement 保持原样即可证明未 preventDefault 干预）
    expect(document.activeElement).toBe(els[1]);
  });
});
