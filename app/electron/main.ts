import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';

// 开发时加载 vite dev server，生产时加载打包产物
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const RENDERER_DIST = path.join(__dirname, '..', 'dist-renderer');

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

// 先注册占位 handler（下个任务换成真实 native 调用）
ipcMain.handle('net:fetchConnections', async () => []);
ipcMain.handle('proc:killProcess', async () => false);
ipcMain.handle('proc:killByName', async () => 0);

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  // Windows/Linux 关窗即退出
  app.quit();
});
