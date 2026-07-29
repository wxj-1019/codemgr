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
  // 插件数据源（6c）：renderer 请求某 capability 的数据，main 转发 UtilityProcess 采集
  REQUEST_DATA_SOURCE: 'plugin:requestDataSource',
  // 插件数据源（6c）：main 把 UtilityProcess 采集结果推回 renderer（事件，非 invoke）
  DATA_SOURCE_RESULT: 'plugin:dataSource',
  // 应用版本号：渲染层显示当前版本（来自 package.json，经 app.getVersion()）
  APP_VERSION: 'app:getVersion',
  // 开机自启：读/写 login item 设置（经 app.getLoginItemSettings / setLoginItemSettings）
  GET_AUTO_LAUNCH: 'app:getAutoLaunch',
  SET_AUTO_LAUNCH: 'app:setAutoLaunch',
  // 进程快照对比（v2.2）：文件 IO 封在 main（userData/snapshots/<id>.json），
  // 渲染层只收发数据，拿不到路径（与 EXPORT_LABEL_RULES / LIST_PLUGINS 同红线）。
  // - list 只返元信息（id/name/createdAt/count）；load 才返完整 entries。
  // - save 由 main 用 crypto.randomUUID() 生成 id，渲染层不指定 id（消除穿越面）。
  SNAPSHOT_LIST: 'snapshot:list',
  SNAPSHOT_SAVE: 'snapshot:save',
  SNAPSHOT_DELETE: 'snapshot:delete',
  SNAPSHOT_LOAD: 'snapshot:load',
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
 * - capabilities：插件要消费的 native 数据源能力（6c）。每项必须在 ALLOWED_CAPABILITIES
 *   白名单内，否则 main 校验时剥离（红线：插件不能自带 .node，能力由主仓库编译进主包）。
 */
export interface PluginManifestEntry {
  id: string;
  name: string;
  src: string;
  capabilities?: string[];
}

/**
 * 插件数据源能力白名单（6c）。每个能力对应主仓库编译进 native addon 的一个 collector。
 * 插件 manifest 声明的 capabilities 只能在此集合内，未识别项被 main 剥离。
 * 新增能力 = 加 collector + addon 注册 + 加此白名单 + UtilityProcess 路由（主仓库 review）。
 *
 * 当前含 demo-source（模拟）+ disk-volumes（真实：磁盘卷列表，GetLogicalDriveStringsW 等）。
 */
export const ALLOWED_CAPABILITIES: ReadonlySet<string> = new Set(['demo-source', 'disk-volumes']);

// ── 进程快照对比（v2.2，spec §2.2） ──

/**
 * 快照条目 = ProcessInfo 的子集 + 必要元信息。只保留 diff/分组/展示所需的字段，
 * 比存全量 ProcessInfo 小很多（每进程约 5 字段 vs 10+）。字段类型与 ProcessInfo 对齐，
 * 以便 diff 引擎与 groupByProject 复用同一套分组代码。
 */
export interface SnapshotEntry {
  pid: number;
  /** 进程创建时间（identity 的一部分：PID 会被系统复用，单 pid 不够防误判）。 */
  createTimeMs: number;
  name: string;
  cmdline: string;
  cwd: string;
  workingSetBytes: number;
}

/** 完整快照（save 时构造、load 时返回）。id 由 main 用 crypto.randomUUID() 生成。 */
export interface ProcessSnapshot {
  id: string;            // uuid
  name: string;          // 用户命名
  createdAt: number;     // Date.now()（main 写入时刻）
  entries: SnapshotEntry[];
}

/**
 * 快照列表项（仅元信息，不含 entries）。list 通道返回此类型，避免一次性拉全量
 * 历史快照导致内存膨胀（20 个快照 × 每个数百 entries 会显著拖慢首屏）。
 */
export interface SnapshotMeta {
  id: string;
  name: string;
  createdAt: number;
  count: number;         // entries.length，仅用于 UI 显示进程数
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
  gpu: {
    available: boolean;
    totalPercent: number;
    vramUsedBytes: number;
    vramBudgetBytes: number;
    perProcess: Array<{ pid: number; gpuPercent: number; vramBytes: number }>;
  };
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
  // 插件数据源（6c）：请求某 capability 的数据。结果经 DATA_SOURCE_RESULT 事件异步推回。
  requestDataSource(capability: string): Promise<void>;
  // 数据源结果事件订阅（6c）。返回取消订阅函数。
  onDataSourceResult(cb: (capability: string, data: unknown) => void): () => void;
  // 应用版本号（来自 package.json，经 app.getVersion()）
  getAppVersion(): Promise<string>;
  // 开机自启：读取当前 login item 状态
  getAutoLaunch(): Promise<boolean>;
  // 开机自启：设置后返回实际生效状态（UI 以此为准，失败时调用方回滚）
  setAutoLaunch(enabled: boolean): Promise<boolean>;
  // 进程快照对比（v2.2）。文件 IO 封在 main（userData/snapshots/），渲染层只收发数据。
  // - listSnapshots：只返元信息（不含 entries），UI 列表展示用。
  // - saveSnapshot：main 生成 id + 校验 + 写文件。返完整快照（含生成的 id），
  //   null = 校验失败/超 20 上限/写盘失败（UI 据此报错）。
  // - deleteSnapshot：按 id 删，返是否成功。
  // - loadSnapshot：按 id 读全量 entries；null = 文件不存在/损坏/schema 不符。
  listSnapshots(): Promise<SnapshotMeta[]>;
  saveSnapshot(name: string, entries: SnapshotEntry[]): Promise<ProcessSnapshot | null>;
  deleteSnapshot(id: string): Promise<boolean>;
  loadSnapshot(id: string): Promise<ProcessSnapshot | null>;
}
