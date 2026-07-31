import { useEffect } from 'react';
import { ipc } from '../lib/ipc';
import { PluginFrame } from './PluginFrame';
import { usePluginRegistryStore } from '../store/pluginRegistryStore';

/**
 * 插件编排器（隐形加载器）。
 *
 * 挂载时经 IPC 拉 manifest（main 读 userData/plugins.json，渲染层不碰文件系统），
 * 写入 pluginRegistryStore（共享数据源），并为每个条目渲染一个隐形 `<PluginFrame>`
 * （注册标签规则）。视图插件（mosaic tile）由 App.tsx 按需渲染 `<PluginPanel>`，与此处并存。
 *
 * 错误隔离：单个 PluginFrame 崩溃不波及其它（PoC ④ 已验证 iframe 崩溃隔离）。
 * manifest 不存在/损坏 → listPlugins 返 []，无插件加载，静默无错。
 */
export function PluginHost() {
  const setEntries = usePluginRegistryStore((s) => s.setEntries);
  const entries = usePluginRegistryStore((s) => s.entries);

  useEffect(() => {
    ipc.listPlugins()
      .then(setEntries)
      .catch(() => setEntries([]));  // IPC 失败静默降级为无插件
  }, [setEntries]);

  if (entries.length === 0) return null;

  return (
    <div aria-hidden="true" style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
      {entries.map((entry) => (
        <PluginFrame key={entry.id} entry={entry} />
      ))}
    </div>
  );
}