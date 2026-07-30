// shell 跳转动作的渲染层统一出口。所有 UI 调用点走这里，
// 子项目 B（Toast）落地时只需改这一个文件即可把 alert 全量替换为 toast。
import { ipc } from './ipc';
import type { OpenTargetKind } from '../../electron/ipc-types';

export async function openTargetOrAlert(kind: OpenTargetKind, path: string): Promise<void> {
  try {
    const err = await ipc.openTarget(kind, path);
    if (err) alert(err);
  } catch (e) {
    alert(`打开失败：${String(e)}`);
  }
}

export async function openExternalUrlOrAlert(url: string): Promise<void> {
  try {
    const err = await ipc.openExternalUrl(url);
    if (err) alert(err);
  } catch (e) {
    alert(`打开失败：${String(e)}`);
  }
}

export function copyText(text: string): void {
  navigator.clipboard?.writeText(text).catch(() => { /* blocked */ });
}
