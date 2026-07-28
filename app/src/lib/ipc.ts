import type { NetConnection } from '../../electron/ipc-types';

// 渲染层统一通过此封装访问 native（绝不直接 require）
export const ipc = {
  async fetchConnections(): Promise<NetConnection[]> {
    return window.codemgr.fetchConnections();
  },
  async killProcess(pid: number): Promise<boolean> {
    return window.codemgr.killProcess(pid);
  },
  async killByName(name: string): Promise<number> {
    return window.codemgr.killByName(name);
  },
};
