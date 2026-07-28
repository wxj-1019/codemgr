import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { IPC } from './ipc-types';

// 开发时加载 vite dev server，生产时加载打包产物
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const RENDERER_DIST = path.join(__dirname, '..', 'dist-renderer');

// 加载 v0.1 已为 electron 编译的 native addon（Task 1 产物）
const native = require(path.join(__dirname, '..', '..', 'codemgr-native', 'build', 'Release', 'codemgr-native.node'));

let win: BrowserWindow | null = null;

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

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  // Windows/Linux 关窗即退出
  app.quit();
});
