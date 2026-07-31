import type { ReactElement, ReactNode } from 'react';
import type { PluginManifestEntry } from '../../../electron/ipc-types';
import { PortRadar } from '../PortRadar';
import { ProcessPanel } from '../ProcessPanel';
import { PerfPanel } from '../PerfPanel';
import { SnapshotPanel } from '../SnapshotPanel';
import { SessionPanel } from '../SessionPanel';
import { RunProfilesPanel } from '../RunProfilesPanel';
import { StartupPanel } from '../StartupPanel';
import { PluginPanel } from '../PluginPanel';
import {
  isBuiltInPanel,
  pluginIdOf,
  type BuiltInPanelId,
  type PanelId,
} from '../../store/layoutStore';

export type PanelGroup = 'monitoring' | 'workflow' | 'plugins';

interface BuiltInPanelCatalogEntry {
  title: string;
  group: Exclude<PanelGroup, 'plugins'>;
  icon: ReactNode;
  renderer: () => ReactElement;
}

export interface PanelDefinition {
  id: PanelId;
  title: string;
  group: PanelGroup;
  icon: ReactNode;
  renderer: () => ReactElement;
}

interface BuiltInPanelDefinition extends PanelDefinition {
  id: BuiltInPanelId;
  group: BuiltInPanelCatalogEntry['group'];
}

export type FindPlugin = (id: string) => PluginManifestEntry | undefined;

function CatalogIcon({ label }: { label: string }) {
  return <span aria-hidden="true">{label}</span>;
}

export const BUILTIN_PANEL_CATALOG: Record<BuiltInPanelId, BuiltInPanelCatalogEntry> = {
  port: {
    title: '端口雷达',
    group: 'monitoring',
    icon: <CatalogIcon label="P" />,
    renderer: () => <PortRadar />,
  },
  process: {
    title: '进程',
    group: 'monitoring',
    icon: <CatalogIcon label="C" />,
    renderer: () => <ProcessPanel />,
  },
  perf: {
    title: '性能',
    group: 'monitoring',
    icon: <CatalogIcon label="M" />,
    renderer: () => <PerfPanel />,
  },
  snapshot: {
    title: '快照',
    group: 'workflow',
    icon: <CatalogIcon label="S" />,
    renderer: () => <SnapshotPanel />,
  },
  sessions: {
    title: 'AI 会话',
    group: 'workflow',
    icon: <CatalogIcon label="A" />,
    renderer: () => <SessionPanel />,
  },
  'run-profiles': {
    title: '运行配置',
    group: 'workflow',
    icon: <CatalogIcon label="R" />,
    renderer: () => <RunProfilesPanel />,
  },
  startup: {
    title: '启动项',
    group: 'workflow',
    icon: <CatalogIcon label="启" />,
    renderer: () => <StartupPanel />,
  },
};

export const BUILTIN_PANEL_DEFINITIONS: readonly BuiltInPanelDefinition[] = Object.entries(
  BUILTIN_PANEL_CATALOG,
).map(([id, definition]) => ({
  id: id as BuiltInPanelId,
  ...definition,
}));

const BUILTIN_PANEL_MAP: ReadonlyMap<BuiltInPanelId, BuiltInPanelDefinition> = new Map(
  BUILTIN_PANEL_DEFINITIONS.map((definition) => [definition.id, definition]),
);

function pluginDefinition(id: `plugin:${string}`, findPlugin?: FindPlugin): PanelDefinition {
  const pluginId = pluginIdOf(id)!;
  const entry = findPlugin?.(pluginId);
  return {
    id,
    title: entry?.name ?? id,
    group: 'plugins',
    icon: <CatalogIcon label="+" />,
    renderer: () => <PluginPanel id={id} />,
  };
}

export function getPanelDefinition(
  id: PanelId,
  findPlugin?: FindPlugin,
): PanelDefinition | undefined {
  if (isBuiltInPanel(id)) return BUILTIN_PANEL_MAP.get(id);
  return pluginDefinition(id, findPlugin);
}

export function getPanelTitle(id: PanelId, findPlugin?: FindPlugin): string {
  return getPanelDefinition(id, findPlugin)?.title ?? id;
}

export function renderPanel(id: PanelId, findPlugin?: FindPlugin): ReactElement | null {
  return getPanelDefinition(id, findPlugin)?.renderer() ?? null;
}