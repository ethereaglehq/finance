/* Compare — INR-denominated normalised performance, risk metrics, correlation and rolling returns. */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Info, Plus, X } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { axisProps, ChartTooltip, HeatMatrix, Legend } from "@/components/charts";
import { InstrumentPicker } from "@/components/InstrumentPicker";
import {
  Badge,
  Card,
  Delta,
  EmptyState,
  ErrorState,
  Notice,
  PageHeader,
  Skeleton,
  SourceBadge,
  Spinner,
  Tabs,
} from "@/components/ui";
import { api, qs } from "@/lib/api";
import { date, monthYear, num, pct, priceFmt, shortDate } from "@/lib/format";
import { useChartColors } from "@/lib/theme";
import type { CompareResp, InstrumentRef } from "@/lib/types";

type Period = "1M" | "3M" | "6M" | "1Y" | "3Y" | "5Y";
const PERIODS: Period[] = ["1M", "3M", "6M", "1Y", "3Y", "5Y"];
const PRESETS: { label: string; symbols: string[] }[] = [
  { label: "NIFTY 50 vs Gold vs Silver", symbols: ["NIFTY50", "GOLD", "SILVER"] },
  { label: "Banks vs IT", symbols: ["BANKNIFTY", "NIFTYIT", "NIFTY50"] },
  { label: "Gold ETF vs Gold reference", symbols: ["GOLDBEES", "GOLD"] },
  { label: "SENSEX vs NIFTY 50", symbols: ["SENSEX", "NIFTY50"] },
];
const MAX = 6;

/** First trading date of every `step`-th calendar month — avoids duplicate month labels. */
function monthTicks(points: { date: string }[], step: number): string[] {
  const out: string[] = [];
  let last = "";
  points.forEach((p, i) => {
    const ym = p.date.slice(0, 7);
    if (ym === last) return;
    last = ym;
    const m = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
    if (i > 0 && m % step === 0) out.push(p.date);
  });
  return out;
}

function shortName(n: string) {
  return n.replace(/ reference \(.*\)$/, "").replace(/ (Ltd|Limited)\.?$/i, "").replace(/^S&P BSE /, "");
}

