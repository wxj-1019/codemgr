import { describe, it, expect } from 'vitest';
import { prunePluginLeaves } from '../src/store/layoutStore';

describe('prunePluginLeaves — 启动清理悬空 plugin 叶子', () => {
  it('保留内置面板，移除悬空 plugin 叶子', () => {
    // 树：process | plugin:gone（gone 不在 manifest → 悬空）
    const tree = { direction: 'row' as const, first: 'process', second: 'plugin:gone', splitPercentage: 70 };
    const result = prunePluginLeaves(tree, new Set(['keep']));
    expect(result).toBe('process'); // 提升唯一存活子节点
  });

  it('保留 manifest 中的 plugin 叶子', () => {
    const tree = { direction: 'row' as const, first: 'process', second: 'plugin:keep', splitPercentage: 70 };
    const result = prunePluginLeaves(tree, new Set(['keep']));
    expect(result).toEqual(tree);
  });

  it('两子都悬空 → null（触发 zero-state）', () => {
    const tree = { direction: 'row' as const, first: 'plugin:a', second: 'plugin:b', splitPercentage: 50 };
    const result = prunePluginLeaves(tree, new Set());
    expect(result).toBeNull();
  });

  it('嵌套树：清理悬空后提升存活子树', () => {
    // 左 process，右(plugin:gone | perf) → 清理后右变 perf，整体 process | perf
    const tree = {
      direction: 'row' as const, first: 'process', splitPercentage: 70,
      second: { direction: 'column' as const, first: 'plugin:gone', second: 'perf', splitPercentage: 50 },
    };
    const result = prunePluginLeaves(tree, new Set());
    expect(result).toEqual({
      direction: 'row', first: 'process', splitPercentage: 70, second: 'perf',
    });
  });

  it('null 输入返回 null', () => {
    expect(prunePluginLeaves(null, new Set(['x']))).toBeNull();
  });

  it('纯内置面板树不受影响', () => {
    const tree = {
      direction: 'row' as const, first: 'port', second: 'perf', splitPercentage: 50,
    };
    expect(prunePluginLeaves(tree, new Set())).toEqual(tree);
  });
});
