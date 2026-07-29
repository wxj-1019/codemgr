import { useEffect, useState } from 'react';
import { Mosaic, MosaicWindow } from 'react-mosaic-component';
import 'react-mosaic-component/react-mosaic-component.css';
import { PortRadar } from './components/PortRadar';
import { ProcessPanel } from './components/ProcessPanel';
import { PerfPanel } from './components/PerfPanel';
import { LabelRuleEditor } from './components/LabelRuleEditor';
import { Panel } from './components/Panel';
import { useThemeStore } from './store/themeStore';
import { ipc } from './lib/ipc';
import {
  useLayoutStore,
  type PanelId,
  type PresetId,
} from './store/layoutStore';
import type { MosaicBranch, MosaicNode } from 'react-mosaic-component';

const PANEL_TITLES: Record<PanelId, string> = {
  port: '端口雷达',
  process: '进程',
  perf: '性能',
};

const ALL_PANELS: PanelId[] = ['port', 'process', 'perf'];

const PRESETS: { id: PresetId; label: string }[] = [
  { id: 'classic', label: '经典' },
  { id: 'port-perf', label: '端口+性能' },
  { id: 'dev-focus', label: '开发聚焦' },
];

/** 收集树中已出现的面板 id（用于 createNode 选下一个可用面板）。 */
function leaves(node: MosaicNode<PanelId> | null): Set<PanelId> {
  if (!node) return new Set();
  if (typeof node === 'string') return new Set([node]);
  return new Set([...leaves(node.first), ...leaves(node.second)]);
}

export function App() {
  const { root, setRoot, applyPreset, preset } = useLayoutStore();
  const [rulesOpen, setRulesOpen] = useState(false);
  const { theme, toggle } = useThemeStore();
  // 版本号：挂载时拉一次（来自 package.json，经 app.getVersion()）。不轮询。
  const [version, setVersion] = useState('');
  useEffect(() => {
    ipc.getAppVersion().then(setVersion).catch(() => { /* 忽略，版本非关键 */ });
  }, []);

  // mosaic 拆分/替换时需要一个新面板 id。从当前树里挑还没出现的下一个面板；
  // 三个面板都在用时无可拆分项 → reject（SplitButton 会被禁用或静默无操作）。
  const createNode = (): Promise<PanelId> => {
    const used = leaves(root);
    const next = ALL_PANELS.find((p) => !used.has(p));
    return next ? Promise.resolve(next) : Promise.reject(new Error('所有面板已在布局中'));
  };

  return (
    <div className="flex h-screen flex-col bg-base-900">
      {/* 工具栏：预设切换 + 标签规则 + 主题 + 版本 */}
      <nav className="flex border-b border-base-700 bg-base-900 px-2" aria-label="布局预设">
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
        <button
          onClick={toggle}
          className="px-3 py-2 text-sm text-fg-secondary hover:text-fg-primary"
          aria-label="切换主题"
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
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
              title={PANEL_TITLES[id]}
              createNode={createNode}
            >
              <Panel id={id}>
                {id === 'port' && <PortRadar />}
                {id === 'process' && <ProcessPanel />}
                {id === 'perf' && <PerfPanel />}
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
    </div>
  );
}
