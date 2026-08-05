import { create } from 'zustand';
import { assessHealth, type HealthAssessment } from '../lib/healthAssess';
import { IssueDetector, type Issue } from '../lib/issueDetector';
import { ipc } from '../lib/ipc';
import { useLayoutStore, getPanelLeaves } from './layoutStore';
import { usePerfStore } from './perfStore';
import { useProcessPanelStore } from './processPanelStore';

interface HomeState {
  assessment: HealthAssessment | null;
  issues: Issue[];
  detector: IssueDetector; // 跨轮次保持 streak/去重/占位状态
  running: boolean;
  refresh: () => Promise<void>;
  setRunning: (b: boolean) => void;
  reset: () => void;
}

// 模块级 busy 守卫（usePerf busyRef 同款语义）：refresh 是 async（可能自驱采样），
// 防 2s tick 与未完成的采样重叠导致结果乱序；并发调用丢弃后到者。
let busy = false;

/**
 * 自驱采样（I1 复审修正）：门控依据 = 布局树叶子集（面板是否真的挂载），
 * 而非 visibilityStore——visible.* 初始全 true 且面板卸载时不写回 false
 * （useVisibilityTracking 卸载只 disconnect observer），不反映挂载状态。
 * classic=home 首屏布局叶子只有 'home' → perf/process 未挂载 → home 代为采样
 * 并写共享 store（首页数据与面板同源），同时消除无数据空转（M4）。
 * 根为 null（空布局）时 getPanelLeaves 返回 [] → 按「所有面板未挂载」自驱采样。
 * 失败保持旧数据（A2 语义）；不写面板 store 的 error/staleAt 字段——错误横幅归
 * 面板自身的轮询负责（UX-27），首页不接管。
 */
async function sampleSources(leaves: ReadonlySet<string>) {
  if (!leaves.has('perf')) {
    try {
      const r = await ipc.fetchPerf();
      if (r.ok) usePerfStore.getState().setPerf(r.data);
    } catch (e) {
      console.error('home fetchPerf failed:', e);
    }
  }
  if (!leaves.has('process')) {
    try {
      const r = await ipc.fetchProcesses();
      if (r.ok) {
        useProcessPanelStore.getState().setProcesses(r.data);
        // CPU 是 best-effort 富化：失败不拖垮已有进程列表（useProcessPanel 同款写法）
        try {
          const cpus = await ipc.fetchCpu();
          useProcessPanelStore.getState().setCpuMap(cpus); // 按 pid 合并进 cpuMap
          // 最终审查 Important #1：同一 tick 同时拿到 procs（含 mem）与 cpus（含 cpu）时
          // 喂一条历史点——与 useProcessPanel.ts:48 同款。classic=home 布局下进程面板
          // 未挂载，procHistory 全靠这里自驱采样填充；否则恒空 → memory-growth 规则永不触发。
          useProcessPanelStore.getState().appendHistory(r.data, cpus, Date.now());
        } catch (cpuErr) {
          console.error('home fetchCpu failed:', cpuErr);
        }
      }
    } catch (e) {
      console.error('home fetchProcesses failed:', e);
    }
  }
}

export const useHomeStore = create<HomeState>((set, get) => ({
  assessment: null,
  issues: [],
  detector: new IssueDetector(),
  running: false,
  refresh: async () => {
    if (busy) return;
    busy = true;
    try {
      // 门控依据：布局树叶子集（真正挂载的面板）
      const leaves = new Set(getPanelLeaves(useLayoutStore.getState().root));
      if (!leaves.has('perf') || !leaves.has('process')) {
        // 任一数据源面板未挂载 → 自驱采样（M4：无数据空转消除）。
        // 全部挂载时跳过 await：refresh 主体同步执行，轮询 tick 语义保持确定性。
        await sampleSources(leaves);
      }
      const perf = usePerfStore.getState().current;
      if (!perf) return; // 数据源不可用（采集失败/无 preload）→ 保持旧评估，不计算
      const ps = useProcessPanelStore.getState();
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
    } finally {
      busy = false;
    }
  },
  setRunning: (b) => set({ running: b }),
  reset: () => set({ assessment: null, issues: [], running: false, detector: new IssueDetector() }),
}));
