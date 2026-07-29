import { describe, it, expect } from 'vitest';
import {
  matchRules,
  ruleMatches,
  type LabelRule,
} from '../src/lib/labelRules';

const rule = (over: Partial<LabelRule> & Pick<LabelRule, 'id' | 'label' | 'kind' | 'groups'>): LabelRule => ({
  field: 'both',
  enabled: true,
  ...over,
});

describe('matchRules — include (AND)', () => {
  it('命中当 include 全部子串都在目标中', () => {
    const r = rule({ id: '1', label: 'build', kind: 'build', groups: [{ include: ['vite', 'build'] }] });
    expect(matchRules([r], 'node.exe', 'node vite build')).toEqual({ label: 'build', kind: 'build' });
  });
  it('不命中当 include 缺一个', () => {
    const r = rule({ id: '1', label: 'build', kind: 'build', groups: [{ include: ['vite', 'build'] }] });
    expect(matchRules([r], 'node.exe', 'node vite dev')).toBeNull();
  });
  it('空 include 永不命中', () => {
    const r = rule({ id: '1', label: 'x', kind: 'dev', groups: [{ include: [] }] });
    expect(matchRules([r], 'node.exe', 'anything')).toBeNull();
  });
});

describe('matchRules — exclude (NOT)', () => {
  it('exclude 命中则该组不命中', () => {
    const r = rule({
      id: '1', label: 'webpack dev', kind: 'dev',
      groups: [{ include: ['webpack'], exclude: ['build'] }],
    });
    expect(matchRules([r], 'node.exe', 'webpack build')).toBeNull();
    expect(matchRules([r], 'node.exe', 'webpack serve')).toEqual({ label: 'webpack dev', kind: 'dev' });
  });
});

describe('matchRules — groups (OR)', () => {
  it('任一组命中即命中', () => {
    const r = rule({
      id: '1', label: 'db', kind: 'db',
      groups: [{ include: ['mysql'] }, { include: ['mariadb'] }],
    });
    expect(matchRules([r], 'mariadb.exe', '')).toEqual({ label: 'db', kind: 'db' });
    expect(matchRules([r], 'mysql.exe', '')).toEqual({ label: 'db', kind: 'db' });
    expect(matchRules([r], 'postgres.exe', '')).toBeNull();
  });
});

describe('matchRules — field', () => {
  it('field=name 只匹配进程名', () => {
    const r = rule({ id: '1', label: 'sys', kind: 'system', field: 'name', groups: [{ include: ['svchost'] }] });
    expect(matchRules([r], 'svchost.exe', '')).toEqual({ label: 'sys', kind: 'system' });
    // cmdline 里有 svchost 但 name 里没有 → 不命中
    expect(matchRules([r], 'node.exe', 'svchost')).toBeNull();
  });
  it('field=both 匹配 name+cmdline', () => {
    const r = rule({ id: '1', label: 'v', kind: 'dev', field: 'both', groups: [{ include: ['vite'] }] });
    expect(matchRules([r], 'node.exe', 'vite')).toEqual({ label: 'v', kind: 'dev' });
    expect(matchRules([r], 'vite.exe', '')).toEqual({ label: 'v', kind: 'dev' });
  });
});

describe('matchRules — enabled / 顺序', () => {
  it('disabled 规则被跳过', () => {
    const r = rule({ id: '1', label: 'off', kind: 'dev', enabled: false, groups: [{ include: ['vite'] }] });
    expect(matchRules([r], 'node.exe', 'vite')).toBeNull();
  });
  it('首匹配胜出（顺序敏感）', () => {
    const first = rule({ id: '1', label: 'first', kind: 'build', groups: [{ include: ['vite'] }] });
    const second = rule({ id: '2', label: 'second', kind: 'dev', groups: [{ include: ['vite'] }] });
    expect(matchRules([first, second], 'node.exe', 'vite')).toEqual({ label: 'first', kind: 'build' });
    expect(matchRules([second, first], 'node.exe', 'vite')).toEqual({ label: 'second', kind: 'dev' });
  });
  it('空规则列表返回 null', () => {
    expect(matchRules([], 'node.exe', 'vite')).toBeNull();
  });
});

describe('ruleMatches — 单条直接判定', () => {
  it('无 groups 不命中', () => {
    expect(ruleMatches(rule({ id: '1', label: 'x', kind: 'dev', groups: [] }), 'a', 'b')).toBe(false);
  });
  it('大小写不敏感', () => {
    const r = rule({ id: '1', label: 'x', kind: 'dev', groups: [{ include: ['VITE'] }] });
    expect(ruleMatches(r, 'node.exe', 'vite')).toBe(true);
  });
});
