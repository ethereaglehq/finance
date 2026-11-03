/* Horizontal 100% stacked bar with 2px surface gaps between segments (dataviz spacer rule). */
import clsx from "clsx";
import { useChartColors } from "@/lib/theme";

export interface Segment {
  key: string;
  label: string;
  value: number;
}

export function StackedBar({ segments, height = 12, className, showValues }: { segments: Segment[]; height?: number; className?: string; showValues?: boolean }) {
  const c = useChartColors();
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0) || 1;
  return (
    <div className={clsx("flex w-full gap-[2px] overflow-hidden rounded-md bg-surface2", className)} style={{ height }} role="img"
      aria-label={segments.filter((s) => s.value > 0).map((s) => `${s.label} ${s.value.toFixed(0)}%`).join(", ")}>
      {segments.map((s, i) =>
        s.value > 0 ? (
          <div
            key={s.key}
            className="flex h-full items-center justify-center overflow-hidden text-[10px] font-semibold text-white first:rounded-l-md last:rounded-r-md"
            style={{ width: `${(Math.max(0, s.value) / total) * 100}%`, background: c.series[i % 8] }}
            title={`${s.label}: ${s.value.toFixed(1)}%`}
          >
            {showValues && s.value / total > 0.07 ? `${Math.round(s.value)}%` : ""}
          </div>
        ) : null,
      )}
    </div>
  );
}

export function StackLegend({ segments }: { segments: Segment[] }) {
  const c = useChartColors();
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted">
      {segments.map((s, i) => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: c.series[i % 8] }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}
