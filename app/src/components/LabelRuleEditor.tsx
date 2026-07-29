// 标签规则编辑器：模态弹窗。
// - 上半：规则列表（默认 + 用户自定义），可启用/禁用/删除（用户规则）/改 label。
// - 下半：新增用户规则表单 + 实时预览（输入 name+cmdline 即时显示命中结果）。
import { useState } from 'react';
import { DEFAULT_RULES } from '../lib/defaultRules';
import { matchRules, type LabelRule, type MatchField } from '../lib/labelRules';
import { labelForProcess } from '../lib/processLabels';
import { useLabelRulesStore, newRuleId } from '../store/labelRulesStore';

const KIND_COLORS: Record<string, string> = {
  dev: 'bg-accent/20 text-accent',
  test: 'bg-green-500/20 text-green-400',
  build: 'bg-purple-500/20 text-purple-400',
  container: 'bg-blue-500/20 text-blue-400',
  db: 'bg-amber-500/20 text-amber-400',
  system: 'bg-slate-600/30 text-fg-secondary',
};

function badge(kind: string, label: string) {
  return (
    <span className={`rounded px-1 text-[10px] ${KIND_COLORS[kind] || 'bg-slate-600/30 text-fg-secondary'}`}>
      {label}
    </span>
  );
}

export function LabelRuleEditor({ onClose }: { onClose: () => void }) {
  const { userRules, disabledDefaultIds, overrides,
    addUserRule, removeUserRule, toggleDefault, setDefaultOverride } = useLabelRulesStore();

  // 新增表单草稿
  const [dLabel, setDLabel] = useState('');
  const [dKind, setDKind] = useState('dev');
  const [dField, setDField] = useState<MatchField>('both');
  const [dInclude, setDInclude] = useState(''); // 逗号分隔 → include
  const [dExclude, setDExclude] = useState(''); // 逗号分隔 → exclude

  // 预览
  const [pName, setPName] = useState('node.exe');
  const [pCmd, setPCmd] = useState('node vite');

  const parseList = (s: string): string[] =>
    s.split(',').map((x) => x.trim()).filter(Boolean);

  const canAdd = dLabel.trim() !== '' && parseList(dInclude).length > 0;

  function handleAdd() {
    if (!canAdd) return;
    const rule: LabelRule = {
      id: newRuleId(),
      label: dLabel.trim(),
      kind: dKind.trim() || 'dev',
      field: dField,
      enabled: true,
      groups: [{ include: parseList(dInclude), exclude: parseList(dExclude) }],
    };
    addUserRule(rule);
    setDLabel(''); setDInclude(''); setDExclude('');
  }

  // 用当前表单规则做预览命中（不污染 store）
  const previewRule: LabelRule | null = canAdd
    ? { id: '__preview__', label: dLabel.trim(), kind: dKind.trim() || 'dev', field: dField, enabled: true, groups: [{ include: parseList(dInclude), exclude: parseList(dExclude) }] }
    : null;
  const draftHit = previewRule ? matchRules([previewRule], pName, pCmd) : null;
  const fullHit = labelForProcess(pName, pCmd);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-[640px] flex-col rounded-lg border border-base-600 bg-base-800 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-base-700 px-5 py-3">
          <h3 className="text-base font-semibold text-fg-primary">标签规则</h3>
          <button onClick={onClose} className="text-fg-muted hover:text-fg-primary" aria-label="关闭">✕</button>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4 text-sm">
          {/* 默认规则 */}
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-muted">默认规则</p>
          <div className="space-y-1">
            {DEFAULT_RULES.map((d) => {
              const disabled = disabledDefaultIds.includes(d.id);
              const ovLabel = overrides[d.id]?.label;
              const ovEnabled = overrides[d.id]?.enabled;
              const enabled = ovEnabled !== undefined ? ovEnabled : !disabled;
              return (
                <div key={d.id} className="flex items-center gap-2 rounded border border-base-700 bg-base-900 px-2 py-1.5">
                  <input type="checkbox" checked={enabled}
                    onChange={(e) => toggleDefault(d.id, e.target.checked)}
                    className="accent-accent" />
                  <span className="w-28 shrink-0">{badge(d.kind, ovLabel ?? d.label)}</span>
                  <span className="truncate font-mono text-[11px] text-fg-muted">
                    {d.field} · {d.groups.map((g) => g.include.join('+')).join(' | ')}
                  </span>
                </div>
              );
            })}
          </div>

          {/* 用户规则 */}
          {userRules.length > 0 && (
            <>
              <p className="mb-1 mt-4 text-xs font-medium uppercase tracking-wide text-fg-muted">自定义规则</p>
              <div className="space-y-1">
                {userRules.map((u) => (
                  <div key={u.id} className="flex items-center gap-2 rounded border border-base-700 bg-base-900 px-2 py-1.5">
                    <span className="w-28 shrink-0">{badge(u.kind, u.label)}</span>
                    <span className="truncate font-mono text-[11px] text-fg-muted">
                      {u.field} · {u.groups.map((g) => g.include.join('+')).join(' | ')}
                    </span>
                    <button onClick={() => removeUserRule(u.id)}
                      className="ml-auto shrink-0 text-fg-muted hover:text-red-400" aria-label="删除">✕</button>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* 新增表单 */}
          <p className="mb-1 mt-4 text-xs font-medium uppercase tracking-wide text-fg-muted">新增规则</p>
          <div className="space-y-2 rounded border border-base-700 bg-base-900 p-3">
            <div className="flex gap-2">
              <input value={dLabel} onChange={(e) => setDLabel(e.target.value)} placeholder="标签文本 (如 my-tool)"
                className="w-40 rounded border border-base-600 bg-base-900 px-2 py-1 text-sm text-fg-primary outline-none focus:border-accent" />
              <input value={dKind} onChange={(e) => setDKind(e.target.value)} placeholder="类别 (如 dev)"
                className="w-24 rounded border border-base-600 bg-base-900 px-2 py-1 text-sm text-fg-primary outline-none focus:border-accent" />
              <select value={dField} onChange={(e) => setDField(e.target.value as MatchField)}
                className="rounded border border-base-600 bg-base-900 px-2 py-1 text-sm text-fg-primary outline-none focus:border-accent">
                <option value="both">both</option>
                <option value="name">name</option>
                <option value="cmdline">cmdline</option>
              </select>
            </div>
            <input value={dInclude} onChange={(e) => setDInclude(e.target.value)} placeholder="匹配关键字 (逗号分隔, 全部命中=AND)"
              className="w-full rounded border border-base-600 bg-base-900 px-2 py-1 text-sm text-fg-primary outline-none focus:border-accent" />
            <input value={dExclude} onChange={(e) => setDExclude(e.target.value)} placeholder="排除关键字 (逗号分隔, 任一命中则不匹配)"
              className="w-full rounded border border-base-600 bg-base-900 px-2 py-1 text-sm text-fg-primary outline-none focus:border-accent" />
            <button onClick={handleAdd} disabled={!canAdd}
              className="rounded bg-accent px-3 py-1 text-sm font-medium text-base-900 disabled:opacity-40">
              添加
            </button>
          </div>

          {/* 预览 */}
          <p className="mb-1 mt-4 text-xs font-medium uppercase tracking-wide text-fg-muted">实时预览</p>
          <div className="space-y-2 rounded border border-base-700 bg-base-900 p-3">
            <div className="flex gap-2">
              <input value={pName} onChange={(e) => setPName(e.target.value)} placeholder="进程名"
                className="w-40 rounded border border-base-600 bg-base-900 px-2 py-1 text-sm text-fg-primary outline-none focus:border-accent" />
              <input value={pCmd} onChange={(e) => setPCmd(e.target.value)} placeholder="命令行"
                className="flex-1 rounded border border-base-600 bg-base-900 px-2 py-1 text-sm text-fg-primary outline-none focus:border-accent" />
            </div>
            <div className="text-xs text-fg-secondary">
              <span className="text-fg-muted">新规则命中：</span>{draftHit ? badge(draftHit.kind, draftHit.label) : <span className="text-fg-muted">无</span>}
              <span className="ml-4 text-fg-muted">完整命中：</span>{fullHit ? badge(fullHit.kind, fullHit.label) : <span className="text-fg-muted">无</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
