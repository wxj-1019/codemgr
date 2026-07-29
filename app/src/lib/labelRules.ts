// 数据驱动的进程标签规则引擎。
//
// 规则模型：每条规则由若干「条件组」组成（OR 关系），任一组命中即规则命中；
// 每个条件组内的 include 全部命中（AND）且无任何 exclude 命中（NOT）才算该组命中。
// 这套模型能 1:1 表达原 processLabels.ts 的 AND/OR/NOT 混合条件。
//
// 匹配语义：有序首匹配（first-match-wins），与原实现一致——顺序由规则数组的顺序决定。

/** 在哪个字段上匹配 */
export type MatchField = 'name' | 'cmdline' | 'both';

/**
 * 一个条件组。
 * - include：全部子串都命中（AND）才算本组命中。空数组 = 永不命中。
 * - exclude：任一命中则本组不命中（NOT）。
 */
export interface ConditionGroup {
  include: string[];
  exclude?: string[];
}

/** 单条标签规则。 */
export interface LabelRule {
  /** 稳定 ID（crypto.randomUUID()），便于增删/持久化 */
  id: string;
  /** 徽章显示文本 */
  label: string;
  /** 类别（字符串；默认规则用 dev/test/build/container/db/system） */
  kind: string;
  /** 在哪个字段上匹配 */
  field: MatchField;
  /** 条件组（OR） */
  groups: ConditionGroup[];
  /** 是否启用 */
  enabled: boolean;
}

export interface LabelMatch {
  label: string;
  kind: string;
}

/** 取匹配用的大写字段串。both = name + ' ' + cmdline（与原实现一致）。 */
function haystack(field: MatchField, name: string, cmdline: string): {
  name: string;
  cmdline: string;
  both: string;
} {
  return {
    name: name.toLowerCase(),
    cmdline: cmdline.toLowerCase(),
    both: (name + ' ' + cmdline).toLowerCase(),
  };
}

/** 单个子串是否命中指定字段。 */
function includesAny(hay: string, needles: string[]): boolean {
  for (const n of needles) {
    if (n && hay.includes(n.toLowerCase())) return true;
  }
  return false;
}

function includesAll(hay: string, needles: string[]): boolean {
  for (const n of needles) {
    if (!n) return false;
    if (!hay.includes(n.toLowerCase())) return false;
  }
  return true;
}

/** 评估一个条件组在给定字段串上是否命中。 */
function groupMatches(
  g: ConditionGroup,
  hay: { name: string; cmdline: string; both: string },
  field: MatchField,
): boolean {
  if (g.include.length === 0) return false; // 空 include 永不命中
  const target = hay[field];
  if (!includesAll(target, g.include)) return false;
  if (g.exclude && g.exclude.length > 0 && includesAny(target, g.exclude)) return false;
  return true;
}

/** 评估单条规则是否命中。 */
export function ruleMatches(rule: LabelRule, name: string, cmdline: string): boolean {
  if (!rule.enabled) return false;
  if (rule.groups.length === 0) return false;
  const hay = haystack(rule.field, name, cmdline);
  for (const g of rule.groups) {
    if (groupMatches(g, hay, rule.field)) return true;
  }
  return false;
}

/**
 * 有序首匹配引擎：按规则数组顺序评估，返回第一条命中的 label/kind。
 * 与原 labelForProcess 语义一致（first-match-wins）。
 */
export function matchRules(
  rules: LabelRule[],
  name: string,
  cmdline: string,
): LabelMatch | null {
  for (const r of rules) {
    if (ruleMatches(r, name, cmdline)) return { label: r.label, kind: r.kind };
  }
  return null;
}
