import { useEffect, useMemo, useState } from 'react';
import { Mosaic, MosaicWindow } from 'react-mosaic-component';
import 'react-mosaic-component/react-mosaic-component.css';
import { PortRadar } from './components/PortRadar';
import { ProcessPanel } from './components/ProcessPanel';
import { PerfPanel } from './components/PerfPanel';
import { SnapshotPanel } from './components/SnapshotPanel';
import { SessionPanel } from './components/SessionPanel';
import { LabelRuleEditor } from './components/LabelRuleEditor';
import { Panel } from './components/Panel';
import { PluginHost } from './components/PluginHost';
import { PluginPanel } from './components/PluginPanel';
import { AutoLaunchToggle } from './components/AutoLaunchToggle';
import { useThemeStore } from './store/themeStore';
import { ipc } from './lib/ipc';
import {
  useLayoutStore,
  prunePluginLeaves,
  isBuiltInPanel,
  type BuiltInPanelId,
  type PanelId,
  type PresetId,
} from './store/layoutStore';
import { usePluginRegistryStore } from './store/pluginRegistryStore';
import type { MosaicBranch, MosaicNode } from 'react-mosaic-component';

const BUILTIN_TITLES: Record<BuiltInPanelId, string> = {
  port: '端口雷达',
  process: '进程',
  perf: '性能',
  snapshot: '快照',
  sessions: 'AI 会话',
};

const ALL_BUILTIN: BuiltInPanelId[] = ['port', 'process', 'perf', 'snapshot', 'sessions'];

const PRESETS: { id: PresetId; label: string }[] = [
  { id: 'classic', label: '经典' },
  { id: 'port-perf', label: '端口+性能' },
  { id: 'dev-focus', label: '开发聚焦' },
];

/** 收集树中已出现的内置面板 id（用于 createNode 选下一个可用面板）。 */
function builtinLeaves(node: MosaicNode<PanelId> | null): Set<BuiltInPanelId> {
  if (!node) return new Set();
  if (typeof node === 'string') return isBuiltInPanel(node) ? new Set([node]) : new Set();
  return new Set([...builtinLeaves(node.first), ...builtinLeaves(node.second)]);
}

/** 面板标题：内置查表，插件查 manifest 名称。 */
function usePanelTitle() {
  const find = usePluginRegistryStore((s) => s.find);
  return (id: string): string => {
    if (isBuiltInPanel(id)) return BUILTIN_TITLES[id];
    if (id.startsWith('plugin:')) {
      const e = find(id.slice('plugin:'.length));
      return e?.name ?? id;
    }
    return id;
  };
}

