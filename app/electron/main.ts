import { app, BrowserWindow, ipcMain, Tray, Menu, globalShortcut, nativeImage, dialog, utilityProcess, MessageChannelMain, shell } from 'electron';
import path from 'node:path';
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { IPC, type LabelRulesPayload, type LabelRule, type PluginManifestEntry, ALLOWED_CAPABILITIES, type SnapshotEntry, type SnapshotMeta, type ProcessSnapshot, type RunProfile, type RunState, type OpenTargetKind } from './ipc-types';
import { loadWindowState, trackWindowState } from './window-state';
import { RunManager, readProfiles, writeProfiles, validateProfile } from './runProfiles';
import { resolveGitIdentity } from './gitWorkspace';
import { openTarget, openExternalUrl, type ShellDeps, type SpawnLike } from './shellActions';

// 开发时加载 vite dev server，生产时加载打包产物
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const RENDERER_DIST = path.join(__dirname, '..', 'dist-renderer');

// 加载 native 采集层 addon。
// - 开发态：仓库内相对路径 ../../codemgr-native/build/Release/...
// - 打包态：electron-builder 的 extraResources 把 .node 放到 resources/ 下
//   （见 electron-builder.yml 的 extraResources），用 process.resourcesPath 定位
// ABI 不匹配（未为 Electron 重编译）时给出对话框提示，避免无提示闪退
const NATIVE_PATH = app.isPackaged
  ? path.join(process.resourcesPath, 'codemgr-native.node')
  : path.join(__dirname, '..', '..', 'codemgr-native', 'build', 'Release', 'codemgr-native.node');
let native: any;
try {
  native = require(NATIVE_PATH);
} catch (e) {
  dialog.showErrorBox(
    'CodeMgr 启动失败',
    'native 采集层加载失败（可能未为 Electron 重编译）。\n请在仓库根目录执行：cd codemgr-native && pnpm build:electron\n\n' + String(e)
  );
  app.exit(1);
}

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
// 托盘"退出"菜单置位此标志，让 close 处理器不再拦截，app.quit() 才能真正生效
let isQuitting = false;
// 轮询采集的"上次成功时间"，失败时随 CollectResult 返回给渲染层标注陈旧（A2）。
let lastProcessScanAt: number | null = null;
let lastNetScanAt: number | null = null;
let lastPerfAt: number | null = null;

function createWindow() {
  // 恢复上次窗口状态（位置/大小/最大化）。bounds 跑出可见显示器外则回退默认。
  const last = loadWindowState();
  win = new BrowserWindow({
    width: last?.bounds.width ?? 1100,
    height: last?.bounds.height ?? 720,
    minWidth: 760,
    minHeight: 520,
    x: last?.bounds.x,
    y: last?.bounds.y,
    backgroundColor: '#08090c',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#08090c',
      symbolColor: '#f7f8f8',
      height: 40,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,   // 安全：隔离
      nodeIntegration: false,   // 安全：渲染进程无 Node
    },
  });
  if (last?.isMaximized) win.maximize();
  trackWindowState(win);

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'));
  }

  // 最小化 → 隐藏到托盘
  win.on('minimize', () => {
    win?.hide();
  });

  // 关闭按钮 → 仅隐藏，真正退出由托盘菜单控制
  win.on('close', (e) => {
    if (isQuitting) return; // 真正退出时不拦截
    e.preventDefault();
    win?.hide();
  });

  win.on('show', () => {
    win?.focus();
  });
}

// 注册真实 native handler（调用 v0.1 codemgr-native addon）
ipcMain.handle(IPC.FETCH_CONNECTIONS, async () => {
  try {
    const data = native.netScan();
    lastNetScanAt = Date.now();
    return { ok: true as const, data, sampledAt: lastNetScanAt };
  } catch (e) {
    console.error('netScan failed:', e);
    return { ok: false as const, error: { code: 'NET_SCAN_FAILED', message: String(e) }, lastSuccessAt: lastNetScanAt };
  }
});

