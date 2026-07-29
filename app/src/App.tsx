import { useState } from 'react';
import { PortRadar } from './components/PortRadar';
import { ProcessPanel } from './components/ProcessPanel';
import { PerfPanel } from './components/PerfPanel';
import { LabelRuleEditor } from './components/LabelRuleEditor';
import { useThemeStore } from './store/themeStore';

type Tab = 'port' | 'process' | 'perf';

const tabs: { id: Tab; label: string }[] = [
  { id: 'port', label: '端口雷达' },
  { id: 'process', label: '进程' },
  { id: 'perf', label: '性能' },
];

export function App() {
  const [active, setActive] = useState<Tab>('port');
  const [rulesOpen, setRulesOpen] = useState(false);
  const { theme, toggle } = useThemeStore();

  return (
    <div className="flex h-screen flex-col bg-base-900">
      {/* Tab bar */}
      <nav className="flex border-b border-base-700 bg-base-900 px-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            className={`px-4 py-2 text-sm transition-colors border-b-2 -mb-[1px] ${
              active === t.id
                ? 'text-accent border-accent'
                : 'text-fg-muted border-transparent hover:text-fg-primary'
            }`}
          >
            {t.label}
          </button>
        ))}
        <button
          onClick={() => setRulesOpen(true)}
          className="ml-auto px-3 py-2 text-sm text-fg-secondary hover:text-fg-primary"
          aria-label="标签规则"
        >
          🏷️
        </button>
        <button
          onClick={toggle}
          className="px-3 py-2 text-sm text-fg-secondary hover:text-fg-primary"
          aria-label="切换主题"
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
      </nav>

      {/* Active panel */}
      <div className="flex-1 overflow-hidden">
        {active === 'port' && <PortRadar />}
        {active === 'process' && <ProcessPanel />}
        {active === 'perf' && <PerfPanel />}
      </div>

      {rulesOpen && <LabelRuleEditor onClose={() => setRulesOpen(false)} />}
    </div>
  );
}
