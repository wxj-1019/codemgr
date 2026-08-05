import { create } from 'zustand';
import { assessHealth, type HealthAssessment } from '../lib/healthAssess';
import { IssueDetector, type Issue } from '../lib/issueDetector';
import { ipc } from '../lib/ipc';
import { usePerfStore } from './perfStore';
import { useProcessPanelStore } from './processPanelStore';
import { useVisibilityStore } from './visibilityStore';

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
 * 自驱采样（I1）：数据源按「面板是否挂载/可见」分流。
 * - perf/process 面板可见 → 其自身轮询 hook 已写共享 store，这里直接读（不重复采样，
 *   避免双采集竞争，roadmap R2）。
 * - 面板不可见（classic=home 首屏只有首页）→ home 代为采样并写共享 store：
 *   与面板数据保持一致（首页数据与面板同源），同时消除无数据空转（M4）。
 * 失败保持旧数据（A2 语义）；不写面板 store 的 error/staleAt 字段——错误横幅归面板
 * 自身的轮询负责（UX-27），首页不接管。
 */
async function sampleSources() {
  const visible = useVisibilityStore.getState().visible;
  if (!visible.perf) {
    try {
      const r = await ipc.fetchPerf();
      if (r.ok) usePerfStore.getState().setPerf(r.data);
    } catch (e) {
      console.error('home fetchPerf failed:', e);
    }
  }
  if (!visible.process) {
    try {
      const r = await ipc.fetchProcesses();
      if (r.ok) {
        useProcessPanelStore.getState().setProcesses(r.data);
        // CPU 是 best-effort 富化：失败不拖垮已有进程列表（useProcessPanel 同款写法）
        try {
          const cpus = await ipc.fetchCpu();
          useProcessPanelStore.getState().setCpuMap(cpus); // 按 pid 合并进 cpuMap
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
      const visible = useVisibilityStore.getState().visible;
      if (!visible.perf || !visible.process) {
        // 任一数据源面板未挂载 → 自驱采样（M4：无数据空转消除）。
        // 全部可见时跳过 await：refresh 主体同步执行，轮询 tick 语义保持确定性。
        await sampleSources();
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
