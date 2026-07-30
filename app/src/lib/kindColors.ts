// 进程 kind → badge 配色（bg + text 类）。此前在 ProcessTable/ProjectGroupView/LabelRuleEditor
// 三处重复定义（AGENTS.md §10.3 标注的同步负担），子项目 H 收敛为一处。
// Aurora v1.2：底色 14% 透明度，字色不变。
export const KIND_COLORS: Record<string, string> = {
  dev: 'bg-accent/[0.14] text-accent',
  test: 'bg-green-500/[0.14] text-green-400',
  build: 'bg-purple-500/[0.14] text-purple-400',
  container: 'bg-blue-500/[0.14] text-blue-400',
  db: 'bg-amber-500/[0.14] text-amber-400',
  system: 'bg-slate-600/[0.14] text-fg-secondary',
  ai: 'bg-fuchsia-500/[0.14] text-fuchsia-400',
  'ai-ide': 'bg-violet-500/[0.14] text-violet-400',
};

/** 未知 kind 的兜底配色（与原三处内联兜底一致）。 */
export const KIND_COLOR_FALLBACK = 'bg-slate-600/[0.14] text-fg-secondary';

/** 取 kind 配色，未知 kind 回退 system 灰。 */
export function kindColorOf(kind: string): string {
  return KIND_COLORS[kind] ?? KIND_COLOR_FALLBACK;
}
