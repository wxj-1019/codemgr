import { useState } from 'react';
import { PortRadar } from './components/PortRadar';
import { ProcessPanel } from './components/ProcessPanel';

type Tab = 'port' | 'process';

const tabs: { id: Tab; label: string }[] = [
  { id: 'port', label: '端口雷达' },
  { id: 'process', label: '进程' },
];

export function App() {
  const [active, setActive] = useState<Tab>('port');

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
                : 'text-slate-500 border-transparent hover:text-slate-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* Active panel */}
      <div className="flex-1 overflow-hidden">
        {active === 'port' ? <PortRadar /> : <ProcessPanel />}
      </div>
    </div>
  );
}
