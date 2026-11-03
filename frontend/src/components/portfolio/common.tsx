/* Shared pieces for the portfolio pages (KPI header, value-history chart, helpers). */
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import type { ReactNode } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { axisProps, ChartTooltip, Legend } from "@/components/charts";
import { Badge, Card, Delta, ErrorState, Skeleton, Stat, Tabs } from "@/components/ui";
import { api } from "@/lib/api";
import { date, dateTime, inr, inrCompact, monthYear, pct, shortDate } from "@/lib/format";
import { useChartColors } from "@/lib/theme";
import type { HistoryResp, HoldingRow, Totals } from "@/lib/types";

export type Period = "1M" | "3M" | "6M" | "1Y" | "ALL";
export const PERIODS: { value: Period; label: string }[] = [
  { value: "1M", label: "1M" },
  { value: "3M", label: "3M" },
  { value: "6M", label: "6M" },
  { value: "1Y", label: "1Y" },
  { value: "ALL", label: "All" },
];

export function todayIST(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export const QUERY_KEYS_TO_REFRESH = [["portfolio"], ["dashboard"], ["history"], ["accounts"], ["holding"], ["exposure"]];

/** Metron-style consolidated money summary. */
export function KpiHeader({ totals, loading, extra }: { totals?: Totals; loading?: boolean; extra?: ReactNode }) {
  if (loading || !totals)
    return (
      <div className="card p-5 sm:p-6">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-7 w-32" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </div>
      </div>
    );
  const t = totals;
  return (
    <section className="card relative overflow-hidden animate-fadein">
      <div className="hero-glow pointer-events-none absolute inset-0 opacity-70" />
      <div className="relative grid grid-cols-2 gap-x-6 gap-y-5 p-5 sm:p-6 lg:grid-cols-[1.35fr_1fr_1fr_1fr_1fr]">
        <Stat
          className="col-span-2 lg:col-span-1"
          big
          label="Net worth"
          value={inr(t.value)}
          sub={
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>{t.holdings} open holding{t.holdings === 1 ? "" : "s"}</span>
              {t.valued_at && <span className="text-faint">· prices as of {dateTime(t.valued_at)}</span>}
            </span>
          }
        />
        <Stat label="Invested" value={inr(t.invested)} sub="Cost basis of open holdings" hint="Remaining cost of units you still hold (average-cost method), including fees." />
        <Stat
          label="Unrealised P&L"
          value={<span className={clsx(t.pnl > 0 ? "text-pos" : t.pnl < 0 ? "text-neg" : "text-ink")}>{inr(t.pnl, { sign: true })}</span>}
          sub={<Delta value={t.pnl_pct} />}
        />
        <Stat
          label="XIRR"
          value={t.xirr === null ? "—" : pct(t.xirr, 2)}
          sub={t.realised_pnl ? `Realised ${inr(t.realised_pnl, { sign: true })}` : "Annualised, money-weighted"}
          hint="Annualised return that accounts for when each rupee was invested or withdrawn."
        />
        <Stat
          label="Today"
          value={<span className={clsx(t.day_change > 0 ? "text-pos" : t.day_change < 0 ? "text-neg" : "text-ink")}>{inr(t.day_change, { sign: true })}</span>}
          sub={<Delta value={t.day_change_pct} />}
        />
      </div>
      {extra && <div className="relative border-t border-line/60 px-5 py-3 sm:px-6">{extra}</div>}
    </section>
  );
}

/** Portfolio value (area) vs invested (dashed line), with period tabs and time-weighted return. */
export function ValueHistoryCard({ period, onPeriod, className, height = 260 }: { period: Period; onPeriod: (p: Period) => void; className?: string; height?: number }) {
  const c = useChartColors();
  const q = useQuery({
    queryKey: ["history", period],
    queryFn: () => api.get<HistoryResp>(`/api/portfolio/history?period=${period}`),
  });
  const pts = q.data?.points ?? [];
  const long = period === "1Y" || period === "ALL";
  const first = pts[0];
  const last = pts[pts.length - 1];
  return (
    <Card
      className={className}
      title="Portfolio value"
      subtitle={q.data?.method ?? "Value of your holdings over time vs. money invested"}
      actions={<Tabs size="sm" value={period} onChange={onPeriod} items={PERIODS} />}
    >
      {q.isLoading ? (
        <div style={{ height: height + 44 }}>
          <Skeleton className="h-full w-full" />
        </div>
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : pts.length < 2 ? (
        <div className="grid place-items-center text-sm text-muted" style={{ height }}>
          Not enough history yet — value history starts from your first transaction date.
        </div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="text-2xl font-bold tnum">{inr(last.value)}</span>
              <span className="text-sm text-muted">
                Time-weighted return <Delta value={q.data?.twr ?? null} className="ml-1" />
              </span>
              <span className="text-xs text-faint">
                {date(first.date)} → {date(last.date)}
              </span>
            </div>
            <Legend
              items={[
                { label: "Value", color: c.series[0] },
                { label: "Invested", color: c.muted, dashed: true },
              ]}
            />
          </div>
          <div style={{ height }} role="img" aria-label={`Portfolio value from ${inr(first.value)} to ${inr(last.value)}`}>
            <ResponsiveContainer>
              <ComposedChart data={pts} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="pv-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={c.series[0]} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={c.series[0]} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="0" />
                <XAxis dataKey="date" {...axisProps} tickFormatter={(v: string) => (long ? monthYear(v) : shortDate(v))} />
                <YAxis {...axisProps} width={64} tickFormatter={(v: number) => inrCompact(v)} domain={["auto", "auto"]} />
                <Tooltip
                  content={<ChartTooltip labelFormatter={(l) => date(l)} valueFormatter={(v) => inr(v)} />}
                  cursor={{ stroke: c.muted, strokeWidth: 1 }}
                />
                <Area type="monotone" dataKey="value" name="Value" stroke={c.series[0]} strokeWidth={2} fill="url(#pv-fill)" isAnimationActive={false} activeDot={{ r: 4, strokeWidth: 2, stroke: c.surface }} />
                <Line type="stepAfter" dataKey="invested" name="Invested" stroke={c.muted} strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </Card>
  );
}

export function FreshnessMarks({ h }: { h: Pick<HoldingRow, "stale" | "synthetic" | "estimated" | "as_of" | "source" | "delay_note"> }) {
  const title = [h.source, h.as_of ? `as of ${dateTime(h.as_of)}` : null, h.delay_note].filter(Boolean).join(" · ");
  return (
    <span className="inline-flex flex-wrap items-center gap-1" title={title}>
      {h.synthetic && <Badge tone="warn">Synthetic</Badge>}
      {h.stale && <Badge tone="warn">Stale</Badge>}
      {h.estimated && <Badge tone="neutral">Est.</Badge>}
    </span>
  );
}

export function WeightBar({ value, max = 100 }: { value: number; max?: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface2">
        <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, (value / max) * 100)}%` }} />
      </div>
      <span className="w-12 text-right tnum text-muted">{pct(value, 1)}</span>
    </div>
  );
}

export function PnlCell({ pnl, pnlPct }: { pnl: number | null; pnlPct: number | null }) {
  if (pnl === null) return <span className="text-faint">—</span>;
  return (
    <div className="text-right">
      <div className={clsx("tnum font-medium", pnl > 0 ? "text-pos" : pnl < 0 ? "text-neg" : "text-ink")}>{inr(pnl, { sign: true })}</div>
      <Delta value={pnlPct} className="text-xs" />
    </div>
  );
}

export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const blob = new Blob(["﻿" + rows.map((r) => r.map(esc).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const TYPE_TABS = [
  { value: "all", label: "All", match: () => true },
  { value: "equity", label: "Stocks", match: (c: string) => c === "equity" },
  { value: "mf", label: "Mutual funds", match: (c: string) => c === "mf" },
  { value: "etf", label: "ETFs", match: (c: string) => c === "etf" },
  { value: "metal", label: "Gold & Silver", match: (c: string) => c === "gold" || c === "silver" },
  { value: "fd", label: "FDs", match: (c: string) => c === "fd" },
] as const;
export type TypeTab = (typeof TYPE_TABS)[number]["value"];

/** Friendlier names for physical metal held against the reference series. */
export function displayName(h: Pick<HoldingRow, "instrument">): string {
  const i = h.instrument;
  if ((i.asset_class === "gold" || i.asset_class === "silver") && i.exchange === "REF") return i.asset_class === "gold" ? "Physical gold" : "Physical silver";
  return i.name;
}

export function instrumentSub(h: HoldingRow): string {
  const i = h.instrument;
  if (i.asset_class === "mf") return `${i.category ?? "Mutual fund"} · AMFI ${i.amfi_code ?? ""}`.trim();
  if (i.asset_class === "fd") return `${String(h.meta?.bank ?? "Bank")} · ${String(h.meta?.rate ?? "")}% p.a.`;
  if ((i.asset_class === "gold" || i.asset_class === "silver") && i.exchange === "REF")
    return `${h.meta?.purity ? `${(Number(h.meta.purity) * 1000).toFixed(0)} purity` : "999 purity"} · weight in grams · valued at reference rate`;
  return [i.symbol, i.sector ?? i.category].filter(Boolean).join(" · ");
}
