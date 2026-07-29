import type { NetConnection, ProcessInfo, CpuUsage, PerfData, LabelRulesPayload, PluginManifestEntry } from '../../electron/ipc-types';

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
  async killTree(pid: number): Promise<number> {
    return window.codemgr.killTree(pid);
  },
  async fetchProcessEnv(pid: number): Promise<Record<string, string> | null> {
    return window.codemgr.fetchProcessEnv(pid);
  },
  async fetchCwd(pid: number): Promise<string | null> {
    return window.codemgr.fetchCwd(pid);
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
  // 文件路径由 main 对话框决定，渲染层不持有路径（守红线）
  async exportLabelRules(payload: LabelRulesPayload): Promise<boolean> {
    return window.codemgr.exportLabelRules(payload);
  },
  async importLabelRules(): Promise<LabelRulesPayload | null> {
    return window.codemgr.importLabelRules();
  },
  async listPlugins(): Promise<PluginManifestEntry[]> {
    return window.codemgr.listPlugins();
  },
  async getAppVersion(): Promise<string> {
    return window.codemgr.getAppVersion();
  },
};
