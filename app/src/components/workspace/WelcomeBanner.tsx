import { X } from '../icons';
import { IconButton } from '../ui/IconButton';

/** localStorage 标记：首启欢迎条已关闭（UX-08，一次性引导）。 */
export const WELCOME_SEEN_KEY = 'codemgr:welcome-seen';

/**
 * 首启欢迎条（UX-08）：新用户对 8 面板/预设/标签规则的入口一无所知，
 * 首屏为首页（电脑状态评估）。一次性横幅点出核心能力，关闭后不再打扰。
 */
export function WelcomeBanner({ onClose }: { onClose: () => void }) {
  return (
    <div
      role="status"
      data-testid="welcome-banner"
      className="flex items-center justify-between gap-3 border-b border-info/25 bg-info/10 px-4 py-2"
    >
      <p className="min-w-0 text-xs leading-5 text-info">
        欢迎使用 CodeMgr！左侧栏可打开 8 个面板（首页 / 性能 / 进程 / 端口雷达 / 启动项 / 快照 / AI 会话 / 运行配置），
        最多同时显示 3 个；多面板布局预设与进程标签规则也在侧栏。
      </p>
      <IconButton label="关闭欢迎提示" size="xs" variant="ghost" onClick={onClose} className="shrink-0 text-info/80 hover:text-info">
        <X size={14} aria-hidden="true" />
      </IconButton>
    </div>
  );
}