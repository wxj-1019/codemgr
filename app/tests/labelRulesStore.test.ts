import { describe, it, expect, beforeEach } from 'vitest';
import { useLabelRulesStore, type LabelRulesSnapshot } from '../src/store/labelRulesStore';
import { getActiveRules } from '../src/store/labelRulesStore';
import type { LabelRule } from '../src/lib/labelRules';

const rule = (over: Partial<LabelRule> & Pick<LabelRule, 'id' | 'label' | 'kind' | 'groups'>): LabelRule => ({
  field: 'both',
  enabled: true,
  ...over,
});

describe('labelRulesStore — replaceAll (导入语义)', () => {
  // persist middleware 读写 localStorage，每个测试前清掉避免串扰
  beforeEach(() => {
    localStorage.clear();
    useLabelRulesStore.getState().resetAll();
  });

  it('整体替换 userRules / disabledDefaultIds / overrides', () => {
    const store = useLabelRulesStore.getState();
    // 先放点现有数据
    store.addUserRule(rule({ id: 'old', label: 'old', kind: 'dev', groups: [{ include: ['old'] }] }));

    const snapshot: LabelRulesSnapshot = {
      version: 1,
      userRules: [
        rule({ id: 'a', label: 'a', kind: 'dev', groups: [{ include: ['aaa'] }] }),
        rule({ id: 'b', label: 'b', kind: 'test', groups: [{ include: ['bbb'] }] }),
      ],
      disabledDefaultIds: ['vite'],
      overrides: { jest: { label: 'changed' } },
    };

    const n = store.replaceAll(snapshot);
    const s = useLabelRulesStore.getState();
    expect(n).toBe(2);
    expect(s.userRules.map((r) => r.id)).toEqual(['a', 'b']);
    expect(s.disabledDefaultIds).toEqual(['vite']);
    expect(s.overrides['jest']?.label).toBe('changed');
    // 旧的 userRule 必须被替换掉（不是合并）
    expect(s.userRules.find((r) => r.id === 'old')).toBeUndefined();
  });

  it('空快照清空所有自定义数据（保留默认规则）', () => {
    const store = useLabelRulesStore.getState();
    store.addUserRule(rule({ id: 'x', label: 'x', kind: 'dev', groups: [{ include: ['x'] }] }));
    store.toggleDefault('vite', false);

    store.replaceAll({ version: 1, userRules: [], disabledDefaultIds: [], overrides: {} });
    const s = useLabelRulesStore.getState();
    expect(s.userRules).toEqual([]);
    expect(s.disabledDefaultIds).toEqual([]);
    expect(s.overrides).toEqual({});
  });

  it('replaceAll 后模块级 activeRules 缓存同步刷新（导入规则立即生效）', () => {
    const store = useLabelRulesStore.getState();
    store.replaceAll({
      version: 1,
      userRules: [
        rule({ id: 'mine', label: 'my-tool', kind: 'dev', groups: [{ include: ['my-special-flag'] }] }),
      ],
      disabledDefaultIds: [],
      overrides: {},
    });
    // activeRules 是 labelForProcess 直接读的缓存，导入后必须含新规则
    const active = getActiveRules();
    expect(active.some((r) => r.id === 'mine')).toBe(true);
  });

  it('深拷贝：替换后改原快照不影响 store', () => {
    const store = useLabelRulesStore.getState();
    const snapshot: LabelRulesSnapshot = {
      version: 1,
      userRules: [rule({ id: 'a', label: 'a', kind: 'dev', groups: [{ include: ['aaa'] }] })],
      disabledDefaultIds: ['vite'],
      overrides: {},
    };
    store.replaceAll(snapshot);

    // 篡改原快照对象
    snapshot.userRules[0].label = 'tampered';
    snapshot.userRules.push(rule({ id: 'evil', label: 'evil', kind: 'dev', groups: [{ include: ['x'] }] }));
    snapshot.disabledDefaultIds.push('extra');

    const s = useLabelRulesStore.getState();
    expect(s.userRules[0].label).toBe('a');           // 未被篡改
    expect(s.userRules.length).toBe(1);               // 未被 push 污染
    expect(s.disabledDefaultIds).toEqual(['vite']);   // 未被 push 污染
  });
});
