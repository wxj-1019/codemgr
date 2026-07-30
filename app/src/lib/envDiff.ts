// 环境变量对比（子项目 F，纯逻辑）：Windows env 键大小写不敏感，显示保留原大小写。
export interface EnvChange { key: string; aVal: string; bVal: string }
export interface EnvDiffResult {
  added: string[];
  removed: string[];
  changed: EnvChange[];
  sameCount: number;
}

export function diffEnv(a: Record<string, string>, b: Record<string, string>): EnvDiffResult {
  const lowerA = new Map(Object.entries(a).map(([k, v]) => [k.toLowerCase(), [k, v] as const]));
  const lowerB = new Map(Object.entries(b).map(([k, v]) => [k.toLowerCase(), [k, v] as const]));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: EnvChange[] = [];
  let sameCount = 0;
  for (const [lk, [key, aVal]] of lowerA) {
    const inB = lowerB.get(lk);
    if (!inB) removed.push(key);
    else if (inB[1] !== aVal) changed.push({ key, aVal, bVal: inB[1] });
    else sameCount++;
  }
  for (const [lk, [key]] of lowerB) {
    if (!lowerA.has(lk)) added.push(key);
  }
  const byLower = (x: string, y: string) => x.toLowerCase().localeCompare(y.toLowerCase());
  added.sort(byLower);
  removed.sort(byLower);
  changed.sort((x, y) => byLower(x.key, y.key));
  return { added, removed, changed, sameCount };
}
