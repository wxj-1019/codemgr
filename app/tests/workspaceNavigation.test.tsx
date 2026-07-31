import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isValidElement, type ComponentProps } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { PluginManifestEntry } from '../electron/ipc-types';
import {
  WorkspaceSidebar,
  openAndActivate,
} from '../src/components/workspace/WorkspaceSidebar';
import {
  WorkspacePanelActivationBoundary,
  WorkspaceZeroState,
  createWorkspaceNodeFactory,
  resolveWorkspacePanel,
} from '../src/App';
import { WorkspaceTopbar } from '../src/components/workspace/WorkspaceTopbar';

const plugin: PluginManifestEntry = {
  id: 'disk-volumes',
  name: '磁盘卷',
  src: 'plugins/disk-volumes.html',
};

function renderSidebar(overrides: Partial<ComponentProps<typeof WorkspaceSidebar>> = {}) {
  const props: ComponentProps<typeof WorkspaceSidebar> = {
    activeId: null,
    preset: 'classic',
    pluginsLoaded: true,
    pluginEntries: [],
    theme: 'dark',
    version: '2.3.0',
    onOpenPanel: vi.fn(),
    onApplyPreset: vi.fn(),
    onOpenRules: vi.fn(),
    onToggleTheme: vi.fn(),
    autoLaunchControl: <span>自启控件</span>,
    ...overrides,
  };
  return { ...render(<WorkspaceSidebar {...props} />), props };
}

describe('WorkspaceSidebar', () => {
  it('groups all six built-in destinations under monitoring and workflow', () => {
    renderSidebar();

    const monitoring = screen.getByRole('group', { name: '监控' });
    expect(within(monitoring).getAllByRole('button').map((button) => button.textContent)).toEqual([
      '端口雷达',
      '进程',
      '性能',
    ]);

    const workflow = screen.getByRole('group', { name: '工作流' });
    expect(within(workflow).getAllByRole('button').map((button) => button.textContent)).toEqual([
      '快照',
      'AI 会话',
      'Run Profiles',
    ]);
  });

  it('opens the selected destination through the shell callback', async () => {
    const user = userEvent.setup();
    const { props } = renderSidebar();

    await user.click(screen.getByRole('button', { name: '性能' }));

    expect(props.onOpenPanel).toHaveBeenCalledOnce();
    expect(props.onOpenPanel).toHaveBeenCalledWith('perf');
  });

  it('hides plugins until the registry is loaded, then exposes them as destinations', async () => {
    const user = userEvent.setup();
    const { rerender, props } = renderSidebar({ pluginsLoaded: false, pluginEntries: [plugin] });
    expect(screen.queryByRole('button', { name: '磁盘卷' })).not.toBeInTheDocument();

    rerender(<WorkspaceSidebar {...props} pluginsLoaded pluginEntries={[plugin]} />);
    await user.click(screen.getByRole('button', { name: '磁盘卷' }));

    expect(props.onOpenPanel).toHaveBeenCalledWith('plugin:disk-volumes');
  });

  it('marks only the active destination with aria-current and active styling', () => {
    renderSidebar({ activeId: 'sessions' });

    const active = screen.getByRole('button', { name: 'AI 会话' });
    expect(active).toHaveAttribute('aria-current', 'page');
    expect(active).toHaveAttribute('data-active', 'true');
    expect(screen.getByRole('button', { name: '进程' })).not.toHaveAttribute('aria-current');
  });

  it('applies the selected layout preset', () => {
    const { props } = renderSidebar();

    fireEvent.change(screen.getByRole('combobox', { name: '布局预设' }), {
      target: { value: 'dev-focus' },
    });

    expect(props.onApplyPreset).toHaveBeenCalledWith('dev-focus');
  });

  it('keeps a visible focus-within ring contract around the rail layout select', () => {
    renderSidebar();

    const select = screen.getByRole('combobox', { name: '布局预设' });
    const visibleContainer = select.parentElement;
    expect(visibleContainer).toHaveClass('workspace-layout-select-control');
    expect(visibleContainer?.className).toContain('focus-within:ring-2');

    select.focus();
    expect(select).toHaveFocus();
  });
});

