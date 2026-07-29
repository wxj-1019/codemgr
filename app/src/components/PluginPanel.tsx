import { useEffect, useRef, useState } from 'react';
import { usePluginRegistryStore } from '../store/pluginRegistryStore';
import { useProcessPanelStore } from '../store/processPanelStore';
import { usePortRadarStore } from '../store/portRadarStore';
import { useVisibilityStore } from '../store/visibilityStore';
import { useThemeStore } from '../store/themeStore';
import { ipc } from '../lib/ipc';
import type { HostToPluginMsg, ReadonlyProcessInfo, ReadonlyConnection } from '../lib/pluginProtocol';

// 快照推送间隔（与 process 面板轮询一致，2s）。视图插件据此刷新。
const SNAPSHOT_INTERVAL_MS = 2000;

/**
 * 插件视图面板（mosaic tile 内的可视 iframe）。
 *
 * 与隐形 PluginFrame（注册标签规则）并存——同一插件 src 可被两种方式加载。
 * 插件经 manifest 登记，用户点"添加面板"后作为 `plugin:<id>` tile 进入 mosaic。
 *
 * 安全（与 PluginFrame 同一契约）：`sandbox="allow-scripts"`，**绝不加 allow-same-origin**。
 * 这是 PluginFrame 之外第二个签发 sandbox 的地方——两处都受 spike 风险表 #1 约束。
 *
 * 数据源：主框架主动推送只读快照（脱敏子集：进程的 pid/name/mem，端口的端口/状态/pid/进程名）。
 * 不可见时停推（visibilityStore 节流，避免 IPC 尖刺）。同时推送主题 CSS 变量。
 */
export function PluginPanel({ id }: { id: string }) {
  const pluginId = id.slice('plugin:'.length);
  const entry = usePluginRegistryStore((s) => s.find(pluginId));
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'errored' | 'missing'>('loading');

  // 数据源：从内置面板 store 读，脱敏后推送
  const processes = useProcessPanelStore((s) => s.processes);
  const connections = usePortRadarStore((s) => s.connections);
  // 可见性：不可见时停推快照（节流）
  const pollable = useVisibilityStore((s) => s.windowVisible && !!s.visible[id]);
  const theme = useThemeStore((s) => s.theme);

  // 找不到 manifest 条目（插件被移除但叶子未清理）
  if (!entry) {
    return (
      <div className="flex h-full items-center justify-center text-fg-muted text-sm p-4 text-center">
        插件「{pluginId}」未在 manifest 中登记（可能已被移除）。关闭此面板即可。
      </div>
    );
  }

  const post = (msg: HostToPluginMsg) => {
    try {
      iframeRef.current?.contentWindow?.postMessage(msg, '*');
    } catch { /* 插件已销毁，忽略 */ }
  };

  // 推送只读快照（脱敏：只取 pid/name/mem + port/state/pid/procname）
  const sendSnapshot = () => {
    const procs: ReadonlyProcessInfo[] = processes.map((p) => ({
      pid: p.pid, name: p.name, workingSetBytes: p.workingSetBytes,
    }));
    const ports: ReadonlyConnection[] = connections.map((c) => ({
      protocol: c.protocol, localPort: c.localPort, state: c.state,
      pid: c.pid, processName: c.processName,
    }));
    post({ type: 'snapshot', processes: procs, ports });
  };

  // 推送主题 CSS 变量（与 index.css 的 :root / :root.light 定义一致）
  const sendTheme = () => {
    const root = document.documentElement;
    const cs = getComputedStyle(root);
    const vars: Record<string, string> = {};
    for (const k of ['--bg-base', '--bg-panel', '--bg-elevated', '--text-primary', '--text-secondary', '--text-muted', '--border']) {
      const v = cs.getPropertyValue(k).trim();
      if (v) vars[k] = v;
    }
    post({ type: 'theme', vars });
  };

  useEffect(() => {
    if (status !== 'ready') return;
    if (!pollable) return;  // 不可见：停推
    sendSnapshot();
    sendTheme();
    const timer = setInterval(() => {
      sendSnapshot();
    }, SNAPSHOT_INTERVAL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, pollable, processes, connections]);

  // iframe 加载就绪后推 ready + 首次快照/主题
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

  // 数据源订阅（6c）：插件声明 capabilities 时，请求数据 + 监听结果转发进 iframe
  useEffect(() => {
    const caps = entry?.capabilities;
    if (!caps || caps.length === 0) return;
    // 订阅数据源结果事件，按 capability 路由转发
    const unsubscribe = ipc.onDataSourceResult((capability, data) => {
      if (caps.includes(capability)) post({ type: 'dataSource', capability, data });
    });
    // 对每个 capability 发起一次请求（本次管道验证：订阅即推一次；周期轮询留后续）
    for (const cap of caps) {
      ipc.requestDataSource(cap).catch(() => { /* UtilityProcess 未就绪，静默 */ });
    }
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.capabilities]);

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
      // 关键安全属性：与 PluginFrame 同一契约，绝不加 allow-same-origin（spike 风险表 #1）
      sandbox="allow-scripts"
      src={entry.src}
      title={entry.name}
      className="h-full w-full border-0 bg-base-panel"
    />
  );
}
