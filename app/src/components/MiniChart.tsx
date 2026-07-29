// 单进程迷你曲线：从 PerfPanel 的 AreaChart 提炼，适配侧栏窄宽度（无 X 轴 label、80px 高）。
// 复用 Recharts（已是依赖），与性能面板风格一致。
import { AreaChart, Area, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

interface MiniChartProps<D> {
  data: D[];
  dataKey: string;
  color: string;
  /** Y 轴定义域，如 [0,100]；不传则自动 */
  domain?: [number | 'auto', number | 'auto'];
  /** tooltip 数值格式化（接受原始值，返回显示串） */
  formatValue?: (v: number) => string;
  /** 用于 tooltip 与 gradient 的唯一 id 后缀 */
  idSuffix: string;
}

export function MiniChart<D>({ data, dataKey, color, domain, formatValue, idSuffix }: MiniChartProps<D>) {
  const gradId = `miniGrad-${idSuffix}`;
  return (
    <div className="h-20">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.5} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis
            domain={domain ?? ['auto', 'auto']}
            width={32}
            tick={{ fill: '#64748b', fontSize: 10 }}
          />
          <Tooltip
            contentStyle={{ background: '#1a2028', border: '1px solid #2f3947', borderRadius: 6, fontSize: 11 }}
            labelFormatter={() => ''}
            formatter={(v: number | string) => [formatValue ? formatValue(Number(v)) : String(v), '']}
          />
          <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={1.5} fill={`url(#${gradId})`} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
