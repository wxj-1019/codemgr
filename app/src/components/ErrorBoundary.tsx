import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertCircle, RefreshCw } from './icons';
import { Button } from './ui/Button';

interface Props {
  children: ReactNode;
  /** 自定义降级 UI；不提供则用默认的"出错了 + 重试"。 */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * React 错误边界：捕获子树渲染/生命周期抛出的同步错误，避免整屏白屏。
 * - 不捕获事件回调、异步错误、SSR 错误（React 限制）——这些仍走全局 window.onerror。
 * - reset() 清空错误态，重新挂载子树（给用户一个不刷新就能恢复的入口）。
 *
 * 用法：<ErrorBoundary><App /></ErrorBoundary>
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 上报到 console，便于开发期定位；生产可在此接入日志服务
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  reset = (): void => this.setState({ error: null });

  render(): ReactNode {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.reset);
      }
      return (
        <div className="flex h-full items-center justify-center p-8">
          <div className="max-w-md text-center">
            <div className="mb-3 flex justify-center">
              <AlertCircle className="h-10 w-10 text-danger/50" aria-hidden="true" />
            </div>
            <p className="text-sm font-medium text-danger">界面渲染出错</p>
            <p className="mt-2 break-all font-mono text-xs text-fg-muted">
              {this.state.error.message}
            </p>
            <div className="mt-4 flex justify-center gap-2">
              <Button variant="primary" size="sm" onClick={this.reset}>
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                重试
              </Button>
              <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
                刷新页面
              </Button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
