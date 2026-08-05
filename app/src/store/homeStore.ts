import { create } from 'zustand';
import { assessHealth, type HealthAssessment } from '../lib/healthAssess';
import { IssueDetector, type Issue } from '../lib/issueDetector';
import { usePerfStore } from './perfStore';
import { useProcessPanelStore } from './processPanelStore';

interface HomeState {
  assessment: HealthAssessment | null;
  issues: Issue[];
  detector: IssueDetector; // 跨轮次保持 streak/去重/占位状态
  running: boolean;
  refresh: () => void;
  setRunning: (b: boolean) => void;
  reset: () => void;
}

export const useHomeStore = create<HomeState>((set, get) => ({
  assessment: null,
  issues: [],
  detector: new IssueDetector(),
  running: false,
  refresh: () => {
    const perf = usePerfStore.getState().current;
    const ps = useProcessPanelStore.getState();
    if (!perf) return; // 无数据不计算（M6：轮询暂停恢复后也不会用陈旧空数据）
    const diskFreeMin = perf.disks.filter((d) => d.totalBytes > 0)
      .reduce((min, d) => Math.min(min, (d.freeBytes / d.totalBytes) * 100), 100);
    const issues = get().detector.update({
      cpuTotalPercent: perf.cpu.totalPercent,
      processes: ps.processes,
      cpuMap: ps.cpuMap,   // T2 修复：进程 CPU 必须经 cpuMap（ProcessInfo 无该字段）
      procHistory: ps.procHistory,
      disks: perf.disks,
    });
    const assessment = assessHealth({
      cpuPercent: perf.cpu.totalPercent,
      memPercent: perf.memory.usedPercent,
      diskFreeMinPercent: diskFreeMin,
      gpuPercent: perf.gpu.available ? perf.gpu.totalPercent : null, // 真实字段 available/totalPercent
      issueCount: issues.length,
    });
    set({ assessment, issues });
  },
  setRunning: (b) => set({ running: b }),
  reset: () => set({ assessment: null, issues: [], running: false, detector: new IssueDetector() }),
}));
