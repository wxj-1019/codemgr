import { useEffect } from 'react';
import { useStartupStore } from '../store/startupStore';
import { PanelActionBar } from './ui/PanelActionBar';
import { IconButton } from './ui/IconButton';
import { Button } from './ui/Button';
import { Badge, BadgeTone } from './ui/Badge';
import { StateView } from './ui/StateView';
import { RefreshCw } from './icons';
import type { StartupItem } from '../../electron/ipc-types';

const SOURCE_BADGE: Record<StartupItem['source'], { text: string; tone: BadgeTone }> = {
  'hkcu-run': { text: '注册表·当前用户', tone: 'accent' },
  'hklm-run': { text: '注册表·系统', tone: 'neutral' },
  'startup-folder': { text: '启动文件夹', tone: 'info' },
};

/** 启动项面板（子项目 G）：手动刷新；HKCU/文件夹可启停，HKLM 只读。 */
export function StartupPanel() {
  const { items, loading, error, toggling, refresh, toggle } = useStartupStore();
  useEffect(() => { void refresh(); }, [refresh]);

  const isFirstLoad = items.length === 0 && !error;
  return (
    <div className="flex h-full flex-col">
      <PanelActionBar
        label="启动项"
        summary={`${items.length} 项 · ${items.filter((i) => i.enabled).length} 启用`}
        actions={<IconButton label="刷新" size="sm" onClick={() => void refresh()}><RefreshCw /></IconButton>}
      />
      {isFirstLoad && loading ? (
        <StateView state="loading" title="加载中…" />
      ) : error && items.length === 0 ? (
        <StateView state="error" title="加载失败" description={error} />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-raised text-left text-xs uppercase text-fg-muted">
              <tr>
                <th className="px-3 py-2 font-medium">名称</th>
                <th className="px-3 py-2 font-medium">来源</th>
                <th className="px-3 py-2 font-medium">命令</th>
                <th className="px-3 py-2 font-medium">状态</th>
                <th className="px-3 py-2 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => {
                const src = SOURCE_BADGE[i.source];
                const readOnly = i.source === 'hklm-run';
                return (
                  <tr key={i.id} className="border-b border-line transition-colors duration-150 hover:bg-surface-raised/50">
                    <td className="px-3 py-2 text-fg-primary">{i.name}</td>
                    <td className="px-3 py-2"><Badge tone={src.tone}>{src.text}</Badge></td>
                    <td className="max-w-[280px] truncate px-3 py-2 font-mono text-xs text-fg-muted" title={i.command}>{i.command}</td>
                    <td className={`px-3 py-2 text-xs ${i.enabled ? 'text-fg-secondary' : 'text-fg-muted'}`}>
                      {i.enabled ? '启用' : '已禁用'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {readOnly ? (
                        <span className="text-xs text-fg-muted" title="系统级启动项需要管理员权限，v1 只读">只读</span>
                      ) : (
                        <Button
                          variant="secondary"
                          size="xs"
                          disabled={toggling.has(i.id)}
                          onClick={() => void toggle(i.id)}
                        >
                          {i.enabled ? '禁用' : '恢复'}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {items.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-fg-muted">未发现启动项</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}