ipcMain.handle(IPC.KILL_PROCESS, async (_evt, pid: number) => {
  try {
    return native.killProcess(pid);
  } catch (e) {
    console.error('killProcess failed:', e);
    return false;
  }
});

ipcMain.handle(IPC.KILL_BY_NAME, async (_evt, name: string) => {
  try {
    return native.killByName(name);
  } catch (e) {
    console.error('killByName failed:', e);
    return 0;
  }
});

ipcMain.handle(IPC.KILL_BY_PIDS, async (_evt, pids: number[]) => {
  try {
    return native.killByPids(pids);
  } catch (e) {
    console.error('killByPids failed:', e);
    return 0;
  }
});

ipcMain.handle(IPC.KILL_TREE, async (_evt, pid: number) => {
  try {
    return native.killTree(pid);
  } catch (e) {
    console.error('killTree failed:', e);
    return 0;
  }
});

ipcMain.handle(IPC.FETCH_PROCESS_ENV, async (_evt, pid: number) => {
  try {
    return native.readProcessEnv(pid);
  } catch (e) {
    console.error('readProcessEnv failed:', e);
    return null;  // 权限不足 / 进程已退出：渲染层显示降级提示
  }
});

ipcMain.handle(IPC.FETCH_CWD, async (_evt, pid: number) => {
  try {
    return native.readProcessCwd(pid);
  } catch (e) {
    console.error('readProcessCwd failed:', e);
    return null;  // 同 FETCH_PROCESS_ENV：失败降级为 null，UI 提示
  }
});

ipcMain.handle(IPC.FETCH_PROCESSES, async () => {
  try {
    const data = native.processScan();
    lastProcessScanAt = Date.now();
    return { ok: true as const, data, sampledAt: lastProcessScanAt };
  } catch (e) {
    console.error('processScan failed:', e);
    return { ok: false as const, error: { code: 'PROCESS_SCAN_FAILED', message: String(e) }, lastSuccessAt: lastProcessScanAt };
  }
});

ipcMain.handle(IPC.FETCH_CPU, async () => {
  try {
    return native.cpuDelta();
  } catch (e) {
    console.error('cpuDelta failed:', e);
    return [];
  }
});

ipcMain.handle(IPC.FETCH_PERF, async () => {
  try {
    const data = native.perfCounters();
    lastPerfAt = Date.now();
    return { ok: true as const, data, sampledAt: lastPerfAt };
  } catch (e) {
    console.error('perfCounters failed:', e);
    return { ok: false as const, error: { code: 'PERF_FAILED', message: String(e) }, lastSuccessAt: lastPerfAt };
  }
});

// ── 标签规则导入导出（文件 IO 封在 main，渲染层只拿数据/布尔，守红线） ──

// 校验导入载荷的结构合法性。任何字段缺失/类型不符 → 抛错（上层 catch 返 null）。
function validateLabelRulesPayload(x: unknown): LabelRulesPayload {
  if (typeof x !== 'object' || x === null) throw new Error('not an object');
  const o = x as Record<string, unknown>;
  if (o.version !== 1) throw new Error('unsupported version');
  if (!Array.isArray(o.userRules)) throw new Error('userRules must be array');
  if (!Array.isArray(o.disabledDefaultIds)) throw new Error('disabledDefaultIds must be array');
  if (typeof o.overrides !== 'object' || o.overrides === null) {
    throw new Error('overrides must be object');
  }
  // 逐条校验 userRules 形状，防止脏数据让 store 崩
  for (const r of o.userRules as unknown[]) {
    if (typeof r !== 'object' || r === null) throw new Error('rule not an object');
    const rule = r as LabelRule;
    if (typeof rule.id !== 'string' || typeof rule.label !== 'string' ||
        typeof rule.kind !== 'string' || typeof rule.enabled !== 'boolean' ||
        !Array.isArray(rule.groups) || typeof rule.field !== 'string') {
      throw new Error('rule missing required fields');
    }
  }
  return o as unknown as LabelRulesPayload;
}

