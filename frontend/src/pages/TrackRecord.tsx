/* Track Record — every forecast FinLex has issued, scored against what actually happened. Misses included. */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ChevronLeft, ChevronRight, Clock, Link2, ShieldAlert, ShieldCheck } from "lucide-react";
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { RangeBar } from "@/components/analysis/RangeBar";
import { axisProps } from "@/components/charts";
import {
  Badge,
  Card,
  Delta,
  EmptyState,
  ErrorState,
  Field,
  Notice,
  PageHeader,
  ScoreBar,
  Select,
  Skeleton,
  Spinner,
  Stat,
  Tabs,
} from "@/components/ui";
import { api, qs } from "@/lib/api";
import { date, dateTime, monthYear, num, pct } from "@/lib/format";
import { useChartColors } from "@/lib/theme";
import type { AggStats, InstrumentRef, TrackRecordRow, TrackReport } from "@/lib/types";

type Origin = "live" | "backtest" | "all";
const ORIGIN_COPY: Record<Origin, { title: string; body: string }> = {
  live: {
    title: "Live forecasts",
    body: "Published in real time — logged the moment FinLex showed them, before the outcome was known. This is the record that matters most.",
  },
  backtest: {
    title: "Backtest replay",
    body: "Point-in-time walk-forward replay: each forecast uses only data available on its cutoff date, but these were generated after the fact, not published at the time. Useful for sample size; weigh live results more.",
  },
  all: { title: "All records", body: "Live and backtest records together. Filter by origin for a clean read." },
};
const MODELS = [
  { value: "", label: "All models" },
  { value: "ridge", label: "Ridge regression" },
  { value: "xgboost", label: "XGBoost" },
  { value: "drift", label: "Historical drift" },
  { value: "naive", label: "Naïve" },
];
const HORIZONS = [
  { value: "", label: "All horizons" },
  { value: "1", label: "1 day" },
  { value: "5", label: "1 week" },
  { value: "21", label: "1 month" },
];
const OUTCOMES = [
  { value: "", label: "All outcomes" },
  { value: "hit", label: "Hits (inside 80%)" },
  { value: "miss", label: "Misses" },
  { value: "pending", label: "Pending" },
];
const HLABEL: Record<number, string> = { 1: "1 day", 5: "1 week", 21: "1 month" };

function calibrationVerdict(cov: number | undefined, n: number): { tone: "pos" | "warn" | "neg"; text: string } {
  if (cov === undefined || !n) return { tone: "warn", text: "Not enough scored forecasts yet" };
  const d = cov - 0.8;
  const small = n < 30 ? " (small sample — treat with caution)" : "";
  if (Math.abs(d) <= 0.05) return { tone: "pos", text: `Well calibrated: within ±5 pp of the stated 80%${small}` };
  if (d < 0) return { tone: "neg", text: `Overconfident: ranges were too narrow by ${Math.abs(d * 100).toFixed(0)} pp${small}` };
  return { tone: "warn", text: `Conservative: ranges were wider than needed by ${(d * 100).toFixed(0)} pp${small}` };
}

