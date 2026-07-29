// IPC 通道名常量（避免 main/preload/renderer 三处拼写不一致）
export const IPC = {
  FETCH_CONNECTIONS: 'net:fetchConnections',
  KILL_PROCESS: 'proc:killProcess',
  KILL_BY_NAME: 'proc:killByName',
  KILL_BY_PIDS: 'proc:killByPids',
  KILL_TREE: 'proc:killTree',
  FETCH_PROCESS_ENV: 'proc:fetchEnv',
  FETCH_CWD: 'proc:fetchCwd',
  FETCH_PROCESSES: 'proc:fetchProcesses',
  FETCH_CPU: 'proc:fetchCpu',
  FETCH_PERF: 'perf:fetch',
  // 标签规则导入导出：文件 IO 必须封在 main（红线），渲染层只拿数据/布尔
  EXPORT_LABEL_RULES: 'config:exportLabelRules',
  IMPORT_LABEL_RULES: 'config:importLabelRules',
  // 插件 manifest：main 读 userData/plugins.json，渲染层只拿校验过的条目列表（红线）
  LIST_PLUGINS: 'config:listPlugins',
  // 应用版本号：渲染层显示当前版本（来自 package.json，经 app.getVersion()）
  APP_VERSION: 'app:getVersion',
} as const;

/**
 * 标签规则的导出/导入载荷。结构与 labelRulesStore persist 的 partialize 一致，
 * 便于「导出即持久化切片、导入即替换」语义。version 预留后续 schema 迁移。
 */
export interface LabelRulesPayload {
  version: 1;
  userRules: LabelRule[];
  disabledDefaultIds: string[];
  overrides: Record<string, LabelRuleOverride>;
}

// 导入导出用到的本地类型（与 labelRules.ts / labelRulesStore.ts 对齐，避免渲染层跨包依赖）
export interface LabelRule {
  id: string;
  label: string;
  kind: string;
  field: 'name' | 'cmdline' | 'both';
  groups: { include: string[]; exclude?: string[] }[];
  enabled: boolean;
}

export interface LabelRuleOverride {
  label?: string;
  kind?: string;
  enabled?: boolean;
}

/**
 * 插件 manifest 条目。plugins.json 是一个 PluginManifestEntry[] 数组，
 * 存于 userData（main 读，渲染层不碰文件系统，守红线）。
 * - id：稳定唯一标识，用于 pluginRules 前缀（`plugin:<id>-`）和卸载清理。
 * - name：人类可读名称（未来视图嵌入时作 mosaic tile 标题）。
 * - src：插件 HTML 的路径。相对路径相对 userData 解析（main 侧）。
 */
export interface PluginManifestEntry {
  id: string;
  name: string;
  src: string;
}

// 与 codemgr-native 的 NetConnection 一致（重新声明，避免渲染层直接依赖 native 包）
export interface NetConnection {
  protocol: 'tcp' | 'udp';
  localAddr: string;
  localPort: number;
  remoteAddr: string;
  remotePort: number;
  state: string;
  pid: number;
  processName: string;
}

// ProcessInfo 匹配 codemgr-native processScan() 的返回元素形状
export interface ProcessInfo {
  pid: number;
  ppid: number;
  name: string;
  cmdline: string;
  cwd: string;             // 当前工作目录（从命令行启发式抽取，非 PEB 直读；见 process_collector.cpp）
  kernelTimeMs: number;
  userTimeMs: number;
  workingSetBytes: number;
  createTimeMs: number;
  threadCount: number;
  handleCount: number;
}

// CpuUsage 匹配 codemgr-native cpuDelta() 的返回元素形状
export interface CpuUsage {
  pid: number;
  cpuPercent: number;
}

// PerfData 匹配 codemgr-native perfCounters() 的返回形状
export interface PerfData {
  cpu: { totalPercent: number; perCore: number[] };
  memory: { totalBytes: number; availableBytes: number; usedPercent: number };
  disks: Array<{
    name: string;
    totalBytes: number;
    freeBytes: number;
    readBytesPerSec: number;
    writeBytesPerSec: number;
    activePercent: number;
  }>;
  networks: Array<{ name: string; recvBytesPerSec: number; sendBytesPerSec: number }>;
  timestamp: number;
}

// preload 暴露给 window 的 API 形状
export interface ExposedApi {
  fetchConnections(): Promise<NetConnection[]>;
  killProcess(pid: number): Promise<boolean>;
  killByName(name: string): Promise<number>;
  killByPids(pids: number[]): Promise<number>;
  killTree(pid: number): Promise<number>;
  // null = 读取失败：权限不足或进程已退出，UI 据此降级提示
  fetchProcessEnv(pid: number): Promise<Record<string, string> | null>;
  // null = 同上；精确 cwd（PEB 直读），与 ProcessInfo.cwd 的启发式值区分
  fetchCwd(pid: number): Promise<string | null>;
  fetchProcesses(): Promise<ProcessInfo[]>;
  fetchCpu(): Promise<CpuUsage[]>;
  fetchPerf(): Promise<PerfData | null>;
  // 标签规则导入导出。文件路径由 main 的对话框决定，渲染层拿不到路径（红线）。
  // 导出返回是否成功（用户取消对话框也算 false）；导入返回载荷或 null（取消/损坏）。
  exportLabelRules(payload: LabelRulesPayload): Promise<boolean>;
  importLabelRules(): Promise<LabelRulesPayload | null>;
  // 插件 manifest：返回校验过的条目列表（文件不存在/损坏 → 空数组，绝不抛错）
  listPlugins(): Promise<PluginManifestEntry[]>;
  // 应用版本号（来自 package.json，经 app.getVersion()）
  getAppVersion(): Promise<string>;
}
