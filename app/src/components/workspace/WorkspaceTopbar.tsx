import { CheckCircle2, Maximize2 } from '../icons';
import { IconButton } from '../ui/IconButton';

interface WorkspaceTopbarProps {
  layoutLabel: string;
  contextLabel: string;
  pluginCount: number;
  registryLoaded: boolean;
  openPanelCount: number;
  canFocusPanel: boolean;
  onFocusPanel: () => void;
}

export function WorkspaceTopbar({
  layoutLabel,
  contextLabel,
  pluginCount,
  registryLoaded,
  openPanelCount,
  canFocusPanel,
  onFocusPanel,
}: WorkspaceTopbarProps) {
  return (
    <header className="workspace-topbar workspace-drag-region">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-xs font-medium text-content-primary">{layoutLabel}</span>
        <span className="text-content-muted" aria-hidden="true">/</span>
        <span className="truncate text-[11px] text-content-secondary">{contextLabel}</span>
      </div>
      <div className="workspace-no-drag flex shrink-0 items-center gap-1.5">
        {canFocusPanel && (
          <IconButton label="只保留当前面板" size="xs" variant="ghost" onClick={onFocusPanel}>
            <Maximize2 size={13} aria-hidden="true" />
          </IconButton>
        )}
        <div
          className="workspace-topbar-status"
          role="status"
          aria-live="polite"
          aria-label="工作区状态"
        >
          <CheckCircle2
            className={`h-3.5 w-3.5 ${registryLoaded ? 'text-success' : 'text-content-muted'}`}
            aria-hidden="true"
          />
          <span>{openPanelCount} 个面板</span>
          {registryLoaded ? (
            <>
              <span>{pluginCount} 个插件</span>
              <span className="text-success">就绪</span>
            </>
          ) : (
            <span>正在加载插件</span>
          )}
        </div>
      </div>
    </header>
  );
}
