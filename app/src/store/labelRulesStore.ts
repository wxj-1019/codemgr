// 标签规则 store：localStorage 持久化用户自定义，合并默认规则。
//
// 设计要点：labelForProcess 在 memoized 的 ProcessRow 热路径里被同步调用，
// 不能在那里订阅 store（会触发额外渲染）。因此用一个模块级变量 activeRules
// 暂存「合并后的规则」，store 状态一变就同步更新它。labelForProcess 直接读它。
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_RULES } from '../lib/defaultRules';
import type { LabelRule } from '../lib/labelRules';

export interface LabelRuleOverride {
  label?: string;
  kind?: string;
  enabled?: boolean;
}

/** 导入/导出的载荷形状（与 ipc-types 的 LabelRulesPayload 对齐，但用本包的 LabelRule 类型）。 */
export interface LabelRulesSnapshot {
  version: 1;
  userRules: LabelRule[];
  disabledDefaultIds: string[];
  overrides: Record<string, LabelRuleOverride>;
}

interface LabelRulesState {
  /** 用户自定义规则（始终排在默认规则之后） */
  userRules: LabelRule[];
  /** 被用户禁用的默认规则 id */
  disabledDefaultIds: string[];
  /** 对默认规则的部分覆盖（如改 label） */
  overrides: Record<string, LabelRuleOverride>;
  // actions
  addUserRule: (r: LabelRule) => void;
  updateUserRule: (id: string, patch: Partial<LabelRule>) => void;
  removeUserRule: (id: string) => void;
  toggleDefault: (id: string, enabled: boolean) => void;
  setDefaultOverride: (id: string, patch: LabelRuleOverride) => void;
  resetAll: () => void;
  /** 导入：整体替换现有规则（语义=替换，非合并）。返回替换的规则条数，便于 UI 提示。 */
  replaceAll: (snapshot: LabelRulesSnapshot) => number;
}

/** 计算合并后的规则（默认去 disabled + 应用 override + 追加 userRules）。 */
export function mergeRules(s: LabelRulesState): LabelRule[] {
  const result: LabelRule[] = [];
  for (const d of DEFAULT_RULES) {
    if (s.disabledDefaultIds.includes(d.id)) continue;
    const ov = s.overrides[d.id];
    result.push({
      ...d,
      ...(ov?.label !== undefined ? { label: ov.label } : {}),
      ...(ov?.kind !== undefined ? { kind: ov.kind } : {}),
      ...(ov?.enabled !== undefined ? { enabled: ov.enabled } : {}),
    });
  }
  for (const u of s.userRules) result.push(u);
  return result;
}

// ── 模块级同步缓存：labelForProcess 直接读这个，避免在 React 渲染热路径订阅 store ──
let activeRules: LabelRule[] = DEFAULT_RULES;

/** labelForProcess 同步读取合并后的规则。 */
export function getActiveRules(): LabelRule[] {
  return activeRules;
}

function refreshActive(s: LabelRulesState): LabelRule[] {
  const merged = mergeRules(s);
  activeRules = merged;
  return merged;
}

export const useLabelRulesStore = create<LabelRulesState>()(
  persist(
    (set, get) => {
      // 初始化时先刷新一次模块级缓存
      const initial: LabelRulesState = {
        userRules: [],
        disabledDefaultIds: [],
        overrides: {},
        addUserRule: (r) => {
          set((s) => ({ userRules: [...s.userRules, r] }));
          refreshActive(get());
        },
        updateUserRule: (id, patch) => {
          set((s) => ({ userRules: s.userRules.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
          refreshActive(get());
        },
        removeUserRule: (id) => {
          set((s) => ({ userRules: s.userRules.filter((r) => r.id !== id) }));
          refreshActive(get());
        },
        toggleDefault: (id, enabled) => {
          set((s) => ({
            disabledDefaultIds: enabled
              ? s.disabledDefaultIds.filter((x) => x !== id)
              : (s.disabledDefaultIds.includes(id) ? s.disabledDefaultIds : [...s.disabledDefaultIds, id]),
          }));
          refreshActive(get());
        },
        setDefaultOverride: (id, patch) => {
          set((s) => ({ overrides: { ...s.overrides, [id]: { ...s.overrides[id], ...patch } } }));
          refreshActive(get());
        },
        resetAll: () => {
          set({ userRules: [], disabledDefaultIds: [], overrides: {} });
          refreshActive(get());
        },
        // 导入=替换：整体覆盖三个字段。深拷贝避免外部对象后续被改动污染 store。
        // 返回 userRules 条数供 UI 提示（"已导入 N 条自定义规则"）。
        replaceAll: (snapshot) => {
          set({
            userRules: snapshot.userRules.map((r) => ({ ...r })),
            disabledDefaultIds: [...snapshot.disabledDefaultIds],
            overrides: Object.fromEntries(
              Object.entries(snapshot.overrides).map(([k, v]) => [k, { ...v }]),
            ),
          });
          refreshActive(get());
          return get().userRules.length;
        },
      };
      refreshActive(initial);
      return initial;
    },
    {
      name: 'codemgr:labelRules',
      partialize: (s) => ({
        userRules: s.userRules,
        disabledDefaultIds: s.disabledDefaultIds,
        overrides: s.overrides,
      }),
      // 持久化恢复后，用 rehydrated 数据刷新模块级缓存
      onRehydrateStorage: () => (state) => {
        if (state) refreshActive(state);
      },
    },
  ),
);

/** 生成新规则 id（浏览器/Electron 都有 crypto.randomUUID）。 */
export function newRuleId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'r-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}
