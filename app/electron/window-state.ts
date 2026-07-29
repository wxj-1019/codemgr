// 窗口状态持久化：把窗口的 bounds（位置+大小）与 maximize 状态存到
// userData/window-state.json，下次启动恢复。自实现，不引入新依赖。
//
// 边界处理：
// - 显示器断开/换分辨率后，上次 bounds 可能跑出可见区域。加载时用
//   screen.getDisplayMatching() 校验，bounds 不落在任何显示器上则丢弃，
//   回退默认尺寸（避免窗口"消失"到屏外）。
// - 写盘防抖（500ms）：resize/move 会高频触发，避免每个像素都写一次。
import { app, screen, type BrowserWindow } from 'electron';
import path from 'node:path';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

interface WindowState {
  bounds: { x: number; y: number; width: number; height: number };
  isMaximized?: boolean;
}

const STATE_FILE = path.join(app.getPath('userData'), 'window-state.json');

/** 读取并校验上次窗口状态。bounds 落在可见显示器外则返回 null（用默认）。 */
export function loadWindowState(): WindowState | null {
  if (!existsSync(STATE_FILE)) return null;
  try {
    const raw = readFileSync(STATE_FILE, 'utf8');
    const s = JSON.parse(raw) as WindowState;
    if (!s.bounds || typeof s.bounds.width !== 'number') return null;
    // 校验：bounds 中心是否落在某显示器内（getDisplayMatching 返回重叠最多的屏）
    const display = screen.getDisplayMatching(s.bounds);
    // 若返回的是主屏且 bounds 与主屏无交集，说明 bounds 在所有屏之外
    const vis = display.bounds;
    const intersects =
      s.bounds.x < vis.x + vis.width &&
      s.bounds.x + s.bounds.width > vis.x &&
      s.bounds.y < vis.y + vis.height &&
      s.bounds.y + s.bounds.height > vis.y;
    return intersects ? s : null;
  } catch {
    return null; // 损坏的 JSON → 回退默认
  }
}

/** 监听窗口状态变化，防抖写盘。返回取消监听的函数。 */
export function trackWindowState(win: BrowserWindow): () => void {
  let timer: NodeJS.Timeout | null = null;
  const save = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      try {
        const state: WindowState = {
          bounds: win.getNormalBounds(), // getNormalBounds 不含最大化时的全屏尺寸
          isMaximized: win.isMaximized(),
        };
        writeFileSync(STATE_FILE, JSON.stringify(state), 'utf8');
      } catch {
        // 写盘失败不致命（只读盘空间满/权限），忽略
      }
    }, 500);
  };
  // 显式绑定 4 个事件（TS 对联合类型事件名的 on 重载匹配不稳，逐个写更清晰）
  const onResize = () => save();
  const onMove = () => save();
  const onMax = () => save();
  const onUnmax = () => save();
  win.on('resize', onResize);
  win.on('move', onMove);
  win.on('maximize', onMax);
  win.on('unmaximize', onUnmax);
  return () => {
    if (timer) clearTimeout(timer);
    win.off('resize', onResize);
    win.off('move', onMove);
    win.off('maximize', onMax);
    win.off('unmaximize', onUnmax);
  };
}
