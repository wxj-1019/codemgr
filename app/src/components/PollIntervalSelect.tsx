// 面板 header 的刷新间隔选择器。四个档位：1s / 2s / 5s / 暂停（0）。
// 样式沿用 header 输入/按钮风格（语义色，亮暗主题自动适配）。
const OPTIONS: { ms: number; label: string }[] = [
  { ms: 1000, label: '1s' },
  { ms: 2000, label: '2s' },
  { ms: 5000, label: '5s' },
  { ms: 0, label: '暂停' },
];

export function PollIntervalSelect({
  value,
  onChange,
}: {
  value: number;
  onChange: (ms: number) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="rounded-lg border border-line bg-surface-panel px-2 py-1 text-xs text-content-primary outline-none focus:border-accent/50"
      title="刷新间隔"
      aria-label="刷新间隔"
    >
      {OPTIONS.map((o) => (
        <option key={o.ms} value={o.ms}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
