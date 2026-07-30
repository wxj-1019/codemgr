import { CheckCircle2 } from '../icons';

interface WorkspaceTopbarProps {
  layoutLabel: string;
  contextLabel: string;
  pluginCount: number;
  registryLoaded: boolean;
}

export function WorkspaceTopbar({
  layoutLabel,
  contextLabel,
  pluginCount,
  registryLoaded,
}: WorkspaceTopbarProps) {
  return (
    <header className="workspace-topbar workspace-drag-region">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-xs font-medium text-content-primary">{layoutLabel}</span>
        <span className="text-content-muted" aria-hidden="true">/</span>
        <span className="truncate text-[11px] text-content-secondary">{contextLabel}</span>
      </div>
      <div
        className="workspace-topbar-status workspace-no-drag"
        role="status"
        aria-live="polite"
        aria-label="工作区状态"
      >
        <CheckCircle2
          className={`h-3.5 w-3.5 ${registryLoaded ? 'text-success' : 'text-content-muted'}`}
          aria-hidden="true"
        />
        {registryLoaded ? (
          <>
            <span>{pluginCount} 个插件</span>
            <span className="text-success">就绪</span>
          </>
        ) : (
          <span>正在加载插件</span>
        )}
      </div>
    </header>
  );
}
