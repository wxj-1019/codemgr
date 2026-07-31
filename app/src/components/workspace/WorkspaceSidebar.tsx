import { useState } from 'react';
import type { ReactNode } from 'react';
import type { MosaicNode } from 'react-mosaic-component';
import type { PluginManifestEntry } from '../../../electron/ipc-types';
import {
  Download,
  Inbox,
  Info,
  ListChecks,
  Moon,
  Package,
  PanelTopClose,
  Play,
  Search,
  Settings,
  Square,
  Sun,
} from '../icons';
import { Button, cx } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { ConfirmDialog } from '../ConfirmDialog';
import { containsPanel, type PanelId, type PresetId } from '../../store/layoutStore';
import {
  BUILTIN_PANEL_DEFINITIONS,
  type PanelDefinition,
  type PanelGroup,
} from './panelCatalog';

// UX-30：预设选项带内容描述（此前只有短标签，无法预知布局长什么样）
const PRESETS: readonly { id: PresetId; label: string }[] = [
  { id: 'classic', label: '经典布局（进程单面板）' },
  { id: 'port-perf', label: '端口 + 性能（双面板）' },
  { id: 'dev-focus', label: '开发聚焦（进程+端口+性能）' },
];

const GROUP_LABELS: Record<Exclude<PanelGroup, 'plugins'>, string> = {
  monitoring: '监控',
  workflow: '工作流',
};

const PANEL_ICONS: Record<string, ReactNode> = {
  port: <Search aria-hidden="true" />,
  process: <Package aria-hidden="true" />,
  perf: <Info aria-hidden="true" />,
  snapshot: <Download aria-hidden="true" />,
  sessions: <Inbox aria-hidden="true" />,
  'run-profiles': <Play aria-hidden="true" />,
};

export function openAndActivate(
  panelId: PanelId,
  root: MosaicNode<PanelId> | null,
  openPanel: (id: PanelId) => void,
  setActive: (id: PanelId) => void,
) {
  if (!containsPanel(root, panelId)) openPanel(panelId);
  setActive(panelId);
}

export interface WorkspaceSidebarProps {
  activeId: string | null;
  preset: PresetId | null;
  pluginsLoaded: boolean;
  pluginEntries: PluginManifestEntry[];
  theme: 'dark' | 'light';
  version: string;
  onOpenPanel: (id: PanelId) => void;
  onApplyPreset: (id: PresetId) => void;
  onOpenRules: () => void;
  onToggleTheme: () => void;
  autoLaunchControl: ReactNode;
}

function WorkspaceDestination({
  definition,
  active,
  onOpen,
}: {
  definition: Pick<PanelDefinition, 'id' | 'title'>;
  active: boolean;
  onOpen: (id: PanelId) => void;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cx(
        'workspace-sidebar-item !w-full shrink grid-cols-[1fr] justify-items-start justify-start gap-1.5 px-2 text-left font-normal',
        active && 'bg-surface-raised text-content-primary',
      )}
      aria-label={definition.title}
      aria-current={active ? 'page' : undefined}
      data-active={active ? 'true' : undefined}
      title={definition.title}
      onClick={() => onOpen(definition.id)}
    >
      <span className="flex !w-full items-center justify-start gap-1.5">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center [&>svg]:h-3.5 [&>svg]:w-3.5">
          {PANEL_ICONS[definition.id] ?? <Square aria-hidden="true" />}
        </span>
        <span className="workspace-sidebar-label min-w-0 truncate text-left">{definition.title}</span>
      </span>
    </Button>
  );
}

