import { useEffect, useRef, useState } from 'react';
import type { PluginManifestEntry } from '../../electron/ipc-types';
import { usePluginRegistryStore } from '../store/pluginRegistryStore';
import { useProcessPanelStore } from '../store/processPanelStore';
import { usePortRadarStore } from '../store/portRadarStore';
import { useVisibilityStore } from '../store/visibilityStore';
import { useThemeStore } from '../store/themeStore';
import { ipc } from '../lib/ipc';
import type { HostToPluginMsg, ReadonlyProcessInfo, ReadonlyConnection } from '../lib/pluginProtocol';

const SNAPSHOT_INTERVAL_MS = 2000;

export function PluginPanel({ id }: { id: string }) {
  const pluginId = id.slice('plugin:'.length);
  const entry = usePluginRegistryStore((state) => state.find(pluginId));

  if (!entry) {
    return (
      <div className="flex h-full items-center justify-center text-fg-muted text-sm p-4 text-center">
        插件「{pluginId}」未在 manifest 中登记（可能已被移除）。关闭此面板即可。
      </div>
    );
  }

  return <LoadedPluginPanel id={id} entry={entry} />;
}

export function LoadedPluginPanel({ id, entry }: { id: string; entry: PluginManifestEntry }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'errored'>('loading');
  const processes = useProcessPanelStore((state) => state.processes);
  const connections = usePortRadarStore((state) => state.connections);
  const pollable = useVisibilityStore((state) => state.windowVisible && !!state.visible[id]);
  const theme = useThemeStore((state) => state.theme);

  const post = (msg: HostToPluginMsg) => {
    try {
      iframeRef.current?.contentWindow?.postMessage(msg, '*');
    } catch { /* Plugin frame was destroyed. */ }
  };

  const sendSnapshot = () => {
    const procs: ReadonlyProcessInfo[] = processes.map((process) => ({
      pid: process.pid,
      name: process.name,
      workingSetBytes: process.workingSetBytes,
    }));
    const ports: ReadonlyConnection[] = connections.map((connection) => ({
      protocol: connection.protocol,
      localPort: connection.localPort,
      state: connection.state,
      pid: connection.pid,
      processName: connection.processName,
    }));
    post({ type: 'snapshot', processes: procs, ports });
  };

  const sendTheme = () => {
    const styles = getComputedStyle(document.documentElement);
    const vars: Record<string, string> = {};
    for (const key of ['--bg-base', '--bg-panel', '--bg-elevated', '--text-primary', '--text-secondary', '--text-muted', '--border']) {
      const value = styles.getPropertyValue(key).trim();
      if (value) vars[key] = value;
    }
    post({ type: 'theme', vars });
  };

  useEffect(() => {
    if (status !== 'ready' || !pollable) return;
    sendSnapshot();
    sendTheme();
    const timer = setInterval(sendSnapshot, SNAPSHOT_INTERVAL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, pollable, processes, connections, theme]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const onLoad = () => {
      setStatus('ready');
      post({ type: 'ready' });
    };
    const onError = () => setStatus('errored');
    iframe.addEventListener('load', onLoad);
    iframe.addEventListener('error', onError);
    return () => {
      iframe.removeEventListener('load', onLoad);
      iframe.removeEventListener('error', onError);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const caps = entry.capabilities;
    if (!caps || caps.length === 0) return;
    const unsubscribe = ipc.onDataSourceResult((capability, data) => {
      if (caps.includes(capability)) post({ type: 'dataSource', capability, data });
    });
    for (const capability of caps) {
      ipc.requestDataSource(capability).catch(() => { /* UtilityProcess is not ready. */ });
    }
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.capabilities]);

  if (status === 'errored') {
    return (
      <div className="flex h-full items-center justify-center text-fg-muted text-sm p-4 text-center">
        插件「{entry.name}」加载失败。
      </div>
    );
  }

  return (
    <iframe
      ref={iframeRef}
      sandbox="allow-scripts"
      src={entry.src}
      title={entry.name}
      className="h-full w-full border-0 bg-base-panel"
    />
  );
}
