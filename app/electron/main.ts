import { app, BrowserWindow, ipcMain, Tray, Menu, globalShortcut, nativeImage } from 'electron';
import path from 'node:path';
import { IPC } from './ipc-types';

// 开发时加载 vite dev server，生产时加载打包产物
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const RENDERER_DIST = path.join(__dirname, '..', 'dist-renderer');

// 加载 v0.1 已为 electron 编译的 native addon（Task 1 产物）
const native = require(path.join(__dirname, '..', '..', 'codemgr-native', 'build', 'Release', 'codemgr-native.node'));

let win: BrowserWindow | null = null;
let tray: Tray | null = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 720,
    backgroundColor: '#0f1419',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,   // 安全：隔离
      nodeIntegration: false,   // 安全：渲染进程无 Node
    },
  });

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

app.whenReady().then(() => {
  createWindow();

  // 系统托盘
  const iconPath = path.join(__dirname, '..', 'build', 'tray-icon.png');
  const icon = nativeImage.createFromPath(iconPath);
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
    { label: '退出', click: () => { tray?.destroy(); tray = null; app.quit(); } },
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
