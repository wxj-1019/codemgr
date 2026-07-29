// 进程标签：对外接口保持 labelForProcess(name, cmdline) => ProcessLabel | null 不变
// （两个调用点 ProcessTable / ProjectGroupView 零改动）。
// 内部改为委托数据驱动的规则引擎：规则来自 labelRulesStore 合并后的 activeRules。
import type { LabelRule } from './labelRules';
import { getActiveRules } from '../store/labelRulesStore';

export interface ProcessLabel {
  label: string;
  kind: string; // 放宽为 string：用户可自定义 kind；KIND_COLORS 已是 Record<string,...>
}

import { matchRules } from './labelRules';

// Heuristic rules for labeling processes by name + command-line.
// 规则现在数据驱动，详见 lib/labelRules.ts 与 store/labelRulesStore.ts。
export function labelForProcess(name: string, cmdline: string): ProcessLabel | null {
  const rules: LabelRule[] = getActiveRules();
  const m = matchRules(rules, name, cmdline);
  return m ? { label: m.label, kind: m.kind } : null;
}
