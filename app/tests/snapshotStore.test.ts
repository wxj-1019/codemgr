import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSnapshotStore } from '../src/store/snapshotStore';
import { mockIpc } from './setup';
import type { SnapshotEntry, SnapshotMeta, ProcessSnapshot } from '../electron/ipc-types';

const entry = (over: Partial<SnapshotEntry> = {}): SnapshotEntry => ({
  pid: 100,
  createTimeMs: 1000,
  name: 'node.exe',
  cmdline: 'node index.js',
  cwd: 'C:\\proj\\app',
  workingSetBytes: 50 * 1024 * 1024,
  ...over,
});

const meta = (over: Partial<SnapshotMeta> = {}): SnapshotMeta => ({
  id: '11111111-2222-3333-4444-555555555555',
  name: 'agent 开工前',
  createdAt: 1700000000000,
  count: 5,
  ...over,
});

const snapshot = (over: Partial<ProcessSnapshot> = {}): ProcessSnapshot => ({
  id: '11111111-2222-3333-4444-555555555555',
  name: 'agent 开工前',
  createdAt: 1700000000000,
  entries: [entry()],
  ...over,
});

describe('snapshotStore', () => {
  // persist middleware reads/writes localStorage；每个用例前清空以防 rehydrate 泄漏
  beforeEach(() => {
    localStorage.clear();
    useSnapshotStore.getState().reset();
  });

  it('starts empty with null selectedId', () => {
    const s = useSnapshotStore.getState();
    expect(s.snapshots).toEqual([]);
    expect(s.selectedId).toBeNull();
    expect(s.loading).toBe(false);
    expect(s.error).toBeNull();
  });

  it('fetchList pulls meta list from ipc.listSnapshots', async () => {
    const m = mockIpc({
      listSnapshots: vi.fn(() => Promise.resolve([meta({ id: 'a', name: 's1' })])),
    });
    await useSnapshotStore.getState().fetchList();
    expect(m.listSnapshots).toHaveBeenCalled();
    expect(useSnapshotStore.getState().snapshots).toHaveLength(1);
    expect(useSnapshotStore.getState().snapshots[0].name).toBe('s1');
    expect(useSnapshotStore.getState().loading).toBe(false);
    expect(useSnapshotStore.getState().error).toBeNull();
  });

  it('fetchList sets error on ipc throw', async () => {
    mockIpc({
      listSnapshots: vi.fn(() => Promise.reject(new Error('boom'))),
    });
    await useSnapshotStore.getState().fetchList();
    expect(useSnapshotStore.getState().snapshots).toEqual([]);
    expect(useSnapshotStore.getState().error).toContain('boom');
    expect(useSnapshotStore.getState().loading).toBe(false);
  });

  it('save calls ipc.saveSnapshot and refreshes list + selects new id', async () => {
    const created = snapshot({ id: 'new-id', name: 'fresh' });
    const m = mockIpc({
      saveSnapshot: vi.fn(() => Promise.resolve(created)),
      listSnapshots: vi.fn(() => Promise.resolve([meta({ id: 'new-id', name: 'fresh' })])),
    });
    const ret = await useSnapshotStore.getState().save('fresh', [entry()]);
    expect(m.saveSnapshot).toHaveBeenCalledWith('fresh', [entry()]);
    expect(ret).not.toBeNull();
    expect(ret?.id).toBe('new-id');
    // 保存后刷新 list + 自动选中新建快照
    expect(m.listSnapshots).toHaveBeenCalled();
    expect(useSnapshotStore.getState().snapshots[0].id).toBe('new-id');
    expect(useSnapshotStore.getState().selectedId).toBe('new-id');
  });

  it('save returns null and sets error when ipc returns null (上限/校验失败)', async () => {
    const m = mockIpc({
      saveSnapshot: vi.fn(() => Promise.resolve(null)),     // 超上限/失败
    });
    const ret = await useSnapshotStore.getState().save('x', []);
    expect(ret).toBeNull();
    expect(useSnapshotStore.getState().error).toContain('20');
    expect(useSnapshotStore.getState().loading).toBe(false);
    // 失败时不刷新 list（listSnapshots 未被调）
    expect(m.listSnapshots).not.toHaveBeenCalled();
  });

  it('save catches ipc throw and returns null', async () => {
    mockIpc({
      saveSnapshot: vi.fn(() => Promise.reject(new Error('disk full'))),
    });
    const ret = await useSnapshotStore.getState().save('x', [entry()]);
    expect(ret).toBeNull();
    expect(useSnapshotStore.getState().error).toContain('disk full');
  });

  it('remove calls ipc.deleteSnapshot and refreshes list', async () => {
    // 预置一个非选中的快照
    useSnapshotStore.setState({ snapshots: [meta({ id: 'a' }), meta({ id: 'b' })], selectedId: 'b' });
    const m = mockIpc({
      deleteSnapshot: vi.fn(() => Promise.resolve(true)),
      listSnapshots: vi.fn(() => Promise.resolve([meta({ id: 'b' })])),
    });
    const ok = await useSnapshotStore.getState().remove('a');
    expect(m.deleteSnapshot).toHaveBeenCalledWith('a');
    expect(ok).toBe(true);
    // 刷新后 a 不在列表；删的不是选中态，selectedId 保持
    expect(useSnapshotStore.getState().snapshots.map((x) => x.id)).toEqual(['b']);
    expect(useSnapshotStore.getState().selectedId).toBe('b');
  });

  it('remove clears selectedId when deleting the currently-selected snapshot', async () => {
    useSnapshotStore.setState({ snapshots: [meta({ id: 'a' })], selectedId: 'a' });
    mockIpc({
      deleteSnapshot: vi.fn(() => Promise.resolve(true)),
      listSnapshots: vi.fn(() => Promise.resolve([])),
    });
    await useSnapshotStore.getState().remove('a');
    expect(useSnapshotStore.getState().selectedId).toBeNull();
    expect(useSnapshotStore.getState().snapshots).toEqual([]);
  });

  it('remove returns false + sets error when ipc returns false', async () => {
    const m = mockIpc({
      deleteSnapshot: vi.fn(() => Promise.resolve(false)),   // 已不存在/失败
    });
    const ok = await useSnapshotStore.getState().remove('missing');
    expect(ok).toBe(false);
    expect(useSnapshotStore.getState().error).toBeTruthy();
    expect(m.listSnapshots).not.toHaveBeenCalled();
  });

  it('select sets selectedId (nullable)', () => {
    useSnapshotStore.getState().select('xyz');
    expect(useSnapshotStore.getState().selectedId).toBe('xyz');
    useSnapshotStore.getState().select(null);
    expect(useSnapshotStore.getState().selectedId).toBeNull();
  });

  it('setLoading / setError update runtime state', () => {
    useSnapshotStore.getState().setLoading(true);
    expect(useSnapshotStore.getState().loading).toBe(true);
    useSnapshotStore.getState().setError('oops');
    expect(useSnapshotStore.getState().error).toBe('oops');
  });

  it('reset clears all runtime state', () => {
    useSnapshotStore.setState({
      snapshots: [meta()],
      selectedId: 'x',
      loading: true,
      error: 'e',
    });
    useSnapshotStore.getState().reset();
    const s = useSnapshotStore.getState();
    expect(s.snapshots).toEqual([]);
    expect(s.selectedId).toBeNull();
    expect(s.loading).toBe(false);
    expect(s.error).toBeNull();
  });

  it('persists only selectedId (partialize shape)', () => {
    localStorage.clear();
    const st = useSnapshotStore.getState();
    st.select('persist-me');
    const api = (useSnapshotStore as unknown as {
      persist: { getOptions: () => { partialize: (s: unknown) => unknown } };
    }).persist;
    const persisted = api.getOptions().partialize(useSnapshotStore.getState());
    // 只 selectedId 被持久化；snapshots/loading/error 是运行时态不存
    expect(persisted).toEqual({ selectedId: 'persist-me' });
  });
});
