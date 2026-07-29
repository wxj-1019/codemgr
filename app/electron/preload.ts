import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type ExposedApi, type LabelRulesPayload } from './ipc-types';

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
};

contextBridge.exposeInMainWorld('codemgr', api);
