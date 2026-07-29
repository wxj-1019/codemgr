import { useEffect, useState } from 'react';
import type { PluginManifestEntry } from '../../electron/ipc-types';
import { ipc } from '../lib/ipc';
import { PluginFrame } from './PluginFrame';

/**
 * 插件编排器（隐形加载器）。
 *
 * 挂载时经 IPC 拉 manifest（main 读 userData/plugins.json，渲染层不碰文件系统），
 * 为每个条目渲染一个 `<PluginFrame>`。本次（6b 第一步）插件只跑逻辑注册标签规则，
 * 无可视 UI——iframe 用 display:none 承载。
 *
 * 错误隔离：单个 PluginFrame 崩溃不波及其它（PoC ④ 已验证 iframe 崩溃隔离）。
 * manifest 不存在/损坏 → listPlugins 返 []，无插件加载，静默无错。
 */
export function PluginHost() {
  const [entries, setEntries] = useState<PluginManifestEntry[]>([]);

  useEffect(() => {
    ipc.listPlugins()
      .then(setEntries)
      .catch(() => setEntries([]));  // IPC 失败静默降级为无插件
  }, []);

  if (entries.length === 0) return null;

  return (
    <div aria-hidden="true" style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
      {entries.map((entry) => (
        <PluginFrame key={entry.id} entry={entry} />
      ))}
    </div>
  );
}
