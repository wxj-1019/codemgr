// 统一的加载/错误/空状态展示组件。
// 三个面板（PortRadar/ProcessPanel/PerfPanel）共用，保证一致的体验。

interface LoadStateProps {
  loading: boolean;
  error: string | null;
  empty: boolean;
  emptyText?: string;
  // 首次加载（尚无任何数据）时显示骨架，区别于"刷新中"
  isFirstLoad: boolean;
}

export function LoadState({
  loading, error, empty, emptyText = '暂无数据', isFirstLoad,
}: LoadStateProps) {
  // 优先级：错误 > 首次加载 > 空
  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="text-center">
          <div className="mb-2 text-2xl">⚠️</div>
          <p className="text-sm text-danger">加载失败</p>
          <p className="mt-1 max-w-md text-xs text-content-muted">{error}</p>
          <p className="mt-2 text-xs text-content-muted">将在下次轮询时自动重试</p>
        </div>
      </div>
    );
  }

  if (isFirstLoad && loading) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="text-center">
          <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-line border-t-accent" />
          <p className="text-sm text-content-muted">加载中…</p>
        </div>
      </div>
    );
  }

  if (empty) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="text-center">
          <div className="mb-2 text-2xl opacity-40">📭</div>
          <p className="text-sm text-content-muted">{emptyText}</p>
        </div>
      </div>
    );
  }

  return null;
}