describe('workspace shell wiring', () => {
  it('returns no createNode callback when every built-in panel is already used', async () => {
    const root = {
      direction: 'row' as const,
      first: {
        direction: 'row' as const,
        first: 'port' as const,
        second: 'process' as const,
      },
      second: {
        direction: 'row' as const,
        first: 'perf' as const,
        second: {
          direction: 'row' as const,
          first: 'snapshot' as const,
          second: {
            direction: 'row' as const,
            first: 'sessions' as const,
            second: 'run-profiles' as const,
          },
        },
      },
    };

    expect(createWorkspaceNodeFactory(root)).toBeUndefined();
    await expect(Promise.resolve(createWorkspaceNodeFactory(root)?.())).resolves.toBeUndefined();
  });

  it('creates the first unused built-in panel without rejection', async () => {
    const factory = createWorkspaceNodeFactory('process');

    expect(factory).toBeTypeOf('function');
    await expect(factory?.()).resolves.toBe('port');
  });

  it('stops offering Mosaic split/replace after three panels are open', () => {
    const root = {
      direction: 'row' as const,
      first: 'process' as const,
      second: {
        direction: 'column' as const,
        first: 'port' as const,
        second: 'perf' as const,
      },
    };

    expect(createWorkspaceNodeFactory(root)).toBeUndefined();
  });

  it('activates a panel from toolbar pointer and focus interactions', () => {
    const setActive = vi.fn();
    render(
      <WorkspacePanelActivationBoundary panelId="perf" setActive={setActive}>
        <button>性能标题栏控件</button>
      </WorkspacePanelActivationBoundary>,
    );
    const toolbarControl = screen.getByRole('button', { name: '性能标题栏控件' });

    fireEvent.pointerDown(toolbarControl);
    toolbarControl.focus();

    expect(setActive).toHaveBeenCalledTimes(2);
    expect(setActive).toHaveBeenLastCalledWith('perf');
  });

  it('preserves the Mosaic window height through the activation boundary', () => {
    const { container } = render(
      <WorkspacePanelActivationBoundary panelId="process" setActive={vi.fn()}>
        <div className="mosaic-window" />
      </WorkspacePanelActivationBoundary>,
    );
    const boundary = container.firstElementChild;
    const css = readFileSync(resolve(__dirname, '../src/index.css'), 'utf8');

    expect(boundary).toHaveClass('workspace-panel-activation-boundary');
    expect(css).toMatch(
      /\.workspace-panel-activation-boundary\s*>\s*\.mosaic-window\s*\{[^}]*height:\s*100%;[^}]*width:\s*100%;[^}]*\}/s,
    );
  });

  it('does not report ready while the plugin registry is still loading', () => {
    render(
      <WorkspaceTopbar
        layoutLabel="经典布局"
        contextLabel="进程"
        pluginCount={0}
        registryLoaded={false}
        openPanelCount={1}
        canFocusPanel={false}
        onFocusPanel={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('工作区状态')).toHaveTextContent('正在加载插件');
    expect(screen.getByLabelText('工作区状态')).not.toHaveTextContent('就绪');
  });

  it('offers a focus action when multiple panels are open', async () => {
    const user = userEvent.setup();
    const onFocusPanel = vi.fn();
    render(
      <WorkspaceTopbar
        layoutLabel="开发聚焦"
        contextLabel="进程"
        pluginCount={1}
        registryLoaded
        openPanelCount={3}
        canFocusPanel
        onFocusPanel={onFocusPanel}
      />,
    );

    const focus = screen.getByRole('button', { name: '只保留当前面板' });
    expect(focus).toHaveAttribute('title', '只保留当前面板');
    await user.click(focus);
    expect(onFocusPanel).toHaveBeenCalledOnce();
  });

  it('hides the focus action when only one panel is open', () => {
    render(
      <WorkspaceTopbar
        layoutLabel="经典布局"
        contextLabel="进程"
        pluginCount={0}
        registryLoaded
        openPanelCount={1}
        canFocusPanel={false}
        onFocusPanel={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: '只保留当前面板' })).not.toBeInTheDocument();
  });

  it('opens a missing panel before activating it', () => {
    const openPanel = vi.fn();
    const setActive = vi.fn();

    openAndActivate('perf', 'process', openPanel, setActive);

    expect(openPanel).toHaveBeenCalledWith('perf');
    expect(setActive).toHaveBeenCalledWith('perf');
    expect(openPanel.mock.invocationCallOrder[0]).toBeLessThan(setActive.mock.invocationCallOrder[0]);
  });

  it('does not reopen a panel already present but still activates it', () => {
    const openPanel = vi.fn();
    const setActive = vi.fn();
    const root = { direction: 'row' as const, first: 'process' as const, second: 'perf' as const };

    openAndActivate('perf', root, openPanel, setActive);

    expect(openPanel).not.toHaveBeenCalled();
    expect(setActive).toHaveBeenCalledWith('perf');
  });

  it('resolves Mosaic titles and renderers through the panel catalog', () => {
    const resolved = resolveWorkspacePanel('plugin:disk-volumes', (id) => id === plugin.id ? plugin : undefined);

    expect(resolved.title).toBe('磁盘卷');
    expect(isValidElement(resolved.content)).toBe(true);
    expect(resolved.content.props.id).toBe('plugin:disk-volumes');
  });

  it('offers a direct classic-layout recovery action when the layout is empty', async () => {
    const user = userEvent.setup();
    const restore = vi.fn();
    render(<WorkspaceZeroState onRestore={restore} />);

    await user.click(screen.getByRole('button', { name: '恢复经典布局' }));

    expect(restore).toHaveBeenCalledOnce();
  });
});
