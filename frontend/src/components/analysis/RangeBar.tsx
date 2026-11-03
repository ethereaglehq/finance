/* Compact interval visual: 80% band (light), 50% band (dark), point estimate tick, optional realised marker. */
import clsx from "clsx";
import { pct } from "@/lib/format";

export function RangeBar({ lo80, hi80, lo50, hi50, point, actual, domain, className, height = 12 }: {
  lo80: number; hi80: number; lo50?: number; hi50?: number; point: number; actual?: number | null;
  domain?: [number, number]; className?: string; height?: number;
}) {
  const vals = [lo80, hi80, point, 0, ...(actual !== null && actual !== undefined ? [actual] : [])];
  const span = Math.max(...vals) - Math.min(...vals) || 1;
  const [dmin, dmax] = domain ?? [Math.min(...vals) - span * 0.12, Math.max(...vals) + span * 0.12];
  const x = (v: number) => `${((Math.min(Math.max(v, dmin), dmax) - dmin) / (dmax - dmin)) * 100}%`;
  const w = (a: number, b: number) => `${((Math.min(b, dmax) - Math.max(a, dmin)) / (dmax - dmin)) * 100}%`;
  const inside = actual !== null && actual !== undefined ? actual >= lo80 && actual <= hi80 : null;
  const title = `80% range ${pct(lo80, 1, true)} to ${pct(hi80, 1, true)} · point ${pct(point, 1, true)}${
    actual !== null && actual !== undefined ? ` · realised ${pct(actual, 1, true)}` : ""
  }`;
  return (
    <div className={clsx("relative w-full min-w-[120px]", className)} style={{ height }} title={title} role="img" aria-label={title}>
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line" />
      {dmin < 0 && dmax > 0 && <div className="absolute top-0 h-full w-px bg-faint/60" style={{ left: x(0) }} />}
      <div className="absolute top-1/2 h-[60%] -translate-y-1/2 rounded-sm bg-accent/25" style={{ left: x(lo80), width: w(lo80, hi80) }} />
      {lo50 !== undefined && hi50 !== undefined && (
        <div className="absolute top-1/2 h-[60%] -translate-y-1/2 rounded-sm bg-accent/50" style={{ left: x(lo50), width: w(lo50, hi50) }} />
      )}
      <div className="absolute top-0 h-full w-[2px] -translate-x-1/2 rounded bg-ink" style={{ left: x(point) }} />
      {inside !== null && (
        <div
          className={clsx("absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface", inside ? "bg-pos" : "bg-neg")}
          style={{ left: x(actual as number) }}
        />
      )}
    </div>
  );
}
