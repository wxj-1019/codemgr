import { useEffect } from 'react';
import { useProcessPanelStore } from '../store/processPanelStore';
import { useSessionStore } from '../store/sessionStore';
import { buildSessions } from '../lib/sessionAttribution';

/**
 * 订阅 processPanelStore.processes（已有轮询），每次刷新调 buildSessions 写入 sessionStore。
 * 不新增轮询器——复用进程面板的 processScan 节奏（E2 spec §1.3）。
 */
export function useSessions() {
  const processes = useProcessPanelStore((s) => s.processes);
  const setSessions = useSessionStore((s) => s.setSessions);
  useEffect(() => {
    setSessions(buildSessions(processes));
  }, [processes, setSessions]);
}
