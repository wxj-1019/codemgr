import { useEffect, useRef, useState } from 'react';
import type { PluginManifestEntry } from '../../electron/ipc-types';
import { useLabelRulesStore } from '../store/labelRulesStore';
import { type PluginToHostMsg, validatePluginRules } from '../lib/pluginProtocol';

/**
 * 单个插件的 iframe 沙箱承载 + postMessage 双向通信。
 *
 * 安全（F1 PoC 已锁定）：iframe 用 `sandbox="allow-scripts"`，**绝不加 allow-same-origin**——
 * 这是本文件唯一签发 sandbox 属性的地方（spike 风险表 #1：误加 allow-same-origin 会
 * 让插件自行移除沙箱，等于无沙箱）。结构上插件无 Node/Electron（PoC ② 实证全 undefined）。
 *
 * 本次能力（6b 第一步）：插件经 registerLabelRules 注册标签规则。规则经
 * validatePluginRules 严格校验后写入 pluginRules 层（独立于 userRules，不持久化）。
 *
 * 崩溃熔断：iframe onError / load 失败 → 标记 errored，不再加载。PoC ④ 已验证
 * iframe 崩溃不波及主窗口；此处额外捕获加载失败，显示占位。
 *
 * 卸载清理：组件 unmount 时清空该插件的 pluginRules，防规则残留。
 */
export function PluginFrame({ entry }: { entry: PluginManifestEntry }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'errored'>('loading');
  const setPluginRules = useLabelRulesStore((s) => s.setPluginRules);

  useEffect(() => {
    // postMessage 监听：插件 → 宿主。最小受控面——只认 registerLabelRules。
    const onMessage = (e: MessageEvent) => {
      // 限定来源为本 iframe（跨 origin 下 e.source 是 iframe contentWindow）
      if (e.source !== iframeRef.current?.contentWindow) return;
      const msg = e.data as PluginToHostMsg | undefined;
      if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
      if (msg.type === 'registerLabelRules') {
        const valid = validatePluginRules(entry.id, msg.rules);
        if (valid.length > 0) setPluginRules(entry.id, valid);
      }
      // 其它消息类型忽略（未来扩展 snapshot/theme 等）
    };
    window.addEventListener('message', onMessage);

    // iframe 加载成功后推 ready，让插件知道宿主就绪
    const iframe = iframeRef.current;
    if (iframe) {
      const onLoad = () => {
        setStatus('ready');
        try {
          iframe.contentWindow?.postMessage({ type: 'ready' }, '*');
        } catch { /* 插件已销毁，忽略 */ }
      };
      const onError = () => setStatus('errored');
      iframe.addEventListener('load', onLoad);
      iframe.addEventListener('error', onError);
      return () => {
        window.removeEventListener('message', onMessage);
        iframe.removeEventListener('load', onLoad);
        iframe.removeEventListener('error', onError);
        // 卸载清理：清空该插件的规则（防残留——pluginRules 不持久化，但运行时需显式清）
        setPluginRules(entry.id, []);
      };
    }
    return () => window.removeEventListener('message', onMessage);
  }, [entry.id, entry.src, setPluginRules]);

  // errored 时显示占位（本次无可见 UI，但仍渲染一个标记便于调试）
  if (status === 'errored') {
    return <div data-plugin-id={entry.id} data-status="errored" />;
  }

  return (
    <iframe
      ref={iframeRef}
      // 关键安全属性：只允许脚本，绝不加 allow-same-origin（见组件文档 + spike 风险表 #1）
      sandbox="allow-scripts"
      src={entry.src}
      title={`plugin:${entry.id}`}
      data-plugin-id={entry.id}
      data-status={status}
      style={{ display: 'none' }}  // 本次插件只跑逻辑注册规则，无可视 UI
    />
  );
}