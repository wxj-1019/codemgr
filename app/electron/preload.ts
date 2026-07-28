import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type ExposedApi } from './ipc-types';

// 安全红线：只暴露封装后的方法，绝不暴露 ipcRenderer 本身
const api: ExposedApi = {
  fetchConnections: () => ipcRenderer.invoke(IPC.FETCH_CONNECTIONS),
  killProcess: (pid: number) => ipcRenderer.invoke(IPC.KILL_PROCESS, pid),
  killByName: (name: string) => ipcRenderer.invoke(IPC.KILL_BY_NAME, name),
};

contextBridge.exposeInMainWorld('codemgr', api);
