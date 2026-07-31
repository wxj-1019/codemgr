import { CheckCircle2, Focus, LoaderCircle, Maximize2, Package, Sparkles } from '../icons';
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

/** 状态徽章：面板数 / 插件数 / 就绪，一眼可读。 */
function StatusPill({ icon, count, tone }: { icon: React.ReactNode; count: number; tone: 'neutral' | 'success' }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${
        tone === 'success'
          ? 'bg-success/10 text-success ring-success/20'
          : 'bg-surface-raised text-content-secondary ring-line'
      }`}
    >
      {icon}
      <span>{count}</span>
    </span>
  );
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
        <span className="truncate text-xs font-semibold text-content-primary">{layoutLabel}</span>
        <span className="text-content-muted/50" aria-hidden="true">/</span>
        <span className="truncate text-[11px] text-content-secondary">{contextLabel}</span>
      </div>
      <div className="workspace-no-drag flex shrink-0 items-center gap-2">
        {canFocusPanel && (
          <IconButton label="只保留当前面板" size="xs" variant="ghost" onClick={onFocusPanel}>
            <Focus size={13} aria-hidden="true" />
          </IconButton>
        )}
        <div
          className="workspace-topbar-status flex items-center gap-1.5"
          role="status"
          aria-live="polite"
          aria-label="工作区状态"
        >
          <StatusPill
            icon={<Package className="h-3 w-3" aria-hidden="true" />}
            count={openPanelCount}
            tone="neutral"
          />
          {registryLoaded ? (
            <>
              <StatusPill
                icon={<CheckCircle2 className="h-3 w-3" aria-hidden="true" />}
                count={pluginCount}
                tone="success"
              />
              <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success ring-1 ring-inset ring-success/20">
                <Sparkles className="twinkle h-3 w-3" aria-hidden="true" />
                <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
                就绪
              </span>
            </>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-surface-raised px-2 py-0.5 text-[10px] font-medium text-content-muted ring-1 ring-inset ring-line">
              <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden="true" />
              正在加载插件
            </span>
          )}
        </div>
      </div>
    </header>
  );
}