export function App() {
  const { root, setRoot, applyPreset, addPluginPanel, preset } = useLayoutStore();
  const [rulesOpen, setRulesOpen] = useState(false);
  const { theme, toggle } = useThemeStore();
  const registryLoaded = usePluginRegistryStore((s) => s.loaded);
  const registryIds = usePluginRegistryStore((s) => s.ids);
  const pluginEntries = usePluginRegistryStore((s) => s.entries);
  const panelTitle = usePanelTitle();
  const [pluginMenuOpen, setPluginMenuOpen] = useState(false);
  // 版本号：挂载时拉一次（来自 package.json，经 app.getVersion()）。不轮询。
  const [version, setVersion] = useState('');
  useEffect(() => {
    ipc.getAppVersion().then(setVersion).catch(() => { /* 忽略，版本非关键 */ });
  }, []);

  // 启动清理：manifest 就绪后，过滤布局树中悬空的 plugin:* 叶子（插件被移除导致）
  useEffect(() => {
    if (!registryLoaded) return;
    const pruned = prunePluginLeaves(root, registryIds());
    // 仅当确实清理了悬空叶子时才写回（避免无谓 setState）
    if (JSON.stringify(pruned) !== JSON.stringify(root)) {
      setRoot(pruned);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registryLoaded]);

  // mosaic 拆分/替换时需要一个新面板 id。只在内置面板间拆分（插件经添加面板入口插入）
  const createNode = (): Promise<BuiltInPanelId> => {
    const used = builtinLeaves(root);
    const next = ALL_BUILTIN.find((p) => !used.has(p));
    return next ? Promise.resolve(next) : Promise.reject(new Error('所有内置面板已在布局中'));
  };

  return (
    <div className="flex h-screen flex-col">
      {/* aurora 环境光（v1.2 token 层，z-index:-1 垫底；根容器不再铺实色，让 mesh 透出） */}
      <div className="aurora-mesh" aria-hidden="true" />
      {/* 工具栏：预设切换 + 标签规则 + 主题 + 版本（glass 条：半透明面板色透出 aurora mesh） */}
      <nav className="flex border-b border-base-700 bg-base-800 px-2" aria-label="布局预设">
        <span className="px-2 py-2 text-[11px] text-fg-muted self-center mr-1">布局</span>
        {PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => applyPreset(p.id)}
            className={`px-3 py-2 text-sm transition-colors border-b-2 -mb-[1px] ${
              preset === p.id
                ? 'text-accent border-accent'
                : 'text-fg-muted border-transparent hover:text-fg-primary'
            }`}
            title={`切换到「${p.label}」预设`}
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => setRulesOpen(true)}
          className="ml-auto px-3 py-2 text-sm text-fg-secondary hover:text-fg-primary"
          aria-label="标签规则"
        >
          🏷️
        </button>
        {/* 添加插件面板入口：manifest 就绪且有插件时显示下拉 */}
        {pluginEntries.length > 0 && (
          <div className="relative">
            <button
              onClick={() => setPluginMenuOpen((v) => !v)}
              className="px-3 py-2 text-sm text-fg-secondary hover:text-fg-primary"
              aria-label="添加插件面板"
              title="添加插件面板到布局"
            >
              ➕
            </button>
            {pluginMenuOpen && (
              <div className="glass-elevated absolute right-0 top-full z-20 mt-1 min-w-[160px] rounded-lg py-1 shadow-lg">
                {pluginEntries.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => { addPluginPanel(`plugin:${e.id}` as `plugin:${string}`); setPluginMenuOpen(false); }}
                    className="block w-full px-3 py-1.5 text-left text-sm text-fg-secondary hover:bg-base-700 hover:text-fg-primary"
                  >
                    {e.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <button
          onClick={toggle}
          className="px-3 py-2 text-sm text-fg-secondary hover:text-fg-primary"
          aria-label="切换主题"
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
        <AutoLaunchToggle />
        {version && (
          <span
            className="px-2 py-2 self-center text-[11px] text-fg-muted"
            title={`CodeMgr v${version}`}
          >
            v{version}
          </span>
        )}
      </nav>

      {/* 多面板布局区：react-mosaic 二叉树。拖拽标题栏移动，角落按钮拆分/关闭/展开。 */}
      <div className="flex-1 overflow-hidden">
        <Mosaic<PanelId>
          className="mosaic-theme"
          renderTile={(id: PanelId, path: MosaicBranch[]) => (
            <MosaicWindow<PanelId>
              path={path}
              title={panelTitle(id)}
              createNode={createNode}
            >
              <Panel id={id}>
                {id === 'port' && <PortRadar />}
                {id === 'process' && <ProcessPanel />}
                {id === 'perf' && <PerfPanel />}
                {id === 'snapshot' && <SnapshotPanel />}
                {id === 'sessions' && <SessionPanel />}
                {id.startsWith('plugin:') && <PluginPanel id={id} />}
              </Panel>
            </MosaicWindow>
          )}
          value={root}
          onChange={(newNode: MosaicNode<PanelId> | null) => setRoot(newNode)}
          zeroStateView={
            <div className="flex h-full items-center justify-center text-fg-muted text-sm">
              所有面板已关闭。点击顶部预设按钮恢复布局。
            </div>
          }
        />
      </div>

      {rulesOpen && <LabelRuleEditor onClose={() => setRulesOpen(false)} />}

      {/* 插件隐形加载器：iframe sandbox 内的插件注册标签规则（6b 第一步） */}
      <PluginHost />
    </div>
  );
}