export function WorkspaceSidebar({
  activeId,
  preset,
  pluginsLoaded,
  pluginEntries,
  theme,
  version,
  onOpenPanel,
  onApplyPreset,
  onOpenRules,
  onToggleTheme,
  autoLaunchControl,
}: WorkspaceSidebarProps) {
  // UX-11：自定义布局被预设覆盖前确认
  const [pendingPreset, setPendingPreset] = useState<PresetId | null>(null);
  const grouped = (group: Exclude<PanelGroup, 'plugins'>) =>
    BUILTIN_PANEL_DEFINITIONS.filter((definition) => definition.group === group);
  const pluginDefinitions: Array<Pick<PanelDefinition, 'id' | 'title'>> = pluginsLoaded
    ? pluginEntries.map((entry) => ({ id: `plugin:${entry.id}` as const, title: entry.name }))
    : [];

  return (
    <aside className="workspace-sidebar" aria-label="工作区导航">
      <div className="workspace-sidebar-brand workspace-drag-region">
        <span className="workspace-brand-mark" aria-hidden="true">C</span>
        <span className="workspace-sidebar-label text-sm font-semibold text-content-primary">CodeMgr</span>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {(Object.keys(GROUP_LABELS) as Array<Exclude<PanelGroup, 'plugins'>>).map((group) => (
          <section
            key={group}
            role="group"
            aria-labelledby={`workspace-group-${group}`}
            className="mb-3"
          >
            <h2
              id={`workspace-group-${group}`}
              className="workspace-sidebar-group-label px-2 pb-1 pt-1 text-[10px] font-medium uppercase text-content-muted"
            >
              {GROUP_LABELS[group]}
            </h2>
            <div className="space-y-0.5">
              {grouped(group).map((definition) => (
                <WorkspaceDestination
                  key={definition.id}
                  definition={definition}
                  active={activeId === definition.id}
                  onOpen={onOpenPanel}
                />
              ))}
            </div>
          </section>
        ))}

        {pluginDefinitions.length > 0 && (
          <section role="group" aria-labelledby="workspace-group-plugins" className="mb-3">
            <h2
              id="workspace-group-plugins"
              className="workspace-sidebar-group-label px-2 pb-1 pt-1 text-[10px] font-medium uppercase text-content-muted"
            >
              插件
            </h2>
            <div className="space-y-0.5">
              {pluginDefinitions.map((definition) => (
                <WorkspaceDestination
                  key={definition.id}
                  definition={definition}
                  active={activeId === definition.id}
                  onOpen={onOpenPanel}
                />
              ))}
            </div>
          </section>
        )}
      </nav>

      <div className="workspace-sidebar-footer workspace-no-drag border-t border-line p-2">
        <label className="workspace-layout-select mb-1 block">
          <span className="workspace-sidebar-label mb-1 block px-1 text-[10px] text-content-muted">布局</span>
          <span className="workspace-layout-select-control relative block rounded-lg focus-within:ring-2 focus-within:ring-focus/70">
            <PanelTopClose className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-content-muted" aria-hidden="true" />
            <select
              aria-label="布局预设"
              value={preset ?? ''}
              onChange={(event) => {
                const id = event.target.value as PresetId;
                // UX-11：当前是自定义布局时应用预设会覆盖手动排布——先确认
                if (preset === null) setPendingPreset(id);
                else onApplyPreset(id);
              }}
              className="h-7 w-full appearance-none rounded-lg border border-line bg-surface-raised pl-7 pr-2 text-[11px] text-content-secondary outline-none focus:ring-2 focus:ring-focus/70"
            >
              {preset === null && <option value="" disabled>自定义布局</option>}
              {PRESETS.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </span>
        </label>

        <div className="workspace-sidebar-tools flex items-center gap-1">
          <IconButton label="标签规则" onClick={onOpenRules}>
            <ListChecks aria-hidden="true" />
          </IconButton>
          <IconButton label={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'} onClick={onToggleTheme}>
            {theme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
          </IconButton>
          <div className="workspace-sidebar-auto-launch min-w-0 flex-1">{autoLaunchControl}</div>
        </div>

        {version && (
          <div className="workspace-sidebar-version workspace-sidebar-label mt-1 px-1 text-[10px] text-content-muted" title={`CodeMgr v${version}`}>
            v{version}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={pendingPreset !== null}
        title="应用布局预设"
        message={pendingPreset
          ? `应用「${PRESETS.find((pr) => pr.id === pendingPreset)?.label ?? pendingPreset}」将覆盖当前自定义布局，确定继续吗？`
          : ''}
        confirmLabel="应用预设"
        onConfirm={() => {
          if (pendingPreset) onApplyPreset(pendingPreset);
          setPendingPreset(null);
        }}
        onCancel={() => setPendingPreset(null)}
      />
    </aside>
  );
}