function SegmentTable({ rows }: { rows: (AggStats & { label: string })[] }) {
  if (!rows.length) return <p className="text-sm text-muted">No scored records in this view yet.</p>;
  return (
    <div className="-mx-4 overflow-x-auto sm:-mx-5">
      <table className="table-base min-w-[760px]">
        <thead>
          <tr>
            <th>Segment</th>
            <th className="!text-right">Scored</th>
            <th className="w-48">80% hit rate</th>
            <th className="!text-right">50% hit rate</th>
            <th className="!text-right">MAE</th>
            <th className="!text-right">Naïve MAE</th>
            <th className="!text-right">Skill</th>
            <th className="!text-right">Direction</th>
            <th className="!text-right">Avg 80% width</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="font-medium text-ink">{r.label}</td>
              <td className="text-right tnum">{r.n}</td>
              <td>
                <div className="flex items-center gap-2">
                  <ScoreBar value={(r.coverage80 ?? 0) * 100} tone={Math.abs((r.coverage80 ?? 0) - 0.8) <= 0.05 ? "pos" : "warn"} className="flex-1" />
                  <span className="w-10 text-right text-xs font-semibold tnum">{pct((r.coverage80 ?? 0) * 100, 0)}</span>
                </div>
              </td>
              <td className="text-right tnum">{pct((r.coverage50 ?? 0) * 100, 0)}</td>
              <td className="text-right tnum">{num(r.mae)} pp</td>
              <td className="text-right tnum text-muted">{num(r.naive_mae)} pp</td>
              <td className="text-right">{r.skill_vs_naive === null || r.skill_vs_naive === undefined ? "—" : <Delta value={r.skill_vs_naive * 100} digits={1} arrow={false} />}</td>
              <td className="text-right tnum">{r.directional_accuracy === null || r.directional_accuracy === undefined ? "—" : pct(r.directional_accuracy * 100, 0)}</td>
              <td className="text-right tnum">{num(r.mean_width80, 1)} pp</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OutcomeBadge({ r }: { r: TrackRecordRow }) {
  if (!r.outcome) return <Badge tone="neutral" icon={<Clock className="h-3 w-3" />}>Pending</Badge>;
  return r.outcome.inside80 ? <Badge tone="pos">Hit</Badge> : <Badge tone="neg">Miss</Badge>;
}

export default function TrackRecord() {
  const c = useChartColors();
  const [sp, setSp] = useSearchParams();
  const origin = (["live", "backtest", "all"].includes(sp.get("origin") || "") ? sp.get("origin") : "live") as Origin;
  const instrumentId = sp.get("instrument") || "";
  const model = sp.get("model") || "";
  const horizon = sp.get("horizon") || "";
  const outcome = sp.get("outcome") || "";
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const seg = sp.get("seg") || "instrument";

  function set(next: Record<string, string>, resetPage = true) {
    const p = new URLSearchParams(sp);
    Object.entries(next).forEach(([k, v]) => (v ? p.set(k, v) : p.delete(k)));
    if (resetPage && !("page" in next)) p.delete("page");
    setSp(p, { replace: true });
  }

  const universe = useQuery({ queryKey: ["universe"], queryFn: () => api.get<InstrumentRef[]>("/api/market/universe"), staleTime: 300_000 });
  const q = useQuery({
    queryKey: ["track-record", origin, instrumentId, model, horizon, outcome, page],
    queryFn: () =>
      api.get<TrackReport>(`/api/track-record${qs({ origin, instrument_id: instrumentId, model, horizon, outcome, page, page_size: 25 })}`),
    placeholderData: keepPreviousData,
  });
  const d = q.data;
  const s = d?.summary;
  const pendingOnly = !!s && s.n === 0 && s.pending > 0;
  const pendingQ = useQuery({
    queryKey: ["track-record-pending", origin, instrumentId, model, horizon],
    queryFn: () => api.get<TrackReport>(`/api/track-record${qs({ origin, instrument_id: instrumentId, model, horizon, outcome: "pending", page_size: 200 })}`),
    enabled: pendingOnly,
  });
  const firstMaturity = useMemo(() => {
    const rows = pendingQ.data?.records ?? [];
    return rows.length ? rows.map((r) => r.target_date).sort()[0] : null;
  }, [pendingQ.data]);

  const cal = calibrationVerdict(s?.coverage80, s?.n ?? 0);
  const totalPages = d ? Math.max(1, Math.ceil(d.total / d.page_size)) : 1;
  const calData = (d?.calibration ?? []).filter((x) => x.observed !== null).map((x) => ({ nominal: x.nominal * 100, observed: (x.observed as number) * 100 }));
  const covData = (d?.coverage_over_time ?? []).map((x) => ({ ...x, pct: x.coverage80 * 100 }));

  const header = (
    <PageHeader
      eyebrow="Markets"
      title="Track Record"
      subtitle="Every forecast FinLex has published, scored against what actually happened — misses included. Records are append-only and hash-chained, so nothing can be quietly edited or deleted."
      actions={
        d?.chain ? (
          d.chain.ok ? (
            <Badge tone="pos" icon={<ShieldCheck className="h-3.5 w-3.5" />} className="!px-2.5 !py-1 !text-xs">
              Chain verified · {d.chain.checked.toLocaleString("en-IN")} records{d.chain.head ? ` · ${d.chain.head.slice(0, 10)}…` : ""}
            </Badge>
          ) : (
            <Badge tone="neg" icon={<ShieldAlert className="h-3.5 w-3.5" />} className="!px-2.5 !py-1 !text-xs">Chain broken at #{d.chain.broken_at}</Badge>
          )
        ) : undefined
      }
    />
  );

  return (
    <div className="space-y-4">
      {header}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <Tabs
          value={origin}
          onChange={(v) => set({ origin: v })}
          items={[
            { value: "live", label: "Live forecasts" },
            { value: "backtest", label: "Backtest replay" },
            { value: "all", label: "All" },
          ]}
        />
        <p className="max-w-2xl text-sm text-muted lg:text-right">
          <span className="font-semibold text-ink">{ORIGIN_COPY[origin].title}:</span> {ORIGIN_COPY[origin].body}
        </p>
      </div>

      {d && !d.chain.ok && (
        <Notice tone="neg" title="Integrity check failed">
          The hash chain does not verify at record #{d.chain.broken_at}. A stored forecast may have been altered outside the app. Please report this.
        </Notice>
      )}

      {q.error ? (
        <Card>
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        </Card>
      ) : !d || !s ? (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <div className="grid gap-4 lg:grid-cols-3">
            <Skeleton className="h-64" />
            <Skeleton className="h-64 lg:col-span-2" />
          </div>
        </div>
      ) : (
        <>
          {pendingOnly && (
            <Card>
              <EmptyState
                icon={<Clock className="h-5 w-5" />}
                title="No live forecasts have matured yet"
                action={
                  <button className="btn-ghost" onClick={() => set({ origin: "backtest" })}>
                    See the backtest replay meanwhile
                  </button>
                }
              >
                {s.pending} forecast{s.pending === 1 ? " is" : "s are"} logged and waiting for their horizon to pass.
                {firstMaturity ? ` The first one matures on ${date(firstMaturity)} and will be scored automatically — hit or miss.` : " They will be scored automatically — hit or miss."}
              </EmptyState>
            </Card>
          )}

          {s.n > 0 && (
            <div className="card grid grid-cols-2 gap-x-5 gap-y-5 p-4 sm:p-5 md:grid-cols-3 xl:grid-cols-6">
              <Stat label="Scored forecasts" value={s.n.toLocaleString("en-IN")} sub={`${s.pending} pending · ${s.total} total`} />
              <div className="col-span-2 md:col-span-1 xl:col-span-2">
                <Stat
                  label="80% range hit rate"
                  value={
                    <span className="flex items-baseline gap-2">
                      {pct((s.coverage80 ?? 0) * 100, 1)}
                      <span className="text-xs font-medium text-faint">target 80%</span>
                    </span>
                  }
                  hint="Share of forecasts whose realised return landed inside the stated 80% range"
                />
                <div className="relative mt-2">
                  <ScoreBar value={(s.coverage80 ?? 0) * 100} tone={cal.tone} />
                  <div className="absolute -top-1 h-3.5 w-[2px] bg-ink/70" style={{ left: "80%" }} title="Nominal 80%" />
                </div>
                <div className={clsx("mt-1.5 text-xs", cal.tone === "pos" ? "text-pos" : cal.tone === "neg" ? "text-neg" : "text-warn")}>{cal.text}</div>
              </div>
              <Stat label="50% range hit rate" value={pct((s.coverage50 ?? 0) * 100, 1)} sub="target 50%" />
              <Stat
                label="Avg error (MAE)"
                value={`${num(s.mae)} pp`}
                sub={
                  <span>
                    naïve {num(s.naive_mae)} pp · skill{" "}
                    {s.skill_vs_naive === null || s.skill_vs_naive === undefined ? "—" : <Delta value={s.skill_vs_naive * 100} digits={1} arrow={false} />}
                  </span>
                }
                hint="Mean absolute error of the central estimate vs simply predicting no change"
              />
              <Stat
                label="Direction right"
                value={s.directional_accuracy === null || s.directional_accuracy === undefined ? "—" : pct(s.directional_accuracy * 100, 1)}
                sub={`of ${s.n_direction ?? 0} non-zero calls · coin flip = 50%`}
              />
            </div>
          )}

          {s.n > 0 && (
            <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
              <Card title="Calibration" subtitle="Stated vs observed coverage — on the line = honest ranges">
                <div className="h-[230px] w-full">
                  <ResponsiveContainer>
                    <ScatterChart margin={{ top: 10, right: 16, bottom: 18, left: -6 }}>
                      <CartesianGrid />
                      <XAxis type="number" dataKey="nominal" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} {...axisProps} tickFormatter={(v: number) => `${v}%`} label={{ value: "Stated", position: "insideBottom", offset: -10, fontSize: 11, fill: c.axis }} />
                      <YAxis type="number" dataKey="observed" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} {...axisProps} tickFormatter={(v: number) => `${v}%`} width={44} />
                      <ZAxis range={[90, 90]} />
                      <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 100, y: 100 }]} stroke={c.axis} strokeDasharray="4 4" ifOverflow="extendDomain" />
                      <Tooltip
                        cursor={false}
                        content={({ active, payload }) =>
                          active && payload?.length ? (
                            <div className="rounded-lg border border-line bg-surface/95 px-3 py-2 text-xs shadow-2xl">
                              <div className="font-semibold">{(payload[0].payload as { nominal: number }).nominal}% range</div>
                              <div className="text-muted">Observed {pct((payload[0].payload as { observed: number }).observed, 1)}</div>
                            </div>
                          ) : null
                        }
                      />
                      <Scatter data={calData} fill={c.series[0]} stroke={c.surface} strokeWidth={2} isAnimationActive={false} />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-xs text-faint">Points below the line mean ranges were too narrow (overconfident); above means too wide.</p>
              </Card>

              <Card className="lg:col-span-2" title="80% hit rate by target month" subtitle="Dashed line = the 80% the ranges promise">
                <div className="h-[230px] w-full">
                  <ResponsiveContainer>
                    <BarChart data={covData} margin={{ top: 10, right: 12, bottom: 0, left: -6 }}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="month" {...axisProps} tickFormatter={monthYear} />
                      <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} {...axisProps} tickFormatter={(v: number) => `${v}%`} width={44} />
                      <ReferenceLine y={80} stroke={c.ink} strokeDasharray="4 4" />
                      <Tooltip
                        cursor={{ fill: c.surface2 }}
                        content={({ active, payload, label }) =>
                          active && payload?.length ? (
                            <div className="rounded-lg border border-line bg-surface/95 px-3 py-2 text-xs shadow-2xl">
                              <div className="font-semibold">{monthYear(String(label))}</div>
                              <div className="text-muted">
                                Hit rate {pct((payload[0].payload as { pct: number }).pct, 0)} · {(payload[0].payload as { n: number }).n} forecasts
                              </div>
                            </div>
                          ) : null
                        }
                      />
                      <Bar dataKey="pct" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false}>
                        {covData.map((r, i) => (
                          <Cell key={i} fill={r.n < 5 ? c.line : c.series[0]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-xs text-faint">Months with fewer than 5 scored forecasts are shown greyed — too few to judge.</p>
              </Card>
            </div>
          )}

          {s.n > 0 && (
            <Card
              title="Breakdown"
              subtitle="Where the models do better or worse"
              actions={
                <Tabs
                  size="sm"
                  value={seg}
                  onChange={(v) => set({ seg: v }, false)}
                  items={[
                    { value: "instrument", label: "Instrument" },
                    { value: "model", label: "Model" },
                    { value: "horizon", label: "Horizon" },
                  ]}
                />
              }
            >
              <SegmentTable rows={d.segments[seg as "instrument" | "model" | "horizon"] ?? []} />
            </Card>
          )}

          <Card
            title="Forecast log"
            subtitle={`${d.total.toLocaleString("en-IN")} record${d.total === 1 ? "" : "s"} in this view · newest first`}
            actions={q.isFetching ? <Spinner className="h-4 w-4" /> : undefined}
          >
            <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
              <Field label="Instrument">
                <Select value={instrumentId} onChange={(e) => set({ instrument: e.target.value })}>
                  <option value="">All instruments</option>
                  {(universe.data ?? []).map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Model">
                <Select value={model} onChange={(e) => set({ model: e.target.value })}>
                  {MODELS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Horizon">
                <Select value={horizon} onChange={(e) => set({ horizon: e.target.value })}>
                  {HORIZONS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Outcome">
                <Select value={outcome} onChange={(e) => set({ outcome: e.target.value })}>
                  {OUTCOMES.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </Select>
              </Field>
            </div>

            {d.records.length === 0 ? (
              <EmptyState title="No records match these filters">Try clearing a filter or switching origin.</EmptyState>
            ) : (
              <div className="-mx-4 overflow-x-auto sm:-mx-5">
                <table className="table-base min-w-[940px]">
                  <thead>
                    <tr>
                      <th>Cutoff → target</th>
                      <th>Instrument</th>
                      <th>Model</th>
                      <th>Horizon</th>
                      <th className="!text-right">Forecast</th>
                      <th className="w-36">Range vs outcome</th>
                      <th className="!text-right">Realised · error</th>
                      <th>Outcome</th>
                      <th>Record</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.records.map((r) => (
                      <tr key={r.id} className={clsx(r.outcome && !r.outcome.inside80 && "bg-neg/[0.04]")}>
                        <td className="whitespace-nowrap">
                          <div className="text-ink">{date(r.cutoff_date)} → {date(r.target_date)}</div>
                          <div className="text-[11px] text-faint">
                            {r.origin === "live" ? `Logged ${dateTime(r.created_at)}` : "Backtest replay"}
                          </div>
                        </td>
                        <td className="max-w-[160px]">
                          <div className="truncate font-medium text-ink" title={r.instrument.name}>{r.instrument.name}</div>
                          <div className="text-[11px] text-faint">{r.instrument.symbol}</div>
                        </td>
                        <td className="whitespace-nowrap text-muted">{r.model_name}</td>
                        <td className="whitespace-nowrap text-muted">{HLABEL[r.horizon_days] ?? `${r.horizon_days}d`}</td>
                        <td className="whitespace-nowrap text-right">
                          <div className="tnum font-medium">{pct(r.point_return, 2, true)}</div>
                          <div className="text-[11px] text-faint tnum">{pct(r.interval80[0], 1, true)} … {pct(r.interval80[1], 1, true)}</div>
                        </td>
                        <td>
                          <RangeBar lo80={r.interval80[0]} hi80={r.interval80[1]} lo50={r.interval50[0]} hi50={r.interval50[1]} point={r.point_return} actual={r.outcome?.realised_return ?? null} />
                        </td>
                        <td className="whitespace-nowrap text-right">
                          {r.outcome ? (
                            <>
                              <Delta value={r.outcome.realised_return} arrow={false} />
                              <div className="text-[11px] text-faint tnum">
                                {r.outcome.error > 0 ? "+" : ""}
                                {num(r.outcome.error)} pp · {date(r.outcome.observed_date)}
                              </div>
                            </>
                          ) : (
                            <span className="text-faint">after {date(r.target_date)}</span>
                          )}
                        </td>
                        <td>
                          <OutcomeBadge r={r} />
                          {r.outcome?.note && <div className="mt-0.5 max-w-[160px] text-[11px] text-faint">{r.outcome.note}</div>}
                        </td>
                        <td>
                          <code className="block cursor-help text-[11px] leading-tight text-faint" title={`#${r.id} · ${r.model_version} · data ${r.data_version}\n${r.record_hash}`}>
                            #{r.id}
                            <br />
                            {r.record_hash.slice(0, 7)}
                          </code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between gap-3 text-sm">
                <span className="text-muted">Page {d.page} of {totalPages}</span>
                <div className="flex gap-2">
                  <button className="btn-ghost !px-2.5 !py-1.5" disabled={page <= 1} onClick={() => set({ page: String(page - 1) }, false)} aria-label="Previous page">
                    <ChevronLeft className="h-4 w-4" /> Prev
                  </button>
                  <button className="btn-ghost !px-2.5 !py-1.5" disabled={page >= totalPages} onClick={() => set({ page: String(page + 1) }, false)} aria-label="Next page">
                    Next <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </Card>

          <Card title="About this record">
            <ul className="space-y-1.5 text-sm text-muted">
              {d.notes.map((n, i) => (
                <li key={i} className="flex gap-2">
                  <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" /> {n}
                </li>
              ))}
              <li className="flex gap-2">
                <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" /> Realised returns use split/dividend-adjusted closes at the cutoff and target dates (or the next trading day).
              </li>
            </ul>
            <div className="mt-4">
              <Link to="/app/forecast" className="btn-ghost !py-1.5 text-sm">Open the forecaster</Link>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
