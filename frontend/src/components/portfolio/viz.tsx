/* Local chart pieces for the portfolio pages: a sparkline scaled to its own range and a donut whose legend
   sits beneath the ring (so labels never truncate in narrow cards). */
import type { ReactNode } from "react";
import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { ChartTooltip } from "@/components/charts";
import { inrCompact, pct } from "@/lib/format";
import { useChartColors } from "@/lib/theme";

export function MiniSpark({ data, height = 44, className }: { data: number[]; height?: number; className?: string }) {
  const c = useChartColors();
  if (!data?.length) return <div style={{ height }} className={className} />;
  const up = data[data.length - 1] >= data[0];
  const color = up ? c.pos : c.neg;
  const pts = data.map((v, i) => ({ i, v }));
  const id = `ms-${up ? "u" : "d"}-${data.length}-${Math.round(data[0])}`;
  return (
    <div className={className} style={{ height }} aria-hidden>
      <ResponsiveContainer>
        <AreaChart data={pts} margin={{ top: 3, right: 0, bottom: 3, left: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.25} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.75} fill={`url(#${id})`} isAnimationActive={false} baseValue="dataMin" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function AllocationDonut({ items, center, size = 168 }: { items: { label: string; value: number }[]; center?: ReactNode; size?: number }) {
  const c = useChartColors();
  const total = items.reduce((s, x) => s + x.value, 0) || 1;
  const top = items.slice(0, 7);
  const rest = items.slice(7);
  const data = rest.length ? [...top, { label: "Other", value: rest.reduce((s, x) => s + x.value, 0) }] : top;
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative" style={{ width: size, height: size }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="label" innerRadius="66%" outerRadius="98%" paddingAngle={data.length > 1 ? 1.5 : 0} stroke={c.surface} strokeWidth={2} isAnimationActive={false}>
              {data.map((_, i) => (
                <Cell key={i} fill={c.series[i % 8]} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip valueFormatter={(v) => `${inrCompact(v)} · ${pct((v / total) * 100, 1)}`} />} />
          </PieChart>
        </ResponsiveContainer>
        {center && <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">{center}</div>}
      </div>
      <ul className="w-full space-y-1.5 text-sm">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2 text-muted">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: c.series[i % 8] }} />
              <span className="truncate" title={d.label}>
                {d.label}
              </span>
            </span>
            <span className="shrink-0 tnum text-ink">
              {pct((d.value / total) * 100, 1)} <span className="text-faint">· {inrCompact(d.value)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
