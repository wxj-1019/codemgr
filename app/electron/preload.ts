import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type ExposedApi } from './ipc-types';

// 安全红线：只暴露封装后的方法，绝不暴露 ipcRenderer 本身
const api: ExposedApi = {
  fetchConnections: () => ipcRenderer.invoke(IPC.FETCH_CONNECTIONS),
  killProcess: (pid: number) => ipcRenderer.invoke(IPC.KILL_PROCESS, pid),
  killByName: (name: string) => ipcRenderer.invoke(IPC.KILL_BY_NAME, name),
  killByPids: (pids: number[]) => ipcRenderer.invoke(IPC.KILL_BY_PIDS, pids),
  killTree: (pid: number) => ipcRenderer.invoke(IPC.KILL_TREE, pid),
  fetchProcessEnv: (pid: number) => ipcRenderer.invoke(IPC.FETCH_PROCESS_ENV, pid),
  fetchProcesses: () => ipcRenderer.invoke(IPC.FETCH_PROCESSES),
  fetchCpu: () => ipcRenderer.invoke(IPC.FETCH_CPU),
  fetchPerf: () => ipcRenderer.invoke(IPC.FETCH_PERF),
};

contextBridge.exposeInMainWorld('codemgr', api);
