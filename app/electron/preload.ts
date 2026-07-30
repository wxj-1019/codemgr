import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type ExposedApi, type LabelRulesPayload, type SnapshotEntry, type RunState, type OpenTargetKind } from './ipc-types';

// 安全红线：只暴露封装后的方法，绝不暴露 ipcRenderer 本身
const api: ExposedApi = {
  fetchConnections: () => ipcRenderer.invoke(IPC.FETCH_CONNECTIONS),
  killProcess: (pid: number) => ipcRenderer.invoke(IPC.KILL_PROCESS, pid),
  killByName: (name: string) => ipcRenderer.invoke(IPC.KILL_BY_NAME, name),
  killByPids: (pids: number[]) => ipcRenderer.invoke(IPC.KILL_BY_PIDS, pids),
  killTree: (pid: number) => ipcRenderer.invoke(IPC.KILL_TREE, pid),
  fetchProcessEnv: (pid: number) => ipcRenderer.invoke(IPC.FETCH_PROCESS_ENV, pid),
  fetchCwd: (pid: number) => ipcRenderer.invoke(IPC.FETCH_CWD, pid),
  fetchProcesses: () => ipcRenderer.invoke(IPC.FETCH_PROCESSES),
  fetchCpu: () => ipcRenderer.invoke(IPC.FETCH_CPU),
  fetchPerf: () => ipcRenderer.invoke(IPC.FETCH_PERF),
  // 文件路径由 main 的对话框决定，渲染层只传/收数据，拿不到路径（守红线）
  exportLabelRules: (payload: LabelRulesPayload) => ipcRenderer.invoke(IPC.EXPORT_LABEL_RULES, payload),
  importLabelRules: () => ipcRenderer.invoke(IPC.IMPORT_LABEL_RULES),
  listPlugins: () => ipcRenderer.invoke(IPC.LIST_PLUGINS),
  // 插件数据源（6c）：请求某 capability 数据，结果经 onDataSourceResult 回调异步推回
  requestDataSource: (capability: string) => ipcRenderer.invoke(IPC.REQUEST_DATA_SOURCE, capability),
  // 数据源结果事件订阅（6c）。返回取消订阅函数，不暴露 ipcRenderer 本身。
  onDataSourceResult: (cb: (capability: string, data: unknown) => void): (() => void) => {
    const handler = (_e: unknown, payload: { capability: string; data: unknown }) => cb(payload.capability, payload.data);
    ipcRenderer.on(IPC.DATA_SOURCE_RESULT, handler as never);
    return () => ipcRenderer.removeListener(IPC.DATA_SOURCE_RESULT, handler as never);
  },
  getAppVersion: () => ipcRenderer.invoke(IPC.APP_VERSION),
  // 开机自启：读当前状态 / 设置后返回实际状态
  getAutoLaunch: () => ipcRenderer.invoke(IPC.GET_AUTO_LAUNCH),
  setAutoLaunch: (enabled: boolean) => ipcRenderer.invoke(IPC.SET_AUTO_LAUNCH, enabled),
  // 进程快照对比（v2.2）：文件 IO 封在 main（userData/snapshots/），渲染层只收发数据，拿不到路径。
  // save 不传 id（main 内部生成），load/delete 按给定 id（main 校验 uuid 防穿越）。
  listSnapshots: () => ipcRenderer.invoke(IPC.SNAPSHOT_LIST),
  saveSnapshot: (name: string, entries: SnapshotEntry[]) => ipcRenderer.invoke(IPC.SNAPSHOT_SAVE, name, entries),
  deleteSnapshot: (id: string) => ipcRenderer.invoke(IPC.SNAPSHOT_DELETE, id),
  loadSnapshot: (id: string) => ipcRenderer.invoke(IPC.SNAPSHOT_LOAD, id),
  fetchGitIdentity: (cwd: string) => ipcRenderer.invoke(IPC.FETCH_GIT_IDENTITY, cwd),
  // Run Profiles（F1）：启动/停止/重启 + profile CRUD + run 状态事件订阅
  listRunProfiles: () => ipcRenderer.invoke(IPC.RUN_PROFILE_LIST),
  saveRunProfile: (profile) => ipcRenderer.invoke(IPC.RUN_PROFILE_SAVE, profile),
  deleteRunProfile: (id) => ipcRenderer.invoke(IPC.RUN_PROFILE_DELETE, id),
  startProfile: (profileId) => ipcRenderer.invoke(IPC.RUN_START, profileId),
  stopProfile: (runId) => ipcRenderer.invoke(IPC.RUN_STOP, runId),
  restartProfile: (runId) => ipcRenderer.invoke(IPC.RUN_RESTART, runId),
  getRunLogs: (runId: string, sinceSeq?: number) => ipcRenderer.invoke(IPC.RUN_GET_LOGS, runId, sinceSeq),
  onRunUpdate: (cb: (update: RunState) => void) => {
    const handler = (_e: unknown, update: RunState) => cb(update);
    ipcRenderer.on(IPC.RUN_UPDATE, handler as never);
    return () => ipcRenderer.removeListener(IPC.RUN_UPDATE, handler as never);
  },
  openTarget: (kind: OpenTargetKind, path: string) => ipcRenderer.invoke(IPC.OPEN_TARGET, kind, path),
  openExternalUrl: (url: string) => ipcRenderer.invoke(IPC.OPEN_EXTERNAL_URL, url),
  exportDataFile: (defaultName: string, content: string) => ipcRenderer.invoke(IPC.EXPORT_DATA_FILE, defaultName, content),
  listStartupItems: () => ipcRenderer.invoke(IPC.STARTUP_LIST),
  setStartupItemEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke(IPC.STARTUP_SET_ENABLED, id, enabled),
};

contextBridge.exposeInMainWorld('codemgr', api);
