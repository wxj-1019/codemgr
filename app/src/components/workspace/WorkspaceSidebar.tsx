import type { ReactNode } from 'react';
import type { MosaicNode } from 'react-mosaic-component';
import type { PluginManifestEntry } from '../../../electron/ipc-types';
import {
  Activity,
  BarChart3,
  Camera,
  Download,
  Inbox,
  Layers,
  Moon,
  Package,
  PanelTopClose,
  Play,
  Rocket,
  Search,
  Settings,
  Square,
  Sun,
} from '../icons';
import { Button, cx } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { containsPanel, type PanelId, type PresetId } from '../../store/layoutStore';
import {
  BUILTIN_PANEL_DEFINITIONS,
  type PanelDefinition,
  type PanelGroup,
} from './panelCatalog';

const PRESETS: readonly { id: PresetId; label: string }[] = [
  { id: 'classic', label: '经典布局' },
  { id: 'port-perf', label: '端口 + 性能' },
  { id: 'dev-focus', label: '开发聚焦' },
];

const GROUP_LABELS: Record<Exclude<PanelGroup, 'plugins'>, string> = {
  monitoring: '监控',
  workflow: '工作流',
};

const PANEL_ICONS: Record<string, ReactNode> = {
  port: <Activity aria-hidden="true" />,
  process: <Layers aria-hidden="true" />,
  perf: <BarChart3 aria-hidden="true" />,
  snapshot: <Camera aria-hidden="true" />,
  sessions: <Inbox aria-hidden="true" />,
  'run-profiles': <Play aria-hidden="true" />,
  startup: <Rocket aria-hidden="true" />,
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
  const grouped = (group: Exclude<PanelGroup, 'plugins'>) =>
    BUILTIN_PANEL_DEFINITIONS.filter((definition) => definition.group === group);
  const pluginDefinitions: Array<Pick<PanelDefinition, 'id' | 'title'>> = pluginsLoaded
    ? pluginEntries.map((entry) => ({ id: `plugin:${entry.id}` as const, title: entry.name }))
    : [];

  return (
    <aside className="workspace-sidebar" aria-label="工作区导航">
      <div className="workspace-sidebar-brand workspace-drag-region">
        <span className="workspace-brand-mark" aria-hidden="true">C</span>
        <span className="workspace-sidebar-label min-w-0 flex-1 truncate text-sm font-semibold text-content-primary">CodeMgr</span>
        {version && (
          <span
            className="workspace-sidebar-version shrink-0 text-[10px] text-content-muted"
            title={`CodeMgr v${version}`}
          >
            v{version}
          </span>
        )}
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {(Object.keys(GROUP_LABELS) as Array<Exclude<PanelGroup, 'plugins'>>).map((group) => (
          <section
            key={group}
            role="group"
            aria-labelledby={`workspace-group-${group}`}
            className="mb-4"
          >
            <h2
              id={`workspace-group-${group}`}
              className="workspace-sidebar-group-label px-2 pb-1.5 pt-1 text-[11px] font-semibold text-content-muted/80"
            >
              {GROUP_LABELS[group]}
            </h2>
            <div className="space-y-1">
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
          <section role="group" aria-labelledby="workspace-group-plugins" className="mb-4">
            <h2
              id="workspace-group-plugins"
              className="workspace-sidebar-group-label px-2 pb-1.5 pt-1 text-[11px] font-semibold text-content-muted/80"
            >
              插件
            </h2>
            <div className="space-y-1">
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
          <span className="workspace-layout-select-control relative block rounded-md focus-within:ring-2 focus-within:ring-focus/70">
            <PanelTopClose className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-content-muted" aria-hidden="true" />
            <select
              aria-label="布局预设"
              value={preset ?? ''}
              onChange={(event) => onApplyPreset(event.target.value as PresetId)}
              className="h-7 w-full appearance-none rounded-md border border-line bg-surface-raised pl-7 pr-2 text-[11px] text-content-secondary outline-none focus:ring-2 focus:ring-focus/70"
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
            <Settings aria-hidden="true" />
          </IconButton>
          <IconButton label={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'} onClick={onToggleTheme}>
            {theme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
          </IconButton>
          <div className="workspace-sidebar-auto-launch min-w-0 flex-1">{autoLaunchControl}</div>
        </div>
      </div>
    </aside>
  );
}
