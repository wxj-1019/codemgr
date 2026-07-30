// shell 跳转动作的渲染层统一出口。所有 UI 调用点走这里，失败经 toast 反馈（子项目 B）。
import { ipc } from './ipc';
import { notify } from './notify';
import type { OpenTargetKind } from '../../electron/ipc-types';

export async function openTargetOrNotify(kind: OpenTargetKind, path: string): Promise<void> {
  try {
    const err = await ipc.openTarget(kind, path);
    if (err) notify.error(err);
  } catch (e) {
    notify.error(`打开失败：${String(e)}`);
  }
}

export async function openExternalUrlOrNotify(url: string): Promise<void> {
  try {
    const err = await ipc.openExternalUrl(url);
    if (err) notify.error(err);
  } catch (e) {
    notify.error(`打开失败：${String(e)}`);
  }
}

export function copyText(text: string): void {
  navigator.clipboard?.writeText(text).catch(() => { /* blocked */ });
}
