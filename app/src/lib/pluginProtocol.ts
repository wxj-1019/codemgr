import type { LabelRule } from './labelRules';

/**
 * 只读快照类型（脱敏子集）：推送给视图插件的进程/端口数据。
 * 刻意省略 cwd/cmdline 等可能含敏感信息的字段——插件视图拿到的最小必要信息。
 */
export interface ReadonlyProcessInfo {
  pid: number;
  name: string;
  workingSetBytes: number;
}
export interface ReadonlyConnection {
  protocol: 'tcp' | 'udp';
  localPort: number;
  state: string;
  pid: number;
  processName: string;
}

/**
 * 插件 ↔ 宿主的 postMessage 协议（受控 API 契约，F2）。
 *
 * 安全约束（F1 PoC 已验证）：插件在 iframe sandbox（allow-scripts，无 allow-same-origin）
 * 内运行，结构上无 Node/Electron。通信只能经 postMessage——这是插件唯一的能力出口。
 *
 * 宿主 → 插件（host-to-plugin）：
 *  - 'ready'：宿主就绪，插件可开始注册能力。
 *  - 'snapshot'：只读快照（进程/端口，脱敏子集）。视图插件的数据源，主框架主动推送。
 *  - 'theme'：CSS 变量（v1.7 主题体系），插件用变量而非硬编码色值。
 *
 * 插件 → 宿主（plugin-to-host）：
 *  - 'registerLabelRules'：注册标签规则。
 */
export type HostToPluginMsg =
  | { type: 'ready' }
  | { type: 'snapshot'; processes: ReadonlyProcessInfo[]; ports: ReadonlyConnection[] }
  | { type: 'theme'; vars: Record<string, string> };

export type PluginToHostMsg =
  | { type: 'registerLabelRules'; rules: unknown[] };

/** 插件能注册的规则的"去 id"形态（id 由宿主强制加前缀，插件无法指定）。 */
export type PluginLabelRuleInput = Omit<LabelRule, 'id'>;

/**
 * 校验插件上报的 registerLabelRules 载荷。
 * 防脏 postMessage 让 store 崩（参照 main.ts validateLabelRulesPayload 范式）。
 * 逐条校验；返回过滤后的合法规则（带 `plugin:<pluginId>-` 前缀 id）。
 * 任何字段缺失/类型不符的单条丢弃，整体不抛错。
 */
export function validatePluginRules(pluginId: string, raw: unknown): LabelRule[] {
  if (!Array.isArray(raw)) return [];
  const out: LabelRule[] = [];
  let i = 0;
  for (const item of raw) {
    i++;
    if (typeof item !== 'object' || item === null) continue;
    const r = item as Record<string, unknown>;
    if (typeof r.label !== 'string' || r.label.trim() === '') continue;
    if (typeof r.kind !== 'string') continue;
    if (typeof r.field !== 'string' || !['name', 'cmdline', 'both'].includes(r.field)) continue;
    if (typeof r.enabled !== 'boolean') continue;
    if (!Array.isArray(r.groups)) continue;
    // 校验每组结构
    const groups: LabelRule['groups'] = [];
    let groupsOk = true;
    for (const g of r.groups) {
      if (typeof g !== 'object' || g === null || !Array.isArray((g as Record<string, unknown>).include)) {
        groupsOk = false; break;
      }
      const inc = (g as Record<string, unknown>).include as unknown[];
      if (!inc.every((x) => typeof x === 'string')) { groupsOk = false; break; }
      const grp: LabelRule['groups'][number] = { include: inc as string[] };
      const exc = (g as Record<string, unknown>).exclude;
      if (Array.isArray(exc) && exc.every((x) => typeof x === 'string')) grp.exclude = exc as string[];
      groups.push(grp);
    }
    if (!groupsOk || groups.length === 0) continue;
    // id 强制加 plugin 前缀（防跨插件冲突 + 便于卸载清理），插件无法自行指定
    out.push({
      id: `plugin:${pluginId}-${i}`,
      label: r.label,
      kind: r.kind,
      field: r.field as LabelRule['field'],
      enabled: r.enabled,
      groups,
    });
  }
  return out;
}
