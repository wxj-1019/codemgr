// 标签规则编辑器：模态弹窗。
// - 上半：规则列表（默认 + 用户自定义），可启用/禁用/删除（用户规则）/改 label。
// - 下半：新增用户规则表单 + 实时预览（输入 name+cmdline 即时显示命中结果）。
// a11y：焦点陷阱（Tab/Shift+Tab 在模态内循环，不逃逸到背景）、Esc 关闭、
// 打开时焦点落首个文本输入框。
import { useEffect, useRef, useState } from 'react';
import { DEFAULT_RULES } from '../lib/defaultRules';
import { matchRules, type LabelRule, type MatchField } from '../lib/labelRules';
import { labelForProcess } from '../lib/processLabels';
import { ipc } from '../lib/ipc';
import { notify } from '../lib/notify';
import { kindColorOf } from '../lib/kindColors';
import { ConfirmDialog } from './ConfirmDialog';
import { useLabelRulesStore, newRuleId, type LabelRulesSnapshot } from '../store/labelRulesStore';

// Aurora v1.2：kind 配色统一走 lib/kindColors（原三处重复定义已收敛）
function badge(kind: string, label: string) {
  return (
    <span className={`rounded px-1 text-[10px] ${kindColorOf(kind)}`}>
      {label}
    </span>
  );
}

