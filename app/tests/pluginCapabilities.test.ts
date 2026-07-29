import { describe, it, expect } from 'vitest';
import { ALLOWED_CAPABILITIES } from '../electron/ipc-types';

/**
 * 白名单过滤测试（6c）。
 *
 * 实际的 capabilities 过滤逻辑在 main.ts LIST_PLUGINS handler 内（依赖 Electron ipcMain，
 * 无法在 jsdom 单测）。这里验证白名单常量的正确性——它是过滤的依据。
 * main 侧的过滤范式："逐条校验、非法项剥离"（与 validateLabelRulesPayload 一致），
 * 人工验收时确认非法 capability 被剥离。
 */
describe('plugin capabilities 白名单（6c）', () => {
  it('demo-source 在白名单内', () => {
    expect(ALLOWED_CAPABILITIES.has('demo-source')).toBe(true);
  });

  it('未知 capability 不在白名单内（应被 main 剥离）', () => {
    expect(ALLOWED_CAPABILITIES.has('docker-containers')).toBe(false);
    expect(ALLOWED_CAPABILITIES.has('arbitrary-evil-capability')).toBe(false);
    expect(ALLOWED_CAPABILITIES.has('')).toBe(false);
  });
});
