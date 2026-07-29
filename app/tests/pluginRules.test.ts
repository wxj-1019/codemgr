import { describe, it, expect, beforeEach } from 'vitest';
import { useLabelRulesStore, getActiveRules } from '../src/store/labelRulesStore';
import { labelForProcess } from '../src/lib/processLabels';
import type { LabelRule } from '../src/lib/labelRules';

const rule = (over: Partial<LabelRule> & Pick<LabelRule, 'id' | 'label' | 'kind' | 'groups'>): LabelRule => ({
  field: 'both',
  enabled: true,
  ...over,
});

describe('pluginRules — 插件标签规则层', () => {
  beforeEach(() => {
    localStorage.clear();
    useLabelRulesStore.getState().resetAll();
  });

  it('setPluginRules 注入后 activeRules 含插件规则', () => {
    useLabelRulesStore.getState().setPluginRules('my-plugin', [
      rule({ id: 'plugin:my-plugin-1', label: 'Deno', kind: 'dev', groups: [{ include: ['deno'] }] }),
    ]);
    const active = getActiveRules();
    expect(active.some((r) => r.id === 'plugin:my-plugin-1')).toBe(true);
  });

  it('插件规则立即生效：labelForProcess 用上新规则', () => {
    useLabelRulesStore.getState().setPluginRules('redis-plugin', [
      rule({ id: 'plugin:redis-plugin-1', label: 'Redis', kind: 'db', field: 'name', groups: [{ include: ['redis-server'] }] }),
    ]);
    expect(labelForProcess('redis-server.exe', '')).toEqual({ label: 'Redis', kind: 'db' });
  });

  it('优先级末位：默认规则先命中（first-match-wins），插件规则不覆盖默认', () => {
    // default-vite 规则匹配 'vite'。插件也注册一个匹配 'vite' 的规则。
    // 由于插件规则在末位，应被默认规则抢先命中。
    useLabelRulesStore.getState().setPluginRules('override-plugin', [
      rule({ id: 'plugin:override-plugin-1', label: 'Hijacked', kind: 'test', field: 'name', groups: [{ include: ['vite'] }] }),
    ]);
    // vite 应命中默认的 dev server 标签，而非插件的 Hijacked
    const result = labelForProcess('vite.exe', 'vite');
    expect(result?.label).not.toBe('Hijacked');
  });

  it('插件规则优先级低于用户规则', () => {
    useLabelRulesStore.getState().addUserRule(
      rule({ id: 'user-bun', label: 'UserBun', kind: 'dev', field: 'name', groups: [{ include: ['bun'] }] }),
    );
    useLabelRulesStore.getState().setPluginRules('bun-plugin', [
      rule({ id: 'plugin:bun-plugin-1', label: 'PluginBun', kind: 'test', field: 'name', groups: [{ include: ['bun'] }] }),
    ]);
    expect(labelForProcess('bun.exe', '')).toEqual({ label: 'UserBun', kind: 'dev' });
  });

  it('setPluginRules(id, []) 清空某插件规则', () => {
    useLabelRulesStore.getState().setPluginRules('cleanable', [
      rule({ id: 'plugin:cleanable-1', label: 'X', kind: 'dev', groups: [{ include: ['xxx'] }] }),
    ]);
    expect(getActiveRules().some((r) => r.id === 'plugin:cleanable-1')).toBe(true);
    useLabelRulesStore.getState().setPluginRules('cleanable', []);
    expect(getActiveRules().some((r) => r.id === 'plugin:cleanable-1')).toBe(false);
  });

  it('setPluginRules 替换语义：再次调用覆盖该插件旧规则', () => {
    useLabelRulesStore.getState().setPluginRules('updater', [
      rule({ id: 'plugin:updater-old', label: 'Old', kind: 'dev', groups: [{ include: ['oldflag'] }] }),
    ]);
    useLabelRulesStore.getState().setPluginRules('updater', [
      rule({ id: 'plugin:updater-new', label: 'New', kind: 'test', groups: [{ include: ['newflag'] }] }),
    ]);
    const active = getActiveRules();
    expect(active.some((r) => r.id === 'plugin:updater-old')).toBe(false);
    expect(active.some((r) => r.id === 'plugin:updater-new')).toBe(true);
  });

  it('pluginRules 不被 persist partialize（运行时态，重启由加载器重注）', () => {
    useLabelRulesStore.getState().setPluginRules('persist-test', [
      rule({ id: 'plugin:persist-test-1', label: 'P', kind: 'dev', groups: [{ include: ['pflag'] }] }),
    ]);
    const api = (useLabelRulesStore as unknown as {
      persist: { getOptions: () => { partialize: (s: unknown) => unknown } };
    }).persist;
    const persisted = api.getOptions().partialize(useLabelRulesStore.getState()) as Record<string, unknown>;
    expect(persisted).not.toHaveProperty('pluginRules');
    // 只应含 userRules/disabledDefaultIds/overrides
    expect(Object.keys(persisted).sort()).toEqual(['disabledDefaultIds', 'overrides', 'userRules']);
  });

  it('resetAll 清空 pluginRules', () => {
    useLabelRulesStore.getState().setPluginRules('reset-target', [
      rule({ id: 'plugin:reset-target-1', label: 'R', kind: 'dev', groups: [{ include: ['rflag'] }] }),
    ]);
    useLabelRulesStore.getState().resetAll();
    expect(useLabelRulesStore.getState().pluginRules).toEqual({});
    expect(getActiveRules().some((r) => r.id === 'plugin:reset-target-1')).toBe(false);
  });
});
