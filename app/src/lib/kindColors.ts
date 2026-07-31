// 进程 kind → badge 配色（bg + text 类）。此前在 ProcessTable/ProjectGroupView/LabelRuleEditor
// 三处重复定义（AGENTS.md §10.3 标注的同步负担），子项目 H 收敛为一处。
// v3.0 糖果风：改用 CSS 变量驱动（--kind-*-rgb），亮/暗主题各有一套糖果色，
// 修复此前硬编码 Tailwind 色板（text-green-400 等）在浅色主题下不可读的问题。
// 底色 14% 透明度，字色用同色系深/亮值。
export const KIND_COLORS: Record<string, string> = {
  dev: 'bg-[rgb(var(--kind-dev-rgb)/0.14)] text-[rgb(var(--kind-dev-rgb))]',
  test: 'bg-[rgb(var(--kind-test-rgb)/0.14)] text-[rgb(var(--kind-test-rgb))]',
  build: 'bg-[rgb(var(--kind-build-rgb)/0.14)] text-[rgb(var(--kind-build-rgb))]',
  container: 'bg-[rgb(var(--kind-container-rgb)/0.14)] text-[rgb(var(--kind-container-rgb))]',
  db: 'bg-[rgb(var(--kind-db-rgb)/0.14)] text-[rgb(var(--kind-db-rgb))]',
  system: 'bg-[rgb(var(--kind-system-rgb)/0.14)] text-[rgb(var(--kind-system-rgb))]',
  ai: 'bg-[rgb(var(--kind-ai-rgb)/0.14)] text-[rgb(var(--kind-ai-rgb))]',
  'ai-ide': 'bg-[rgb(var(--kind-ai-ide-rgb)/0.14)] text-[rgb(var(--kind-ai-ide-rgb))]',
};

/** 未知 kind 的兜底配色（与原三处内联兜底一致）。 */
export const KIND_COLOR_FALLBACK = 'bg-[rgb(var(--kind-system-rgb)/0.14)] text-[rgb(var(--kind-system-rgb))]';

/** 取 kind 配色，未知 kind 回退 system 灰。 */
export function kindColorOf(kind: string): string {
  return KIND_COLORS[kind] ?? KIND_COLOR_FALLBACK;
}
