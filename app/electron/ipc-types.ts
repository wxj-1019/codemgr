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
  // 工作区 Git 身份（B）：按需从 cwd 解析 git root/branch/HEAD/worktree。纯 fs，不 spawn git。
  FETCH_GIT_IDENTITY: 'git:fetchIdentity',
  // Run Profiles（F1）：受控启动/停止开发服务。spawn 在 main，渲染层只传 profileId/runId。
  RUN_PROFILE_LIST: 'run:list',
  RUN_PROFILE_SAVE: 'run:save',
  RUN_PROFILE_DELETE: 'run:delete',
  RUN_START: 'run:start',
  RUN_STOP: 'run:stop',
  RUN_RESTART: 'run:restart',
  // run 状态事件（F1）：main 推 run exit/状态变更给渲染层（事件，非 invoke）
  RUN_UPDATE: 'run:update',
  // shell 跳转动作（子项目 A）：打开文件夹/终端/编辑器 + 浏览器打开 URL。
  // kind/路径/scheme 校验全在 main（shellActions.ts），渲染层只传 kind+path/url。
  OPEN_TARGET: 'shell:openTarget',
  OPEN_EXTERNAL_URL: 'shell:openExternalUrl',
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
 * 进程 cwd 所属 Git 仓库的身份（B，按需解析）。纯 fs 文件解析，不 spawn git。
 * 解析失败（非 git 目录/权限/边界）→ fetchGitIdentity 返回 null。
 */
export interface GitIdentity {
  gitRoot: string;
  commonDir: string;
  branch: string | null;
  head: string;
  detached: boolean;
  isWorktree: boolean;
}

/** Run Profile（F1）：受控启动的开发服务配置。id 由 main 生成。command 限白名单。 */
export interface RunProfile {
  id: string;
  name: string;
  command: string;       // 白名单可执行名（node/npm/pnpm/yarn/python/git）
  args: string[];        // 参数数组（execFile 无 shell，不经拼接）
  cwd: string;           // 绝对路径
  expectedPorts?: number[]; // 预留 F2（端口意图），F1 不消费
}

/** shell 打开目标类型（子项目 A）。folder=Explorer；terminal=wt 优先回退 cmd；editor=VS Code。 */
export type OpenTargetKind = 'folder' | 'terminal' | 'editor';

/** 一个运行中的 profile 实例（main spawn 后产生）。 */
export interface RunState {
  runId: string;
  profileId: string;
  pid: number;
  status: 'running' | 'exited';
  exitCode: number | null;
  startedAt: number;
}

/** Run 日志行（子项目 C）。seq 由 main 按到达顺序单调分配（1 起）。 */
export interface RunLogLine {
  seq: number;
  text: string;
}

/**
 * 日志增量块（run:getLogs 返回）。nextSeq = 当前已分配的最大 seq（无行为 0），
 * 下次请求传 sinceSeq=nextSeq 即得增量。ring buffer 满 2000 行丢最老并累计 droppedBefore。
 */
export interface RunLogChunk {
  lines: RunLogLine[];
  droppedBefore: number;
  nextSeq: number;
}

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
/**
 * 轮询采集的结构化结果（A2）。取代原先"失败返回空数组/null"的降级，
 * 让渲染层区分"真无数据"与"采集器失败"。
 *
 * - ok:true  采集成功；data 可能为空数组（真无数据）。
 * - ok:false 采集失败；error 描述原因，lastSuccessAt 为上次成功时间（null=从未成功）。
 *   渲染层应保留上次成功 data（不清空）并标注陈旧。
 */
export type CollectResult<T> =
  | { ok: true; data: T; sampledAt: number }
  | { ok: false; error: { code: string; message: string }; lastSuccessAt: number | null };

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
    adapters: Array<{
      name: string;
      totalPercent: number;
      vramUsedBytes: number;
      vramBudgetBytes: number;
      perProcess: Array<{ pid: number; gpuPercent: number; vramBytes: number }>;
    }>;
  };
  timestamp: number;
}

// preload 暴露给 window 的 API 形状
export interface ExposedApi {
  fetchConnections(): Promise<CollectResult<NetConnection[]>>;
  killProcess(pid: number): Promise<boolean>;
  killByName(name: string): Promise<number>;
  killByPids(pids: number[]): Promise<number>;
  killTree(pid: number): Promise<number>;
  // null = 读取失败：权限不足或进程已退出，UI 据此降级提示
  fetchProcessEnv(pid: number): Promise<Record<string, string> | null>;
  // null = 同上；精确 cwd（PEB 直读），与 ProcessInfo.cwd 的启发式值区分
  fetchCwd(pid: number): Promise<string | null>;
  fetchProcesses(): Promise<CollectResult<ProcessInfo[]>>;
  fetchCpu(): Promise<CpuUsage[]>;
  fetchPerf(): Promise<CollectResult<PerfData>>;
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
  // 工作区 Git 身份（B）。接受 cwd（非 pid），main 用 fs 解析。null=非 git 目录/解析失败。
  fetchGitIdentity(cwd: string): Promise<GitIdentity | null>;
  // Run Profiles（F1）。profile 文件 main 持有，渲染层只拿校验过的列表。
  listRunProfiles(): Promise<RunProfile[]>;
  saveRunProfile(profile: Omit<RunProfile, 'id'> & { id?: string }): Promise<RunProfile | null>;
  deleteRunProfile(id: string): Promise<boolean>;
  startProfile(profileId: string): Promise<{ runId: string; pid: number } | null>;
  stopProfile(runId: string): Promise<number>;
  restartProfile(runId: string): Promise<{ runId: string; pid: number } | null>;
  onRunUpdate(cb: (update: RunState) => void): () => void;
  // shell 跳转动作（子项目 A）。返回 '' = 成功，非空 = 错误描述（UI 直接展示）。
  openTarget(kind: OpenTargetKind, path: string): Promise<string>;
  // 浏览器打开 URL，main 侧仅放行 http/https。
  openExternalUrl(url: string): Promise<string>;
}
