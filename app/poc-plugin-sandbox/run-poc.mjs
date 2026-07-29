// PoC 验证脚本：用 Electron（=CodeMgr 目标 Chromium）加载 host.html，
// 通过 webContents.executeJavaScript 验证 iframe sandbox 的 4 项行为。
// 运行：ELECTRON_RUN_AS_NODE=1 不行（变纯 Node），需正式 electron GUI 入口。
// 用法：electron app/poc-plugin-sandbox/run-poc.mjs
import { app, BrowserWindow } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const results = { p1: null, p2: null, p3: null, p4: null };

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  await win.loadURL('http://localhost:8765/host.html');

  // 等插件 iframe ready
  await win.webContents.executeJavaScript(`
    (async () => {
      for (let i = 0; i < 50; i++) {
        if (window.__pluginReady && window.__accessReport) return true;
        await new Promise(r => setTimeout(r, 100));
      }
      return false;
    })()
  `).then(async (ready) => {
    results.p2_ready = ready;
    // PoC ②：读取访问检测报告
    results.p2 = await win.webContents.executeJavaScript('window.__accessReport');
  });

  // PoC ①：点推送快照，等 React 渲染，读 iframe 上报的 render-report
  await win.webContents.executeJavaScript("document.getElementById('btn-snapshot').click()");
  await sleep(1000);
  results.p1 = await win.webContents.executeJavaScript('window.__renderReport');

  // PoC ③：点推送主题，读 iframe 上报的 theme-report
  await win.webContents.executeJavaScript("document.getElementById('btn-theme').click()");
  await sleep(600);
  results.p3 = await win.webContents.executeJavaScript('window.__themeReport');

  // PoC ④：触发插件崩溃，等 2s，检查主框架是否存活
  await win.webContents.executeJavaScript("document.getElementById('btn-crash').click()");
  await sleep(2000);
  results.p4 = await win.webContents.executeJavaScript(`
    (function(){
      return {
        hostAlive: window.__hostAliveAfterCrash === true,
        statusText: document.getElementById('status').textContent,
        logTail: document.getElementById('log').textContent.split('\\n').slice(-3),
      };
    })()
  `);

  console.log('=== PoC 结果 ===');
  console.log(JSON.stringify(results, null, 2));
  app.quit();
});

app.on('window-all-closed', () => app.quit());