ipcMain.handle(IPC.EXPORT_LABEL_RULES, async (_evt, payload: LabelRulesPayload) => {
  try {
    const res = await dialog.showSaveDialog({
      title: '导出标签规则',
      defaultPath: 'codemgr-label-rules.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (res.canceled || !res.filePath) return false; // 用户取消
    writeFileSync(res.filePath, JSON.stringify(payload, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('exportLabelRules failed:', e);
    return false;
  }
});

ipcMain.handle(IPC.IMPORT_LABEL_RULES, async () => {
  try {
    const res = await dialog.showOpenDialog({
      title: '导入标签规则',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (res.canceled || res.filePaths.length === 0) return null; // 用户取消
    const raw = readFileSync(res.filePaths[0], 'utf8');
    const parsed = JSON.parse(raw);              // 损坏 JSON → throw → null
    return validateLabelRulesPayload(parsed);    // schema 不符 → throw → null
  } catch (e) {
    console.error('importLabelRules failed:', e);
    return null;
  }
});

// ── 插件 manifest（文件 IO 封在 main，渲染层只拿校验过的条目，守红线） ──
// 读 userData/plugins.json（不存在 → 空数组）。逐条校验 schema，坏条目跳过、整体不崩。
// capabilities 经白名单过滤：未识别项剥离（不整个丢弃插件，只剥离非法能力）。
ipcMain.handle(IPC.LIST_PLUGINS, (): PluginManifestEntry[] => {
  try {
    const file = path.join(app.getPath('userData'), 'plugins.json');
    if (!existsSync(file)) return [];
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(parsed)) return [];
    // 逐条校验：id/name/src 必须是非空字符串，否则跳过（防脏 manifest 让渲染层崩）
    return parsed
      .filter((e): e is PluginManifestEntry =>
        e != null && typeof e === 'object' &&
        typeof e.id === 'string' && e.id.trim() !== '' &&
        typeof e.name === 'string' && e.name.trim() !== '' &&
        typeof e.src === 'string' && e.src.trim() !== ''
      )
      .map((e) => {
        // capabilities 白名单过滤：只保留 ALLOWED_CAPABILITIES 内的项（红线：插件不能自带 .node）
        if (!Array.isArray(e.capabilities)) return e;
        const allowed = e.capabilities.filter((c) => typeof c === 'string' && ALLOWED_CAPABILITIES.has(c));
        return allowed.length > 0 ? { ...e, capabilities: allowed } : { ...e, capabilities: undefined };
      });
  } catch (e) {
    console.error('listPlugins failed:', e);
    return [];
  }
});

// 应用版本号（来自 package.json，经 app.getVersion()）。渲染层用于显示当前版本。
ipcMain.handle(IPC.APP_VERSION, () => app.getVersion());

// ── 开机自启（login item）──
// 读取当前登录启动状态
ipcMain.handle(IPC.GET_AUTO_LAUNCH, () => app.getLoginItemSettings().openAtLogin);

// 设置登录启动，返回设置后的实际状态（以系统为准，UI 据此回滚）
// 注意：开发模式（pnpm dev）下 setLoginItemSettings 指向的是 electron.exe 而非
// 打包后的 CodeMgr.exe，这是 Electron 的已知行为——打包后（app.isPackaged）生效。
ipcMain.handle(IPC.SET_AUTO_LAUNCH, (_evt, enabled: boolean) => {
  try {
    app.setLoginItemSettings({ openAtLogin: enabled });
  } catch (e) {
    console.error('setLoginItemSettings failed:', e);
  }
  // 无论成败都返回实际状态，渲染层据此回滚 UI
  return app.getLoginItemSettings().openAtLogin;
});

// ── 进程快照对比（v2.2，spec §2.2）──
// 受控文件 IO：userData/snapshots/<id>.json，一快照一文件。
// 渲染层不指定 id（save 时 main 用 crypto.randomUUID() 生成），id 必须匹配
// uuid 正则（防 `../../` 逃逸 userData 的路径穿越攻击，红线 D7）。
const SNAPSHOT_MAX = 20;                          // 上限 20，防无限增长
const SNAPSHOT_DIR = () => path.join(app.getPath('userData'), 'snapshots');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// 路径穿越防护：id 必须严格匹配 uuid 形式，任何含路径分隔符/点的值都被拒。
function isValidSnapshotId(id: string): boolean {
  return typeof id === 'string' && UUID_RE.test(id);
}

// 校验单条 SnapshotEntry 结构（防坏文件让 store 崩）。失败抛错，由上层 catch 转为 null。
function validateSnapshotEntry(x: unknown): SnapshotEntry {
  if (typeof x !== 'object' || x === null) throw new Error('entry not object');
  const e = x as Record<string, unknown>;
  if (typeof e.pid !== 'number' || !Number.isFinite(e.pid)) throw new Error('pid');
  if (typeof e.createTimeMs !== 'number' || !Number.isFinite(e.createTimeMs)) throw new Error('createTimeMs');
  if (typeof e.name !== 'string') throw new Error('name');
  if (typeof e.cmdline !== 'string') throw new Error('cmdline');
  if (typeof e.cwd !== 'string') throw new Error('cwd');
  if (typeof e.workingSetBytes !== 'number' || !Number.isFinite(e.workingSetBytes)) throw new Error('workingSetBytes');
  return e as unknown as SnapshotEntry;
}

// 校验完整 ProcessSnapshot 结构（load 时用）。坏 schema 抛错 → 上层 catch 返 null。
function validateProcessSnapshot(x: unknown): ProcessSnapshot {
  if (typeof x !== 'object' || x === null) throw new Error('snapshot not object');
  const o = x as Record<string, unknown>;
  if (!isValidSnapshotId(o.id as string)) throw new Error('id');
  if (typeof o.name !== 'string') throw new Error('name');
  if (typeof o.createdAt !== 'number' || !Number.isFinite(o.createdAt)) throw new Error('createdAt');
  if (!Array.isArray(o.entries)) throw new Error('entries');
  for (const e of o.entries) validateSnapshotEntry(e);
  return o as unknown as ProcessSnapshot;
}

// list：读目录所有 .json，只返元信息（id/name/createdAt/count）。坏文件跳过、整体不崩。
ipcMain.handle(IPC.SNAPSHOT_LIST, (): SnapshotMeta[] => {
  try {
    const dir = SNAPSHOT_DIR();
    if (!existsSync(dir)) return [];
    const metas: SnapshotMeta[] = [];
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const parsed = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
        const snap = validateProcessSnapshot(parsed);
        metas.push({ id: snap.id, name: snap.name, createdAt: snap.createdAt, count: snap.entries.length });
      } catch {
        // 单个坏文件跳过，不影响其余快照列出（spec §2.6 风险对策）
      }
    }
    // 按 createdAt 倒序：最新的快照排在最前，与 UI 直觉一致。
    metas.sort((a, b) => b.createdAt - a.createdAt);
    return metas;
  } catch (e) {
    console.error('snapshot:list failed:', e);
    return [];
  }
});

// save：main 生成 id，校验 schema + 上限 20，写 <id>.json。失败返 null。
ipcMain.handle(IPC.SNAPSHOT_SAVE, (_evt, name: string, entries: SnapshotEntry[]): ProcessSnapshot | null => {
  try {
    if (typeof name !== 'string' || name.trim() === '') {
      console.error('snapshot:save rejected: empty name');
      return null;
    }
    if (!Array.isArray(entries)) {
      console.error('snapshot:save rejected: entries not array');
      return null;
    }
    // 逐条校验，任一非法即拒（防脏数据污染磁盘存储）
    for (const e of entries) validateSnapshotEntry(e);

    const dir = SNAPSHOT_DIR();
    // 上限检查：count 现有 .json 数；超出提示删旧（spec §2.2 上限 20）。
    if (existsSync(dir)) {
      const existing = readdirSync(dir).filter((f) => f.endsWith('.json')).length;
      if (existing >= SNAPSHOT_MAX) {
        console.error(`snapshot:save rejected: 上限 ${SNAPSHOT_MAX} 已满`);
        return null;
      }
    } else {
      mkdirSync(dir, { recursive: true });
    }

    const id = randomUUID();                  // main 生成 id，渲染层不指定（消除穿越面）
    const snap: ProcessSnapshot = {
      id,
      name: name.trim(),
      createdAt: Date.now(),
      entries,
    };
    writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(snap, null, 2), 'utf8');
    return snap;
  } catch (e) {
    console.error('snapshot:save failed:', e);
    return null;
  }
});

// load：按 id 读全量。id 非 uuid / 文件不存在 / 损坏 → null。
ipcMain.handle(IPC.SNAPSHOT_LOAD, (_evt, id: string): ProcessSnapshot | null => {
  try {
    if (!isValidSnapshotId(id)) {
      console.error('snapshot:load rejected: invalid id (path traversal guard)');
      return null;
    }
    const file = path.join(SNAPSHOT_DIR(), `${id}.json`);
    if (!existsSync(file)) return null;
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return validateProcessSnapshot(parsed);     // schema 不符 → throw → null
  } catch (e) {
    console.error('snapshot:load failed:', e);
    return null;
  }
});

// delete：按 id 删文件，返是否成功。
ipcMain.handle(IPC.SNAPSHOT_DELETE, (_evt, id: string): boolean => {
  try {
    if (!isValidSnapshotId(id)) {
      console.error('snapshot:delete rejected: invalid id (path traversal guard)');
      return false;
    }
    const file = path.join(SNAPSHOT_DIR(), `${id}.json`);
    if (!existsSync(file)) return false;        // 文件不存在视为失败（id 错误或已被删）
    unlinkSync(file);
    return true;
  } catch (e) {
    console.error('snapshot:delete failed:', e);
    return false;
  }
});

// 工作区 Git 身份（B）：纯 fs 解析，catch→null（非 git 目录/权限/边界）。
ipcMain.handle(IPC.FETCH_GIT_IDENTITY, async (_evt, cwd: string) => {
  try {
    return resolveGitIdentity(cwd);
  } catch (e) {
    console.error('fetchGitIdentity failed:', e);
    return null;
  }
});

// ── shell 跳转动作（子项目 A）──
// 校验/编排全在 shellActions（纯逻辑），这里只做 electron/child_process 真实依赖装配。
const shellDeps: ShellDeps = {
  openPath: (p) => shell.openPath(p),
  openExternal: (url) => shell.openExternal(url).then(() => undefined),
  spawn: (file, args, options): SpawnLike => spawn(file, args, options),
  commandExists: (file) =>
    new Promise((resolve) => {
      const p = spawn('cmd.exe', ['/c', 'where', file], { stdio: 'ignore' });
      p.on('error', () => resolve(false));
      p.on('exit', (code) => resolve(code === 0));
    }),
  exists: (p) => existsSync(p),
};

ipcMain.handle(IPC.OPEN_TARGET, async (_evt, kind: OpenTargetKind, targetPath: string) => {
  try { return await openTarget(kind, targetPath, shellDeps); }
  catch (e) { console.error('shell:openTarget failed:', e); return String(e); }
});

ipcMain.handle(IPC.OPEN_EXTERNAL_URL, async (_evt, url: string) => {
  try { return await openExternalUrl(url, shellDeps); }
  catch (e) { console.error('shell:openExternalUrl failed:', e); return String(e); }
});

// ── Run Profiles（F1）──
// 受控启动/停止开发服务。spawn 在 main（白名单 command + execFile 无 shell），渲染层只传 profileId/runId。
const RUN_PROFILES_FILE = () => path.join(app.getPath('userData'), 'run-profiles.json');
const runManager = new RunManager(
  native,  // 复用 native killTree（停止时收集后代 + 过保护名单）
  (state) => { win?.webContents.send(IPC.RUN_UPDATE, state); },  // run 状态变更 → 推送渲染层
);

ipcMain.handle(IPC.RUN_PROFILE_LIST, (): RunProfile[] => {
  try { return readProfiles(RUN_PROFILES_FILE()); }
  catch (e) { console.error('run:list failed:', e); return []; }
});

ipcMain.handle(IPC.RUN_PROFILE_SAVE, (_evt, profile: Omit<RunProfile, 'id'> & { id?: string }): RunProfile | null => {
  try {
    const full: RunProfile = { ...profile, id: profile.id ?? randomUUID() };
    const validated = validateProfile(full);
    if (!validated) return null;
    const profiles = readProfiles(RUN_PROFILES_FILE());
    const idx = profiles.findIndex((p) => p.id === validated.id);
    if (idx >= 0) profiles[idx] = validated; else profiles.push(validated);
    writeProfiles(RUN_PROFILES_FILE(), profiles);
    return validated;
  } catch (e) { console.error('run:save failed:', e); return null; }
});

ipcMain.handle(IPC.RUN_PROFILE_DELETE, (_evt, id: string): boolean => {
  try {
    writeProfiles(RUN_PROFILES_FILE(), readProfiles(RUN_PROFILES_FILE()).filter((p) => p.id !== id));
    return true;
  } catch (e) { console.error('run:delete failed:', e); return false; }
});

ipcMain.handle(IPC.RUN_START, (_evt, profileId: string): { runId: string; pid: number } | null => {
  try {
    const profile = readProfiles(RUN_PROFILES_FILE()).find((p) => p.id === profileId);
    if (!profile) return null;
    return runManager.start(profile);
  } catch (e) { console.error('run:start failed:', e); return null; }
});

ipcMain.handle(IPC.RUN_STOP, (_evt, runId: string): number => {
  try { return runManager.stop(runId); }
  catch (e) { console.error('run:stop failed:', e); return 0; }
});

ipcMain.handle(IPC.RUN_RESTART, (_evt, runId: string): { runId: string; pid: number } | null => {
  try {
    const state = runManager.getState(runId);
    if (!state) return null;
    const profile = readProfiles(RUN_PROFILES_FILE()).find((p) => p.id === state.profileId);
    if (!profile) return null;
    return runManager.restart(profile, runId);
  } catch (e) { console.error('run:restart failed:', e); return null; }
});

// ── 插件数据源 UtilityProcess（6c）──
// UtilityProcess 承载 native 数据源采集，进程级隔离。主进程经 MessagePort 与之通信。
// 这是可选增强——崩溃时重新 fork，不影响主功能（主 app 不依赖它）。
let utilityChild: Electron.UtilityProcess | null = null;
let utilityPort: Electron.MessagePortMain | null = null;
let requestCounter = 0;
const pendingRequests = new Map<number, { capability: string; resolve: (data: unknown) => void; reject: (e: Error) => void }>();

function startUtilityProcess() {
  // 开发态 __dirname=app/electron（源是 .mjs）；打包态 __dirname=dist-electron（vite 产物是 .js）
  const hostPath = path.join(__dirname, app.isPackaged ? 'utility-host.js' : 'utility-host.mjs');
  if (!existsSync(hostPath)) return;  // 脚本缺失（开发态构建问题）静默跳过
  try {
    const child = utilityProcess.fork(hostPath, [], {
      env: { ...process.env, CODEMGR_NATIVE_PATH: NATIVE_PATH },
    });
    // 建 MessageChannel，port 一端发子进程，main 持有另一端收回复
    const { port1, port2 } = new MessageChannelMain();
    child.postMessage({ type: 'init' }, [port2]);
    utilityPort = port1;
    const port = port1;
    port.on('message', (e) => {
      const msg = e.data;
      if (!msg || typeof msg !== 'object') return;
      // 匹配待处理请求，resolve/reject
      const pending = typeof msg.id === 'number' ? pendingRequests.get(msg.id) : undefined;
      if (pending) {
        pendingRequests.delete(msg.id);
        if (msg.error) pending.reject(new Error(String(msg.error)));
        else pending.resolve(msg.data);
      }
    });
    port.start();
    child.on('exit', (code) => {
      console.error(`[utility] 进程退出 code=${code}`);
      utilityChild = null;
      utilityPort = null;
      // 拒绝所有待处理请求，防 renderer 卡死
      for (const p of pendingRequests.values()) p.reject(new Error('UtilityProcess 退出'));
      pendingRequests.clear();
      // 崩溃恢复：延迟重启（避免崩溃循环）
      setTimeout(startUtilityProcess, 2000);
    });
    utilityChild = child;
  } catch (e) {
    console.error('[utility] fork 失败:', e);
  }
}

// renderer 请求某 capability 数据 → 转发 UtilityProcess 采集 → 结果推回 renderer
ipcMain.handle(IPC.REQUEST_DATA_SOURCE, async (_evt, capability: string) => {
  if (!utilityPort || !utilityChild) {
    throw new Error('UtilityProcess 未就绪');
  }
  const id = ++requestCounter;
  return new Promise<void>((resolve, reject) => {
    pendingRequests.set(id, {
      capability,
      resolve: (data) => {
        // 推回 renderer（事件 DATA_SOURCE_RESULT）
        win?.webContents.send(IPC.DATA_SOURCE_RESULT, { capability, data });
        resolve();
      },
      reject: (e) => reject(e),
    });
    try {
      utilityPort!.postMessage({ id, capability });
    } catch (e) {
      pendingRequests.delete(id);
      reject(e as Error);
    }
  });
});

app.whenReady().then(() => {
  createWindow();
  // 启动 UtilityProcess（6c 数据源）。延迟到窗口就绪后，避免影响启动速度。
  startUtilityProcess();

  // 系统托盘图标：开发态在 app/build/，打包态在 resources/（extraResources）。
  // 图标文件缺失时降级为空图标，避免 createFromPath 返回空对象导致 Tray 崩。
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'tray-icon.png')
    : path.join(__dirname, '..', 'build', 'tray-icon.png');
  const icon = existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('CodeMgr — 开发者工作流管理器');
  tray.on('click', () => {
    if (win) {
      if (win.isVisible()) {
        win.hide();
      } else {
        win.show();
        win.focus();
      }
    }
  });
  const contextMenu = Menu.buildFromTemplate([
    { label: '显示', click: () => { win?.show(); win?.focus(); } },
    { label: '隐藏', click: () => win?.hide() },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; tray?.destroy(); tray = null; app.quit(); } },
  ]);
  tray.setContextMenu(contextMenu);

  // 全局热键：Ctrl+Shift+M 切换窗口
  const ret = globalShortcut.register('CommandOrControl+Shift+M', () => {
    if (!win) return;
    if (win.isVisible() && win.isFocused()) {
      win.hide();
    } else {
      win.show();
      win.focus();
    }
  });
  if (!ret) console.error('globalShortcut registration failed');
});

// 窗口已改为“关闭即隐藏”，window-all-closed 不会触发；
// 即便触发也直接返回，不调用 app.quit()，保持托盘常驻。
app.on('window-all-closed', () => {
  // 不退出：托盘菜单 / 全局热键控制显隐，真正退出走“退出”菜单项。
});

// 退出时清理全局热键
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
