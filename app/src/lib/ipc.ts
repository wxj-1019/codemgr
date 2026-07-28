import type { NetConnection, ProcessInfo, CpuUsage, PerfData } from '../../electron/ipc-types';

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
  async killByPids(pids: number[]): Promise<number> {
    return window.codemgr.killByPids(pids);
  },
  async fetchProcesses(): Promise<ProcessInfo[]> {
    return window.codemgr.fetchProcesses();
  },
  async fetchCpu(): Promise<CpuUsage[]> {
    return window.codemgr.fetchCpu();
  },
  async fetchPerf(): Promise<PerfData | null> {
    return window.codemgr.fetchPerf();
  },
};
