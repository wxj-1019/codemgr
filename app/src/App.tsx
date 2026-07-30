import { useEffect, useState, type ReactNode } from 'react';
import { Mosaic, MosaicWindow } from 'react-mosaic-component';
import type { MosaicBranch, MosaicNode } from 'react-mosaic-component';
import 'react-mosaic-component/react-mosaic-component.css';
import { AutoLaunchToggle } from './components/AutoLaunchToggle';
import { LabelRuleEditor } from './components/LabelRuleEditor';
import { Panel } from './components/Panel';
import { PluginHost } from './components/PluginHost';
import { Button } from './components/ui/Button';
import {
  BUILTIN_PANEL_DEFINITIONS,
  getPanelTitle,
  renderPanel,
  type FindPlugin,
} from './components/workspace/panelCatalog';
import {
  WorkspaceSidebar,
  openAndActivate,
} from './components/workspace/WorkspaceSidebar';
import { WorkspaceTopbar } from './components/workspace/WorkspaceTopbar';
import { ipc } from './lib/ipc';
import {
  MAX_VISIBLE_PANELS,
  getPanelLeaves,
  isBuiltInPanel,
  prunePluginLeaves,
  type BuiltInPanelId,
  type PanelId,
  type PresetId,
  useLayoutStore,
} from './store/layoutStore';
import { useActivePanelStore } from './store/activePanelStore';
import { usePluginRegistryStore } from './store/pluginRegistryStore';
import { useThemeStore } from './store/themeStore';
import { ToastHost } from './components/ToastHost';

const PRESET_LABELS: Record<PresetId, string> = {
  classic: '经典布局',
  'port-perf': '端口 + 性能',
  'dev-focus': '开发聚焦',
};

function builtinLeaves(node: MosaicNode<PanelId> | null): Set<BuiltInPanelId> {
  if (!node) return new Set();
  if (typeof node === 'string') return isBuiltInPanel(node) ? new Set([node]) : new Set();
  return new Set([...builtinLeaves(node.first), ...builtinLeaves(node.second)]);
}

export function createWorkspaceNodeFactory(root: MosaicNode<PanelId> | null) {
  if (getPanelLeaves(root).length >= MAX_VISIBLE_PANELS) return undefined;
  const used = builtinLeaves(root);
  const next = BUILTIN_PANEL_DEFINITIONS.find((panel) => !used.has(panel.id));
  return next ? () => Promise.resolve(next.id) : undefined;
}

export function WorkspacePanelActivationBoundary({
  panelId,
  setActive,
  children,
}: {
  panelId: PanelId;
  setActive: (id: PanelId) => void;
  children: ReactNode;
}) {
  const activate = () => setActive(panelId);
  return (
    <div className="h-full w-full" onPointerDownCapture={activate} onFocusCapture={activate}>
      {children}
    </div>
  );
}

export function resolveWorkspacePanel(id: PanelId, findPlugin?: FindPlugin) {
  return {
    title: getPanelTitle(id, findPlugin),
    content: renderPanel(id, findPlugin),
  };
}

export function WorkspaceZeroState({ onRestore }: { onRestore: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <div>
        <p className="text-sm font-medium text-content-primary">工作区为空</p>
        <p className="mt-1 text-xs text-content-muted">恢复默认面板后可继续工作。</p>
      </div>
      <Button variant="secondary" size="sm" onClick={onRestore}>
        恢复经典布局
      </Button>
    </div>
  );
}

export function App() {
  const { root, setRoot, applyPreset, openPanel, focusPanel, preset } = useLayoutStore();
  const activeId = useActivePanelStore((state) => state.activeId);
  const setActive = useActivePanelStore((state) => state.setActive);
  const reconcileActive = useActivePanelStore((state) => state.reconcile);
  const [rulesOpen, setRulesOpen] = useState(false);
  const { theme, toggle } = useThemeStore();
  const registryLoaded = usePluginRegistryStore((state) => state.loaded);
  const registryIds = usePluginRegistryStore((state) => state.ids);
  const pluginEntries = usePluginRegistryStore((state) => state.entries);
  const findPlugin = usePluginRegistryStore((state) => state.find);
  const [version, setVersion] = useState('');

  useEffect(() => {
    ipc.getAppVersion().then(setVersion).catch(() => { /* Version is non-critical. */ });
  }, []);

  useEffect(() => {
    if (!registryLoaded) return;
    const pruned = prunePluginLeaves(root, registryIds());
    if (JSON.stringify(pruned) !== JSON.stringify(root)) setRoot(pruned);
    // Registry transition is the only trigger; root changes are handled by Mosaic.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registryLoaded]);

  useEffect(() => {
    reconcileActive(root);
  }, [reconcileActive, root]);

  const createNode = createWorkspaceNodeFactory(root);

  const openPanels = getPanelLeaves(root);
  const handleOpenPanel = (panelId: PanelId) => {
    openAndActivate(panelId, root, (id) => openPanel(id, activeId), setActive);
  };
  const handleFocusPanel = () => {
    if (activeId) focusPanel(activeId);
  };
  const currentContext = activeId
    ? getPanelTitle(activeId as PanelId, findPlugin)
    : '未选择面板';

  return (
    <div className="workspace-shell">
      <div className="aurora-mesh" aria-hidden="true" />
      <WorkspaceSidebar
        activeId={activeId}
        preset={preset}
        pluginsLoaded={registryLoaded}
        pluginEntries={pluginEntries}
        theme={theme}
        version={version}
        onOpenPanel={handleOpenPanel}
        onApplyPreset={applyPreset}
        onOpenRules={() => setRulesOpen(true)}
        onToggleTheme={toggle}
        autoLaunchControl={<AutoLaunchToggle />}
      />

      <main className="workspace-main">
        <WorkspaceTopbar
          layoutLabel={preset ? PRESET_LABELS[preset] : '自定义布局'}
          contextLabel={currentContext}
          pluginCount={pluginEntries.length}
          registryLoaded={registryLoaded}
          openPanelCount={openPanels.length}
          canFocusPanel={activeId !== null && openPanels.length > 1}
          onFocusPanel={handleFocusPanel}
        />
        <div className="workspace-mosaic">
          <Mosaic<PanelId>
            className="mosaic-theme"
            renderTile={(id: PanelId, path: MosaicBranch[]) => {
              const panel = resolveWorkspacePanel(id, findPlugin);
              return (
                <WorkspacePanelActivationBoundary panelId={id} setActive={setActive}>
                  <MosaicWindow<PanelId>
                    path={path}
                    title={panel.title}
                    createNode={createNode}
                  >
                    <Panel id={id}>{panel.content}</Panel>
                  </MosaicWindow>
                </WorkspacePanelActivationBoundary>
              );
            }}
            value={root}
            onChange={(newRoot) => setRoot(newRoot)}
            zeroStateView={<WorkspaceZeroState onRestore={() => applyPreset('classic')} />}
          />
        </div>
      </main>

      {rulesOpen && <LabelRuleEditor onClose={() => setRulesOpen(false)} />}
      <PluginHost />
      <ToastHost />
    </div>
  );
}
