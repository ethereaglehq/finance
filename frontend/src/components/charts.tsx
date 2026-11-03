/* Shared chart primitives (Recharts). Thin marks, recessive grid, crosshair tooltips, theme-aware colors. */
import clsx from "clsx";
import { useId, type ReactNode } from "react";
import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, YAxis, type TooltipProps } from "recharts";
import { inrCompact, pct } from "@/lib/format";
import { useChartColors } from "@/lib/theme";

export const axisProps = {
  tickLine: false,
  axisLine: false,
  tick: { fontSize: 11 },
  minTickGap: 24,
} as const;

export function ChartTooltip({ active, payload, label, labelFormatter, valueFormatter, hideZero }: TooltipProps<number, string> & {
  labelFormatter?: (l: string) => ReactNode;
  valueFormatter?: (v: number, name: string) => ReactNode;
  hideZero?: boolean;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-[160px] rounded-lg border border-line bg-surface/95 px-3 py-2 text-xs shadow-2xl backdrop-blur">
      {label !== undefined && <div className="mb-1.5 font-semibold text-ink">{labelFormatter ? labelFormatter(String(label)) : label}</div>}
      <div className="space-y-1">
        {payload
          .filter((p) => p.value !== null && p.value !== undefined && !(hideZero && p.value === 0))
          .map((p, i) => (
            <div key={i} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-muted">
                <span className="h-2 w-2 rounded-full" style={{ background: (p.color as string) || (p.payload?.fill as string) }} />
                {p.name}
              </span>
              <span className="font-semibold tnum text-ink">
                {valueFormatter ? valueFormatter(Number(p.value), String(p.name)) : Array.isArray(p.value) ? (p.value as number[]).join(" – ") : p.value}
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}

export function Sparkline({ data, positive, height = 40, className }: { data: number[]; positive?: boolean; height?: number; className?: string }) {
  const c = useChartColors();
  const uid = useId();
  if (!data?.length) return <div style={{ height }} className={className} />;
  const up = positive ?? data[data.length - 1] >= data[0];
  const color = up ? c.pos : c.neg;
  const pts = data.map((v, i) => ({ i, v }));
  const min = Math.min(...data);
  const max = Math.max(...data);
  const id = `sp-${uid.replace(/:/g, "")}`;
  return (
    <div className={clsx("w-full", className)} style={{ height }} aria-hidden>
      <ResponsiveContainer>
        <AreaChart data={pts} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={[min - (max - min) * 0.08, max + (max - min) * 0.08]} />
          <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.75} fill={`url(#${id})`} isAnimationActive={false} baseValue={min - (max - min) * 0.08} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Donut with an HTML legend (legend always present for ≥2 slices; values in text ink). */
export function Donut({ items, center, height = 190, valueFormatter = (v: number) => inrCompact(v) }: {
  items: { label: string; value: number; pct?: number }[];
  center?: ReactNode;
  height?: number;
  valueFormatter?: (v: number) => string;
}) {
  const c = useChartColors();
  const total = items.reduce((s, x) => s + x.value, 0) || 1;
  const top = items.slice(0, 7);
  const rest = items.slice(7);
  const data = rest.length ? [...top, { label: "Other", value: rest.reduce((s, x) => s + x.value, 0) }] : top;
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
      <div className="relative shrink-0" style={{ width: height, height }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="label" innerRadius="66%" outerRadius="98%" paddingAngle={data.length > 1 ? 1.5 : 0} stroke={c.surface} strokeWidth={2} isAnimationActive={false}>
              {data.map((_, i) => (
                <Cell key={i} fill={c.series[i % 8]} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip valueFormatter={(v) => `${valueFormatter(v)} · ${pct((v / total) * 100, 1)}`} />} />
          </PieChart>
        </ResponsiveContainer>
        {center && <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">{center}</div>}
      </div>
      <ul className="w-full min-w-0 space-y-1.5 text-sm">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2 text-muted">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: c.series[i % 8] }} />
              <span className="truncate">{d.label}</span>
            </span>
            <span className="shrink-0 tnum text-ink">
              {pct((d.value / total) * 100, 1)} <span className="text-faint">· {valueFormatter(d.value)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** HTML horizontal bar list — magnitude by length, one accent hue, values in text ink. */
export function BarList({ items, max, valueLabel, onClick, threshold, color }: {
  items: { label: ReactNode; value: number; sub?: ReactNode; key?: string | number; segments?: { value: number; color?: string; name: string }[] }[];
  max?: number;
  valueLabel?: (v: number) => ReactNode;
  onClick?: (i: number) => void;
  threshold?: number;
  color?: string;
}) {
  const c = useChartColors();
  const m = max ?? Math.max(...items.map((i) => i.value), 1e-9);
  return (
    <ul className="space-y-2.5">
      {items.map((it, i) => {
        const w = Math.max(1.5, (it.value / m) * 100);
        return (
          <li key={it.key ?? i} className={clsx("group", onClick && "cursor-pointer")} onClick={() => onClick?.(i)}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-ink">{it.label}</span>
              <span className="shrink-0 tnum font-semibold text-ink">{valueLabel ? valueLabel(it.value) : it.value}</span>
            </div>
            <div className="relative h-2 w-full overflow-hidden rounded-full bg-surface2">
              {it.segments ? (
                <div className="flex h-full gap-[2px]" style={{ width: `${w}%` }}>
                  {it.segments.map((s, j) => (
                    <div key={j} title={`${s.name}`} className="h-full first:rounded-l-full last:rounded-r-full" style={{ flex: s.value, background: s.color ?? c.series[j] }} />
                  ))}
                </div>
              ) : (
                <div className="h-full rounded-full transition-all group-hover:brightness-110" style={{ width: `${w}%`, background: color ?? c.series[0] }} />
              )}
              {threshold !== undefined && threshold <= m && (
                <div className="absolute top-[-2px] h-3 w-[2px] bg-warn" style={{ left: `${(threshold / m) * 100}%` }} title={`Threshold ${threshold}`} />
              )}
            </div>
            {it.sub && <div className="mt-1 text-xs text-faint">{it.sub}</div>}
          </li>
        );
      })}
    </ul>
  );
}

/** Sequential one-hue heatmap matrix (HTML grid). Values 0..max; labels on rows/cols. */
export function HeatMatrix({ rows, cols, values, max = 100, format = (v: number) => `${v.toFixed(0)}%`, diverging = false }: {
  rows: string[]; cols: string[]; values: (number | null)[][]; max?: number; format?: (v: number) => string; diverging?: boolean;
}) {
  const c = useChartColors();
  const cell = (v: number | null) => {
    if (v === null || Number.isNaN(v)) return { background: "transparent" };
    if (diverging) {
      const a = Math.min(1, Math.abs(v) / max);
      const base = v >= 0 ? c.series[0] : c.series[7];
      return { background: `color-mix(in oklab, ${base} ${Math.round(a * 85)}%, ${c.surface2})` };
    }
    const a = Math.min(1, Math.max(0, v / max));
    return { background: `color-mix(in oklab, ${c.seq1} ${Math.round(8 + a * 82)}%, ${c.surface2})` };
  };
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-[3px] text-xs">
        <thead>
          <tr>
            <th />
            {cols.map((cl) => (
              <th key={cl} className="max-w-[90px] px-1 pb-1 text-left align-bottom font-medium text-faint" title={cl}>
                <span className="line-clamp-2">{cl}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r}>
              <th className="max-w-[180px] pr-2 text-left font-medium text-muted" title={r}>
                <span className="line-clamp-2">{r}</span>
              </th>
              {values[i].map((v, j) => (
                <td key={j} className="h-10 min-w-[56px] rounded-md text-center font-semibold tnum text-ink" style={cell(v)} title={`${r} × ${cols[j]}: ${v === null ? "—" : format(v)}`}>
                  {v === null ? "—" : format(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Legend({ items }: { items: { label: ReactNode; color: string; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
      {items.map((it, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          <span className={clsx("inline-block h-0.5 w-4 rounded", it.dashed && "border-t-2 border-dashed bg-transparent")} style={it.dashed ? { borderColor: it.color } : { background: it.color, height: 3 }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}