export default function Compare() {
  const c = useChartColors();
  const [sp, setSp] = useSearchParams();
  const universe = useQuery({ queryKey: ["universe"], queryFn: () => api.get<InstrumentRef[]>("/api/market/universe"), staleTime: 300_000 });
  const bySymbol = useMemo(() => new Map((universe.data ?? []).map((u) => [u.symbol, u])), [universe.data]);

  const ids = useMemo(
    () =>
      (sp.get("ids") || "")
        .split(",")
        .map((x) => parseInt(x, 10))
        .filter((x) => Number.isFinite(x) && x > 0)
        .filter((x, i, a) => a.indexOf(x) === i)
        .slice(0, MAX),
    [sp],
  );
  const period = (PERIODS.includes(sp.get("period") as Period) ? sp.get("period") : "1Y") as Period;

  const update = (next: { ids?: number[]; period?: Period }) => {
    const p = new URLSearchParams(sp);
    if (next.ids) p.set("ids", next.ids.join(","));
    if (next.period) p.set("period", next.period);
    setSp(p, { replace: true });
  };

  // default selection once the universe is known
  useEffect(() => {
    if (!sp.get("ids") && universe.data) {
      const def = ["NIFTY50", "GOLD", "SILVER"].map((s) => bySymbol.get(s)?.id).filter(Boolean) as number[];
      if (def.length) update({ ids: def });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [universe.data]);

  const cmp = useQuery({
    queryKey: ["compare", ids.join(","), period],
    queryFn: () => api.get<CompareResp>(`/api/market/compare${qs({ ids: ids.join(","), period })}`),
    enabled: ids.length > 0,
    placeholderData: keepPreviousData,
  });

  const data = cmp.data;
  // color follows selection order (entity), never rank
  const colorOf = (id: number) => c.series[Math.max(0, ids.indexOf(id)) % 8];
  const series = useMemo(() => {
    if (!data) return [];
    return [...data.series].sort((a, b) => ids.indexOf(a.instrument.id) - ids.indexOf(b.instrument.id));
  }, [data, ids]);
  const nameById = useMemo(() => new Map(series.map((s) => [s.instrument.id, s.instrument.name])), [series]);
  const lastIdx = (data?.points.length ?? 0) - 1;
  const directLabels = series.length <= 4;
  const tickFmt = (d: string) => (["1M", "3M", "6M"].includes(period) ? shortDate(d) : monthYear(d));
  const ticks = useMemo(() => {
    if (!data || ["1M", "3M", "6M"].includes(period)) return undefined;
    return monthTicks(data.points as { date: string }[], period === "1Y" ? 2 : period === "3Y" ? 6 : 12);
  }, [data, period]);
  // nudge direct end-labels apart so they never overlap (pixel offsets, approx. plot height 300px)
  const labelOffset = useMemo(() => {
    const out: Record<number, number> = {};
    if (!data?.points.length) return out;
    const last = data.points[data.points.length - 1];
    let lo = Infinity;
    let hi = -Infinity;
    data.points.forEach((p) =>
      series.forEach((s) => {
        const v = p[String(s.instrument.id)];
        if (typeof v === "number") {
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
      }),
    );
    const unit = (hi - lo) / 300 || 1;
    const gap = 15 * unit;
    const ends = series
      .map((s) => ({ id: s.instrument.id, v: Number(last[String(s.instrument.id)]) }))
      .filter((x) => Number.isFinite(x.v))
      .sort((a, b) => b.v - a.v);
    let prev = Infinity;
    ends.forEach((x) => {
      const y = Math.min(x.v, prev - gap);
      out[x.id] = (x.v - y) / unit;
      prev = y;
    });
    return out;
  }, [data, series]);

  const add = (i: InstrumentRef) => {
    if (ids.includes(i.id) || ids.length >= MAX) return;
    update({ ids: [...ids, i.id] });
  };
  const remove = (id: number) => update({ ids: ids.filter((x) => x !== id) });
  const preset = (symbols: string[]) => {
    const next = symbols.map((s) => bySymbol.get(s)?.id).filter(Boolean) as number[];
    if (next.length) update({ ids: next });
  };

  const corr = data?.correlation;
  const corrNames = corr?.ids.map((id) => shortName(nameById.get(id) ?? String(id))) ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Markets"
        title="Compare"
        subtitle="Indian indices, stocks, ETFs, gold and silver side by side in rupees — normalised to 100 at the start of the period, with risk and drawdown alongside returns."
      />

      <Card pad={false}>
        <div className="space-y-3 p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            {ids.map((id) => {
              const u = (universe.data ?? []).find((x) => x.id === id);
              const name = nameById.get(id) ?? u?.name ?? `#${id}`;
              return (
                <span key={id} className="inline-flex max-w-full items-center gap-2 rounded-full border border-line bg-surface2/60 py-1 pl-2.5 pr-1 text-sm">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorOf(id) }} />
                  <span className="truncate text-ink">{shortName(name)}</span>
                  <button className="rounded-full p-0.5 text-faint hover:bg-surface hover:text-ink" onClick={() => remove(id)} aria-label={`Remove ${name}`}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
              );
            })}
            {ids.length === 0 && <span className="text-sm text-muted">Pick up to {MAX} instruments to compare.</span>}
          </div>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="w-full lg:max-w-sm">
              {ids.length < MAX ? (
                <InstrumentPicker universe exclude={ids} onSelect={add} placeholder="Add an index, stock, ETF, gold…" />
              ) : (
                <div className="flex items-center gap-2 text-xs text-faint">
                  <Plus className="h-3.5 w-3.5" /> Maximum of {MAX} instruments — remove one to add another.
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button key={p.label} className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => preset(p.symbols)} disabled={!universe.data}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <Card
        title="Normalised performance"
        subtitle="Each series rebased to 100 on the first common date"
        actions={
          <div className="flex items-center gap-2">
            {cmp.isFetching && <Spinner className="h-4 w-4" />}
            <Tabs size="sm" value={period} onChange={(v) => update({ period: v })} items={PERIODS.map((p) => ({ value: p, label: p }))} />
          </div>
        }
      >
        {ids.length === 0 ? (
          <EmptyState title="Nothing selected">Add instruments above or choose a preset.</EmptyState>
        ) : cmp.isLoading ? (
          <Skeleton className="h-[340px] w-full" />
        ) : cmp.error ? (
          <ErrorState error={cmp.error} onRetry={() => cmp.refetch()} />
        ) : data ? (
          <>
            <div className="mb-3">
              <Legend items={series.map((s) => ({ label: s.instrument.name, color: colorOf(s.instrument.id) }))} />
            </div>
            <div className="h-[340px] w-full">
              <ResponsiveContainer>
                <LineChart data={data.points} margin={{ top: 8, right: directLabels ? 78 : 12, bottom: 0, left: -8 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="date" {...axisProps} tickFormatter={tickFmt} ticks={ticks} />
                  <YAxis {...axisProps} domain={["auto", "auto"]} tickFormatter={(v: number) => v.toFixed(0)} width={44} />
                  <ReferenceLine y={100} stroke={c.axis} strokeDasharray="3 3" />
                  <Tooltip
                    content={
                      <ChartTooltip
                        labelFormatter={(l) => date(l)}
                        valueFormatter={(v) => (
                          <>
                            {num(v, 1)} <span className="font-normal text-faint">({pct(v - 100, 1, true)})</span>
                          </>
                        )}
                      />
                    }
                  />
                  {series.map((s) => (
                    <Line
                      key={s.instrument.id}
                      type="monotone"
                      dataKey={String(s.instrument.id)}
                      name={s.instrument.name}
                      stroke={colorOf(s.instrument.id)}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, strokeWidth: 2, stroke: c.surface }}
                      isAnimationActive={false}
                      connectNulls
                      label={
                        directLabels
                          ? (props: { x?: number; y?: number; index?: number; value?: number }) =>
                              props.index === lastIdx && props.value !== undefined ? (
                                <text x={(props.x ?? 0) + 6} y={(props.y ?? 0) + 4 + (labelOffset[s.instrument.id] ?? 0)} fontSize={11} fill={colorOf(s.instrument.id)} fontWeight={600}>
                                  {pct((props.value ?? 100) - 100, 1, true)}
                                </text>
                              ) : (
                                <g />
                              )
                          : undefined
                      }
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        ) : null}
      </Card>

      {data && series.length > 0 && (
        <Card title="Returns & risk" subtitle={`${date(series[0].metrics.start)} → ${date(series[0].metrics.end)} · all values in INR`} pad>
          <div className="-mx-4 overflow-x-auto sm:-mx-5">
            <table className="table-base min-w-[980px]">
              <thead>
                <tr>
                  <th>Instrument</th>
                  <th className="!text-right">Last</th>
                  <th className="!text-right">Total return</th>
                  <th className="!text-right">CAGR</th>
                  <th className="!text-right">Volatility (ann.)</th>
                  <th>Max drawdown</th>
                  <th className="!text-right">Best / worst day</th>
                  <th>Data</th>
                </tr>
              </thead>
              <tbody>
                {series.map((s) => {
                  const m = s.metrics;
                  return (
                    <tr key={s.instrument.id}>
                      <td>
                        <div className="flex items-center gap-2.5">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorOf(s.instrument.id) }} />
                          <div className="min-w-0">
                            <div className="font-medium text-ink">{s.instrument.name}</div>
                            <div className="text-xs text-faint">{s.instrument.symbol} · {s.instrument.unit}</div>
                          </div>
                        </div>
                      </td>
                      <td className="text-right">
                        <div className="tnum font-medium">{priceFmt(s.quote?.price ?? m.end_price, s.instrument.unit)}</div>
                        {s.quote && <Delta value={s.quote.change_pct} className="text-xs" />}
                      </td>
                      <td className="text-right"><Delta value={m.total_return_pct} /></td>
                      <td className="text-right tnum">{m.cagr_pct === null ? <span className="text-faint" title="Shown for periods of a year or more">—</span> : pct(m.cagr_pct, 1, true)}</td>
                      <td className="text-right tnum">{pct(m.ann_vol_pct, 1)}</td>
                      <td>
                        <div className="tnum text-neg">{pct(m.max_drawdown_pct, 1)}</div>
                        {m.drawdown_peak && <div className="text-xs text-faint">{date(m.drawdown_peak)} → {date(m.drawdown_trough)}</div>}
                      </td>
                      <td className="text-right tnum text-xs">
                        <span className="text-pos">{pct(m.best_day_pct, 2, true)}</span> / <span className="text-neg">{pct(m.worst_day_pct, 2, true)}</span>
                      </td>
                      <td className="max-w-[220px]">
                        {s.synthetic && <Badge tone="warn">Synthetic</Badge>}
                        <div className="truncate text-xs text-faint" title={s.source ?? ""}>{s.source}</div>
                        <div className="text-xs text-faint">{m.n_obs} observations</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {series[0].quote && (
            <SourceBadge className="mt-3" asOf={series[0].quote.as_of} delay={series[0].quote.delay_note} />
          )}
        </Card>
      )}

      {data && series.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-5 [&>*]:min-w-0">
          <Card className="lg:col-span-3" title="Rolling 1-month return" subtitle="Return over the trailing 21 sessions at each date">
            <div className="h-[260px] w-full">
              <ResponsiveContainer>
                <LineChart data={data.points} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="date" {...axisProps} tickFormatter={tickFmt} ticks={ticks} />
                  <YAxis {...axisProps} tickFormatter={(v: number) => `${v.toFixed(0)}%`} width={44} />
                  <ReferenceLine y={0} stroke={c.axis} />
                  <Tooltip content={<ChartTooltip labelFormatter={(l) => date(l)} valueFormatter={(v) => pct(v, 2, true)} />} />
                  {series.map((s) => (
                    <Line
                      key={s.instrument.id}
                      type="monotone"
                      dataKey={`r${s.instrument.id}`}
                      name={s.instrument.name}
                      stroke={colorOf(s.instrument.id)}
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            {period === "1M" && <p className="mt-2 text-xs text-faint">A 1-month window needs more history than the selected period — pick 3M or longer.</p>}
          </Card>
          <Card className="lg:col-span-2" title="Correlation of daily returns" subtitle="+1 move together · 0 unrelated · −1 move opposite">
            {corr && corr.ids.length >= 2 ? (
              <>
                <HeatMatrix rows={corrNames} cols={corrNames} values={corr.matrix} max={1} diverging format={(v) => v.toFixed(2)} />
                <p className="mt-3 text-xs leading-relaxed text-faint">
                  Blue = moved together, red = moved in opposite directions, grey ≈ unrelated. Low correlation is what makes an asset diversify a portfolio — historically, not guaranteed.
                </p>
              </>
            ) : (
              <EmptyState title="Add a second instrument">Correlation needs at least two series.</EmptyState>
            )}
          </Card>
        </div>
      )}

      {data && (data.warnings.length > 0 || data.notes.length > 0) && (
        <div className="grid gap-3 md:grid-cols-2">
          {data.warnings.length > 0 && (
            <Notice tone="warn" title="Alignment notes">
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {data.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </Notice>
          )}
          <Notice tone="info" icon={<Info className="h-4 w-4" />} title="Reading this comparison">
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {data.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
              <li>
                Gold and silver references are COMEX prices converted at USD/INR — Indian retail and MCX prices also include import duty and GST, so levels differ even when trends match. Gold ETFs track the domestic price.
              </li>
            </ul>
          </Notice>
        </div>
      )}
    </div>
  );
}
