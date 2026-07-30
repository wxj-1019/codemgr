import type { NetConnection, ProcessInfo, CpuUsage, PerfData, LabelRulesPayload, PluginManifestEntry, SnapshotEntry, SnapshotMeta, ProcessSnapshot, GitIdentity, RunProfile, RunState, ExposedApi } from '../../electron/ipc-types';

// 渲染层统一通过此封装访问 native（绝不直接 require）。
// 防护：preload 缺失时（如浏览器调试、preload 加载失败）window.codemgr 为 undefined，
// 直接访问会抛 "Cannot read properties of undefined" 导致整屏白屏崩溃。
// 这里每次调用动态读取 window.codemgr（不在模块加载时缓存，以便测试能在用例内替换 mock）：
// preload 缺失时异步方法返回 reject 的 Promise（被各 hook 的 .catch 吞掉），
// 事件订阅返回 no-op，保证渲染层在无 preload 环境也能渲染壳子（可用于浏览器 UI 审查）。
const getApi = (): ExposedApi | undefined =>
  typeof window !== 'undefined'
    ? (window as unknown as { codemgr?: ExposedApi }).codemgr
    : undefined;
const unavailable = <T>(): Promise<T> =>
  Promise.reject(new Error('codemgr preload API 不可用（window.codemgr 未注入）'));
// 透传到真实 api；缺失时走降级（异步 reject / 订阅 no-op）。
const invoke = <K extends keyof ExposedApi>(
  name: K,
  ...args: unknown[]
): ReturnType<ExposedApi[K]> => {
  const a = getApi();
  if (!a) return unavailable() as ReturnType<ExposedApi[K]>;
  return (a[name] as (...x: unknown[]) => unknown)(...args) as ReturnType<ExposedApi[K]>;
};
const subscribe = <K extends keyof ExposedApi>(
  name: K,
  ...args: unknown[]
): (() => void) => {
  const a = getApi();
  if (!a) return () => {};
  return (a[name] as (...x: unknown[]) => () => void)(...args);
};

export const ipc: ExposedApi = {
  fetchConnections: (...a) => invoke('fetchConnections', ...a),
  killProcess: (...a) => invoke('killProcess', ...a),
  killByName: (...a) => invoke('killByName', ...a),
  killByPids: (...a) => invoke('killByPids', ...a),
  killTree: (...a) => invoke('killTree', ...a),
  fetchProcessEnv: (...a) => invoke('fetchProcessEnv', ...a),
  fetchCwd: (...a) => invoke('fetchCwd', ...a),
  fetchProcesses: (...a) => invoke('fetchProcesses', ...a),
  fetchCpu: (...a) => invoke('fetchCpu', ...a),
  fetchPerf: (...a) => invoke('fetchPerf', ...a),
  exportLabelRules: (...a) => invoke('exportLabelRules', ...a),
  importLabelRules: (...a) => invoke('importLabelRules', ...a),
  listPlugins: (...a) => invoke('listPlugins', ...a),
  requestDataSource: (...a) => invoke('requestDataSource', ...a),
  onDataSourceResult: (...a) => subscribe('onDataSourceResult', ...a),
  getAppVersion: (...a) => invoke('getAppVersion', ...a),
  getAutoLaunch: (...a) => invoke('getAutoLaunch', ...a),
  setAutoLaunch: (...a) => invoke('setAutoLaunch', ...a),
  listSnapshots: (...a) => invoke('listSnapshots', ...a),
  saveSnapshot: (...a) => invoke('saveSnapshot', ...a),
  deleteSnapshot: (...a) => invoke('deleteSnapshot', ...a),
  loadSnapshot: (...a) => invoke('loadSnapshot', ...a),
  fetchGitIdentity: (...a) => invoke('fetchGitIdentity', ...a),
  listRunProfiles: (...a) => invoke('listRunProfiles', ...a),
  saveRunProfile: (...a) => invoke('saveRunProfile', ...a),
  deleteRunProfile: (...a) => invoke('deleteRunProfile', ...a),
  startProfile: (...a) => invoke('startProfile', ...a),
  stopProfile: (...a) => invoke('stopProfile', ...a),
  restartProfile: (...a) => invoke('restartProfile', ...a),
  onRunUpdate: (...a) => subscribe('onRunUpdate', ...a),
  openTarget: (...a) => invoke('openTarget', ...a),
  openExternalUrl: (...a) => invoke('openExternalUrl', ...a),
};

// 保留未使用类型导入的引用，避免 TS noUnusedLocals 报错（类型已通过 ExposedApi 间接使用）。
export type {
  NetConnection, ProcessInfo, CpuUsage, PerfData, LabelRulesPayload,
  PluginManifestEntry, SnapshotEntry, SnapshotMeta, ProcessSnapshot,
  GitIdentity, RunProfile, RunState,
};