export function LabelRuleEditor({ onClose }: { onClose: () => void }) {
  const { userRules, disabledDefaultIds, overrides,
    addUserRule, removeUserRule, toggleDefault, setDefaultOverride, replaceAll } = useLabelRulesStore();

  // 新增表单草稿
  const [dLabel, setDLabel] = useState('');
  const [dKind, setDKind] = useState('dev');
  const [dField, setDField] = useState<MatchField>('both');
  const [dInclude, setDInclude] = useState(''); // 逗号分隔 → include
  const [dExclude, setDExclude] = useState(''); // 逗号分隔 → exclude

  // 预览
  const [pName, setPName] = useState('node.exe');
  const [pCmd, setPCmd] = useState('node vite');

  // 导入导出进行中态：禁用按钮 + 防并发
  const [ioBusy, setIoBusy] = useState(false);

  // ── 焦点陷阱 ──
  // 模态打开期间 Tab/Shift+Tab 在内部可聚焦元素间循环，不逃逸到背景；
  // 打开时焦点落首个文本输入框（新增规则表单的 label 输入）。
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = modalRef.current?.querySelector<HTMLElement>('input:not([type="checkbox"])');
    el?.focus();
  }, []);

  function onModalKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const root = modalRef.current;
    if (!root) return;
    const focusables = Array.from(
      root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey) {
      // 首元素上 Shift+Tab（或焦点不在模态内）→ 回卷到末元素
      if (active === first || !root.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else {
      // 末元素上 Tab（或焦点不在模态内）→ 回卷到首元素
      if (active === last || !root.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    }
  }

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

  // 导出当前规则集（userRules + 禁用的默认 id + overrides）为 JSON 文件。
  // 文件路径由 main 的保存对话框决定，渲染层不持有路径（红线）。
  async function handleExport() {
    if (ioBusy) return;
    setIoBusy(true);
    try {
      const snapshot: LabelRulesSnapshot = {
        version: 1,
        userRules,
        disabledDefaultIds,
        overrides,
      };
      const ok = await ipc.exportLabelRules(snapshot);
      if (!ok) {
        notify.error('导出失败或已取消');
      }
    } catch (e) {
      notify.error(`导出失败：${String(e)}`);
    } finally {
      setIoBusy(false);
    }
  }

  // 从 JSON 文件导入（语义=替换）。导入前二次确认（ConfirmDialog），避免误覆盖现有规则。
  const [confirmImport, setConfirmImport] = useState(false);

  async function handleImport() {
    if (ioBusy) return;
    // 已有规则时先确认；空规则集直接导入
    if (userRules.length > 0 || disabledDefaultIds.length > 0 || Object.keys(overrides).length > 0) {
      setConfirmImport(true);
      return;
    }
    await doImport();
  }

  async function doImport() {
    setConfirmImport(false);
    setIoBusy(true);
    try {
      const snapshot = await ipc.importLabelRules();
      if (snapshot === null) {
        notify.error('导入失败：文件无效或已取消');
        return;
      }
      const n = replaceAll(snapshot);
      notify.success(`已导入规则（${n} 条自定义 + ${snapshot.disabledDefaultIds.length} 个默认开关变更）`);
    } catch (e) {
      notify.error(`导入失败：${String(e)}`);
    } finally {
      setIoBusy(false);
    }
  }

  // 用当前表单规则做预览命中（不污染 store）
  const previewRule: LabelRule | null = canAdd
    ? { id: '__preview__', label: dLabel.trim(), kind: dKind.trim() || 'dev', field: dField, enabled: true, groups: [{ include: parseList(dInclude), exclude: parseList(dExclude) }] }
    : null;
  const draftHit = previewRule ? matchRules([previewRule], pName, pCmd) : null;
  const fullHit = labelForProcess(pName, pCmd);

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose} onKeyDown={onModalKeyDown}>
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label="标签规则"
        className="glass-elevated flex max-h-[85vh] w-[640px] flex-col rounded-[14px] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-base-700 px-5 py-3">
          <h3 className="text-base font-semibold text-fg-primary">标签规则</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExport}
              disabled={ioBusy}
              title="导出规则到 JSON 文件（含自定义规则 + 默认开关/覆盖）"
              className="rounded-lg px-2 py-1 text-xs text-fg-secondary hover:bg-base-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              导出
            </button>
            <button
              onClick={handleImport}
              disabled={ioBusy}
              title="从 JSON 文件导入规则（替换现有规则）"
              className="rounded-lg px-2 py-1 text-xs text-fg-secondary hover:bg-base-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              导入
            </button>
            <button onClick={onClose} className="text-fg-muted hover:text-fg-primary" aria-label="关闭">✕</button>
          </div>
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
                      className="ml-auto shrink-0 text-fg-muted hover:text-danger" aria-label="删除">✕</button>
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
                className="w-40 rounded-lg border border-base-600 bg-base-900 px-2 py-1 text-sm text-fg-primary outline-none focus:border-accent" />
              <input value={dKind} onChange={(e) => setDKind(e.target.value)} placeholder="类别 (如 dev)"
                className="w-24 rounded-lg border border-base-600 bg-base-900 px-2 py-1 text-sm text-fg-primary outline-none focus:border-accent" />
              <select value={dField} onChange={(e) => setDField(e.target.value as MatchField)}
                className="rounded-lg border border-base-600 bg-base-900 px-2 py-1 text-sm text-fg-primary outline-none focus:border-accent">
                <option value="both">both</option>
                <option value="name">name</option>
                <option value="cmdline">cmdline</option>
              </select>
            </div>
            <input value={dInclude} onChange={(e) => setDInclude(e.target.value)} placeholder="匹配关键字 (逗号分隔, 全部命中=AND)"
              className="w-full rounded-lg border border-base-600 bg-base-900 px-2 py-1 text-sm text-fg-primary outline-none focus:border-accent" />
            <input value={dExclude} onChange={(e) => setDExclude(e.target.value)} placeholder="排除关键字 (逗号分隔, 任一命中则不匹配)"
              className="w-full rounded-lg border border-base-600 bg-base-900 px-2 py-1 text-sm text-fg-primary outline-none focus:border-accent" />
            <button onClick={handleAdd} disabled={!canAdd}
              className="rounded-lg bg-accent px-3 py-1 text-sm font-medium text-base-900 disabled:opacity-40">
              添加
            </button>
          </div>

          {/* 预览 */}
          <p className="mb-1 mt-4 text-xs font-medium uppercase tracking-wide text-fg-muted">实时预览</p>
          <div className="space-y-2 rounded border border-base-700 bg-base-900 p-3">
            <div className="flex gap-2">
              <input value={pName} onChange={(e) => setPName(e.target.value)} placeholder="进程名"
                className="w-40 rounded-lg border border-base-600 bg-base-900 px-2 py-1 text-sm text-fg-primary outline-none focus:border-accent" />
              <input value={pCmd} onChange={(e) => setPCmd(e.target.value)} placeholder="命令行"
                className="flex-1 rounded-lg border border-base-600 bg-base-900 px-2 py-1 text-sm text-fg-primary outline-none focus:border-accent" />
            </div>
            <div className="text-xs text-fg-secondary">
              <span className="text-fg-muted">新规则命中：</span>{draftHit ? badge(draftHit.kind, draftHit.label) : <span className="text-fg-muted">无</span>}
              <span className="ml-4 text-fg-muted">完整命中：</span>{fullHit ? badge(fullHit.kind, fullHit.label) : <span className="text-fg-muted">无</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
    {/* 导入替换确认：与 modal 同级（portal 到 body），避免点击冒泡触发 modal 的 onClose */}
    <ConfirmDialog
      open={confirmImport}
      title="导入标签规则"
      message="导入将替换现有规则，确定继续吗？"
      confirmLabel="导入"
      busy={ioBusy}
      onConfirm={() => void doImport()}
      onCancel={() => setConfirmImport(false)}
    />
    </>
  );
}
