import { app, BrowserWindow, ipcMain, Tray, Menu, globalShortcut, nativeImage, dialog } from 'electron';
import path from 'node:path';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { IPC, type LabelRulesPayload, type LabelRule } from './ipc-types';
import { loadWindowState, trackWindowState } from './window-state';

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

function createWindow() {
  // 恢复上次窗口状态（位置/大小/最大化）。bounds 跑出可见显示器外则回退默认。
  const last = loadWindowState();
  win = new BrowserWindow({
    width: last?.bounds.width ?? 1100,
    height: last?.bounds.height ?? 720,
    x: last?.bounds.x,
    y: last?.bounds.y,
    backgroundColor: '#0f1419',
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
    return native.netScan();
  } catch (e) {
    console.error('netScan failed:', e);
    return [];
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
    return native.processScan();
  } catch (e) {
    console.error('processScan failed:', e);
    return [];
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
    return native.perfCounters();
  } catch (e) {
    console.error('perfCounters failed:', e);
    return null;
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

// 应用版本号（来自 package.json，经 app.getVersion()）。渲染层用于显示当前版本。
ipcMain.handle(IPC.APP_VERSION, () => app.getVersion());

app.whenReady().then(() => {
  createWindow();

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
