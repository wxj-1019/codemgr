import { isValidElement } from 'react';
import { describe, expect, it } from 'vitest';
import type { PluginManifestEntry } from '../electron/ipc-types';
import { PortRadar } from '../src/components/PortRadar';
import { RunProfilesPanel } from '../src/components/RunProfilesPanel';
import { PluginPanel } from '../src/components/PluginPanel';
import {
  BUILTIN_PANEL_CATALOG,
  BUILTIN_PANEL_DEFINITIONS,
  getPanelDefinition,
  getPanelTitle,
  renderPanel,
} from '../src/components/workspace/panelCatalog';
describe('panelCatalog', () => {
  it('derives each built-in definition exactly once from the catalog record', () => {
    const catalogIds = Object.keys(BUILTIN_PANEL_CATALOG);
    const definitionIds = BUILTIN_PANEL_DEFINITIONS.map((definition) => definition.id);

    expect(definitionIds).toHaveLength(catalogIds.length);
    expect(new Set(definitionIds).size).toBe(catalogIds.length);
    expect([...definitionIds].sort()).toEqual([...catalogIds].sort());
  });

  it('provides the catalog title, group, icon, and renderer for every built-in panel', () => {
    for (const definition of BUILTIN_PANEL_DEFINITIONS) {
      const catalogEntry = BUILTIN_PANEL_CATALOG[definition.id];
      expect(getPanelDefinition(definition.id)).toMatchObject({
        id: definition.id,
        title: catalogEntry.title,
        group: catalogEntry.group,
      });
      expect(isValidElement(catalogEntry.icon)).toBe(true);
      expect(isValidElement(renderPanel(definition.id))).toBe(true);
    }

    expect(getPanelTitle('port')).toBe('端口雷达');
    expect(renderPanel('port').type).toBe(PortRadar);
    expect(getPanelTitle('run-profiles')).toBe('Run Profiles');
    expect(renderPanel('run-profiles').type).toBe(RunProfilesPanel);
  });

  it('uses plugin manifest names and renders the matching plugin panel', () => {
    const entry: PluginManifestEntry = {
      id: 'disk-volumes',
      name: '磁盘卷',
      src: 'plugins/disk-volumes.html',
    };
    const findPlugin = (id: string) => id === entry.id ? entry : undefined;

    expect(getPanelTitle('plugin:disk-volumes', findPlugin)).toBe('磁盘卷');
    const definition = getPanelDefinition('plugin:disk-volumes', findPlugin);
    expect(definition?.title).toBe('磁盘卷');
    expect(definition?.group).toBe('plugins');

    const rendered = renderPanel('plugin:disk-volumes', findPlugin);
    expect(isValidElement(rendered)).toBe(true);
    expect(rendered.type).toBe(PluginPanel);
    expect(rendered.props).toEqual({ id: 'plugin:disk-volumes' });
  });
});
