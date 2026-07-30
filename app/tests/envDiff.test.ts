import { describe, it, expect } from 'vitest';
import { diffEnv } from '../src/lib/envDiff';

describe('diffEnv', () => {
  it('added/removed/changed/sameCount 全路径', () => {
    const r = diffEnv(
      { A: '1', B: '2', C: '3' },
      { B: '2', C: 'x', D: '4' },
    );
    expect(r.removed).toEqual(['A']);
    expect(r.added).toEqual(['D']);
    expect(r.changed).toEqual([{ key: 'C', aVal: '3', bVal: 'x' }]);
    expect(r.sameCount).toBe(1); // B
  });

  it('键大小写不敏感：Path≡PATH 视为同键，changed 取 A 的大小写', () => {
    const r = diffEnv({ Path: 'C:\\a' }, { PATH: 'C:\\b' });
    expect(r.added).toEqual([]);
    expect(r.removed).toEqual([]);
    expect(r.changed).toEqual([{ key: 'Path', aVal: 'C:\\a', bVal: 'C:\\b' }]);
  });

  it('大小写不同但键值全同计入 sameCount', () => {
    const r = diffEnv({ Path: 'C:\\a' }, { PATH: 'C:\\a' });
    expect(r.sameCount).toBe(1);
    expect(r.changed).toEqual([]);
  });

  it('空 env 对比', () => {
    const r = diffEnv({}, { A: '1' });
    expect(r.added).toEqual(['A']);
    expect(r.sameCount).toBe(0);
  });

  it('输出按小写键排序（稳定）', () => {
    const r = diffEnv({ zebra: '1', Apple: '2', Mango: '3' }, {});
    expect(r.removed).toEqual(['Apple', 'Mango', 'zebra']);
  });
});
