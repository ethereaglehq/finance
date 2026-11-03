/* Forecast — calibrated return ranges, honest baseline comparison, walk-forward evaluation and synthetic what-if scenarios. */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { BadgeCheck, CircleSlash, FlaskConical, History, Receipt, Scale, Sigma, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import { RangeBar } from "@/components/analysis/RangeBar";
import { ControlGroup, Segmented } from "@/components/analysis/Segmented";
import { axisProps, Legend } from "@/components/charts";
import {
  Badge,
  Card,
  Delta,
  Disclaimer,
  ErrorState,
  Field,
  KeyValue,
  Notice,
  PageHeader,
  ScoreBar,
  Select,
  Skeleton,
  SourceBadge,
  Spinner,
  type Tone,
} from "@/components/ui";
import { api, qs } from "@/lib/api";
import { date, dateTime, num, pct, priceFmt, shortDate } from "@/lib/format";
import { useChartColors } from "@/lib/theme";
import type { Evaluation, ForecastResp, InstrumentRef, ModelCard, ModelMetrics } from "@/lib/types";

const HORIZONS = [
  { value: 1, label: "1 day" },
  { value: 5, label: "1 week" },
  { value: 21, label: "1 month" },
];
const MODEL_ORDER = ["ridge", "xgboost", "drift", "naive", "chronos"];
const EVAL_ORDER = ["naive", "drift", "ridge", "xgboost"];
const GROUPS: { label: string; classes: string[] }[] = [
  { label: "Indices", classes: ["index"] },
  { label: "Gold & silver", classes: ["gold", "silver"] },
  { label: "ETFs", classes: ["etf"] },
  { label: "Stocks", classes: ["equity"] },
];

interface ModelsResp {
  models: ModelCard[];
  horizons: { days: number; label: string }[];
  code_version: string;
  protocol: { refit_every: number; test_sessions: number; min_train: number; calibration_fraction: number; features: Record<string, string>; steps: string[] };
}

interface ScenarioResp {
  instrument: { id: number; symbol: string; name: string };
  engine: "vae" | "bootstrap";
  n_paths: number;
  window_sessions: number;
  base_price: number;
  shock_pct: number;
  fan: { day: number; p5: number; p25: number; p50: number; p75: number; p95: number }[];
  sample_paths: number[][];
  evaluation: {
    generated: Record<string, number>;
    held_out_real: Record<string, number>;
    ks_21d_return: number;
    ks_daily_return: number;
    train_period: [string, string];
    test_period: [string, string];
  };
  meta: { architecture?: string; train_windows?: number; final_loss?: number; loss_curve?: number[]; block_size?: number };
  label: string;
}

/* ------------------------------------------------------------------ helpers */
function verdict(m: ModelMetrics | undefined, model: string, naive: ModelMetrics | undefined): { tone: Tone; title: string; body: ReactNode; icon: ReactNode } {
  if (!m || !naive) return { tone: "info", title: "Evaluation unavailable", body: "Not enough history to run a walk-forward evaluation for this instrument.", icon: <Scale className="h-4 w-4" /> };
  const cov = `Its 80% ranges contained the realised return in ${pct(m.coverage80 * 100, 0)} of ${m.n} out-of-sample tests.`;
  if (model === "naive")
    return {
      tone: "info",
      title: "This is the baseline itself",
      body: <>The naïve model always predicts “no change”. It is the benchmark every other model has to beat. {cov}</>,
      icon: <Scale className="h-4 w-4" />,
    };
  const worse = ((m.mae / naive.mae - 1) * 100).toFixed(0);
  const better = ((1 - m.mae / naive.mae) * 100).toFixed(0);
  if (m.beats_naive === "significant")
    return {
      tone: "pos",
      title: "Beat the no-change baseline in walk-forward testing",
      body: <>Average error {num(m.mae)} pp vs {num(naive.mae)} pp for the naïve baseline ({better}% smaller, statistically significant, n = {m.n}). {cov} Past skill can fade.</>,
      icon: <BadgeCheck className="h-4 w-4" />,
    };
  if (m.beats_naive === "marginal")
    return {
      tone: "warn",
      title: "Only marginally better than the no-change baseline",
      body: <>Average error {num(m.mae)} pp vs {num(naive.mae)} pp — {better}% smaller, but not statistically significant (n = {m.n}). Treat the central estimate cautiously. {cov}</>,
      icon: <TriangleAlert className="h-4 w-4" />,
    };
  return {
    tone: "neg",
    title: "Did not beat the no-change baseline",
    body: (
      <>
        In walk-forward testing its average error was {num(m.mae)} pp vs {num(naive.mae)} pp for simply predicting “no change” ({worse}% larger, n = {m.n}). The central estimate adds no demonstrated value — the range is the useful part. {cov}
      </>
    ),
    icon: <CircleSlash className="h-4 w-4" />,
  };
}

function coverageTone(v: number, nominal: number): string {
  return Math.abs(v - nominal) <= 0.05 ? "text-pos" : "text-warn";
}

/* ------------------------------------------------------------------ fan chart */
type FanRow = { date: string; price?: number; p?: number; band80?: [number, number]; band50?: [number, number] };

function FanTooltip({ active, payload, label, unit }: TooltipProps<number, string> & { unit: string }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload as FanRow;
  return (
    <div className="min-w-[180px] rounded-lg border border-line bg-surface/95 px-3 py-2 text-xs shadow-2xl backdrop-blur">
      <div className="mb-1.5 font-semibold text-ink">{date(String(label))}</div>
      {row.price !== undefined && (
        <div className="flex justify-between gap-4"><span className="text-muted">Close</span><span className="font-semibold tnum">{priceFmt(row.price, unit)}</span></div>
      )}
      {row.p !== undefined && row.price === undefined && (
        <>
          <div className="flex justify-between gap-4"><span className="text-muted">Central path</span><span className="font-semibold tnum">{priceFmt(row.p, unit)}</span></div>
          {row.band50 && <div className="flex justify-between gap-4"><span className="text-muted">50% range</span><span className="tnum">{priceFmt(row.band50[0], unit)} – {priceFmt(row.band50[1], unit)}</span></div>}
          {row.band80 && <div className="flex justify-between gap-4"><span className="text-muted">80% range</span><span className="tnum">{priceFmt(row.band80[0], unit)} – {priceFmt(row.band80[1], unit)}</span></div>}
        </>
      )}
    </div>
  );
}

function FanChart({ data, cutoff, unit }: { data: FanRow[]; cutoff: string; unit: string }) {
  const c = useChartColors();
  const domain = useMemo(() => {
    const vals: number[] = [];
    data.forEach((r) => {
      if (r.price !== undefined) vals.push(r.price);
      if (r.band80) vals.push(r.band80[0], r.band80[1]);
    });
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const pad = (hi - lo) * 0.06 || hi * 0.01;
    return [lo - pad, hi + pad] as [number, number];
  }, [data]);
  const fmtAxis = (v: number) => (v >= 100000 ? `${(v / 1000).toFixed(0)}k` : v >= 1000 ? v.toLocaleString("en-IN", { maximumFractionDigits: 0 }) : v.toFixed(v < 10 ? 2 : 0));
  return (
    <>
      <div className="mb-3">
        <Legend
          items={[
            { label: "Closing price", color: c.series[0] },
            { label: "Central path", color: c.ink, dashed: true },
            { label: "50% range", color: `color-mix(in oklab, ${c.accent} 45%, transparent)` },
            { label: "80% range", color: `color-mix(in oklab, ${c.accent} 20%, transparent)` },
          ]}
        />
      </div>
      <div className="h-[320px] w-full">
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} />
            <YAxis {...axisProps} domain={domain} tickFormatter={fmtAxis} width={58} allowDataOverflow />
            <Tooltip content={<FanTooltip unit={unit} />} />
            <Area dataKey="band80" stroke="none" fill={c.accent} fillOpacity={0.16} isAnimationActive={false} connectNulls={false} />
            <Area dataKey="band50" stroke="none" fill={c.accent} fillOpacity={0.3} isAnimationActive={false} connectNulls={false} />
            <Line dataKey="price" stroke={c.series[0]} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
            <Line dataKey="p" stroke={c.ink} strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} connectNulls={false} />
            <ReferenceLine x={cutoff} stroke={c.axis} strokeDasharray="3 3" label={{ value: "Data cutoff", position: "insideTopRight", fontSize: 11, fill: c.muted }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ scenario section */
function Scenarios({ instrumentId, unit }: { instrumentId: number; unit: string }) {
  const c = useChartColors();
  const [engine, setEngine] = useState<"vae" | "bootstrap">("vae");
  const [n, setN] = useState(500);
  const [shockUi, setShockUi] = useState(0);
  const [shock, setShock] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setShock(shockUi), 400);
    return () => clearTimeout(t);
  }, [shockUi]);
  const q = useQuery({
    queryKey: ["scenarios", instrumentId, engine, n, shock],
    queryFn: () => api.get<ScenarioResp>(`/api/market/scenarios${qs({ instrument_id: instrumentId, engine, n, shock })}`),
    placeholderData: keepPreviousData,
    staleTime: 300_000,
  });
  const s = q.data;
  const rows = useMemo(() => {
    if (!s) return [];
    return s.fan.map((f, d) => {
      const r: Record<string, number | [number, number]> = { day: f.day, outer: [f.p5, f.p95], inner: [f.p25, f.p75], p50: f.p50 };
      s.sample_paths.slice(0, 6).forEach((p, k) => {
        r[`s${k}`] = p[d];
      });
      return r;
    });
  }, [s]);
  const ks = (v: number) => (v < 0.1 ? { t: "pos" as Tone, txt: "close match" } : v < 0.2 ? { t: "warn" as Tone, txt: "moderate differences" } : { t: "neg" as Tone, txt: "noticeably different" });
  const statRows: [string, string, (v: number) => string][] = [
    ["Mean 21-session return", "mean_21d_pct", (v) => pct(v, 2, true)],
    ["Daily volatility", "vol_daily_pct", (v) => pct(v, 2)],
    ["Skew (daily)", "skew", (v) => num(v, 2)],
    ["Excess kurtosis (daily)", "kurtosis", (v) => num(v, 2)],
    ["5th percentile, 21 sessions", "p05_21d_pct", (v) => pct(v, 1, true)],
    ["95th percentile, 21 sessions", "p95_21d_pct", (v) => pct(v, 1, true)],
    ["Median max drawdown", "median_max_drawdown_pct", (v) => pct(v, 1)],
  ];
  return (
    <Card
      id="scenarios"
      title={
        <span className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-accent" /> What-if scenarios
        </span>
      }
      subtitle="Synthetic 21-session paths for stress-testing intuition — not predictions or likely outcomes"
      actions={q.isFetching ? <Spinner className="h-4 w-4" /> : <Badge tone="warn">Synthetic</Badge>}
    >
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end">
        <ControlGroup label="Engine">
          <Segmented
            label="Scenario engine"
            value={engine}
            onChange={setEngine}
            items={[
              { value: "vae", label: "Variational autoencoder" },
              { value: "bootstrap", label: "Block bootstrap" },
            ]}
          />
        </ControlGroup>
        <Field label="Paths" className="w-full lg:w-32">
          <Select value={n} onChange={(e) => setN(Number(e.target.value))}>
            {[200, 500, 1000, 2000].map((v) => (
              <option key={v} value={v}>{v.toLocaleString("en-IN")}</option>
            ))}
          </Select>
        </Field>
        <Field label={`Stress shock: ${shockUi > 0 ? "+" : ""}${shockUi}% over the window`} className="w-full lg:max-w-xs">
          <input
            type="range"
            min={-20}
            max={20}
            step={1}
            value={shockUi}
            onChange={(e) => setShockUi(Number(e.target.value))}
            className="h-9 w-full accent-[rgb(var(--accent))]"
            aria-label="Stress shock percentage"
          />
        </Field>
      </div>

      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !s ? (
        <Skeleton className="h-[300px] w-full" />
      ) : (
        <div className="grid gap-5 xl:grid-cols-5 [&>*]:min-w-0">
          <div className="xl:col-span-3">
            <div className="mb-3">
              <Legend
                items={[
                  { label: "Median path", color: c.series[0] },
                  { label: "25–75th percentile", color: `color-mix(in oklab, ${c.series[0]} 40%, transparent)` },
                  { label: "5–95th percentile", color: `color-mix(in oklab, ${c.series[0]} 18%, transparent)` },
                  { label: "Sample paths", color: c.muted },
                ]}
              />
            </div>
            <div className="h-[300px] w-full">
              <ResponsiveContainer>
                <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="day" {...axisProps} tickFormatter={(d: number) => (d === 0 ? "Now" : `+${d}`)} />
                  <YAxis {...axisProps} domain={["auto", "auto"]} width={58} tickFormatter={(v: number) => (v >= 100000 ? `${(v / 1000).toFixed(0)}k` : v.toLocaleString("en-IN", { maximumFractionDigits: v < 10 ? 2 : 0 }))} />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const r = payload[0].payload as { outer: [number, number]; inner: [number, number]; p50: number };
                      return (
                        <div className="min-w-[190px] rounded-lg border border-line bg-surface/95 px-3 py-2 text-xs shadow-2xl">
                          <div className="mb-1 font-semibold">Session +{label}</div>
                          <div className="flex justify-between gap-3"><span className="text-muted">Median</span><span className="tnum">{priceFmt(r.p50, unit)}</span></div>
                          <div className="flex justify-between gap-3"><span className="text-muted">25–75th</span><span className="tnum">{priceFmt(r.inner[0], unit)} – {priceFmt(r.inner[1], unit)}</span></div>
                          <div className="flex justify-between gap-3"><span className="text-muted">5–95th</span><span className="tnum">{priceFmt(r.outer[0], unit)} – {priceFmt(r.outer[1], unit)}</span></div>
                        </div>
                      );
                    }}
                  />
                  <Area dataKey="outer" stroke="none" fill={c.series[0]} fillOpacity={0.14} isAnimationActive={false} />
                  <Area dataKey="inner" stroke="none" fill={c.series[0]} fillOpacity={0.3} isAnimationActive={false} />
                  {s.sample_paths.slice(0, 6).map((_, k) => (
                    <Line key={k} dataKey={`s${k}`} stroke={c.muted} strokeOpacity={0.3} strokeWidth={1} dot={false} isAnimationActive={false} activeDot={false} />
                  ))}
                  <Line dataKey="p50" stroke={c.series[0]} strokeWidth={2} dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-xs text-faint">
              {s.n_paths.toLocaleString("en-IN")} paths from {priceFmt(s.base_price, unit)}
              {s.shock_pct ? ` with a ${pct(s.shock_pct, 0, true)} stress shock spread across the window` : ""}. Training data {date(s.evaluation.train_period[0])} – {date(s.evaluation.train_period[1])}; compared against held-out real windows {date(s.evaluation.test_period[0])} – {date(s.evaluation.test_period[1])}.
            </p>
          </div>
          <div className="space-y-4 xl:col-span-2">
            <div className="-mx-1 overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Statistic</th>
                    <th className="!text-right">Generated</th>
                    <th className="!text-right">Held-out real</th>
                  </tr>
                </thead>
                <tbody>
                  {statRows.map(([label, key, f]) => (
                    <tr key={key}>
                      <td className="text-muted">{label}</td>
                      <td className="text-right tnum">{f(s.evaluation.generated[key])}</td>
                      <td className="text-right tnum">{f(s.evaluation.held_out_real[key])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                ["21-session returns", s.evaluation.ks_21d_return],
                ["Daily returns", s.evaluation.ks_daily_return],
              ].map(([label, v]) => {
                const k = ks(v as number);
                return (
                  <div key={label as string} className="rounded-xl border border-line/60 bg-surface2/30 p-3">
                    <div className="label">KS distance · {label}</div>
                    <div className="mt-1 text-lg font-bold tnum">{(v as number).toFixed(3)}</div>
                    <Badge tone={k.t} className="mt-1">{k.txt}</Badge>
                  </div>
                );
              })}
            </div>
            <p className="text-xs leading-relaxed text-faint">
              KS distance is the largest gap between the generated and real cumulative distributions (0 = identical, 1 = no overlap). Recent markets can behave differently from the training period, so even a good generator can disagree with held-out data.
            </p>
            {s.engine === "vae" && s.meta.architecture && (
              <div className="rounded-xl border border-line/60 bg-surface2/30 p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-ink">VAE training</span>
                  <span className="text-faint">{s.meta.train_windows} windows · final loss {num(s.meta.final_loss ?? 0, 2)}</span>
                </div>
                <div className="mt-1 text-faint">{s.meta.architecture}</div>
                {s.meta.loss_curve && s.meta.loss_curve.length > 2 && (
                  <div className="mt-2 h-14 w-full" aria-label="Training loss curve">
                    <ResponsiveContainer>
                      <LineChart data={s.meta.loss_curve.map((v, i) => ({ i, v }))} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                        <YAxis hide domain={["dataMin", "dataMax"]} />
                        <Line dataKey="v" stroke={c.accent} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            )}
            {s.engine === "bootstrap" && (
              <p className="rounded-xl border border-line/60 bg-surface2/30 p-3 text-xs text-muted">
                Block bootstrap stitches together random {s.meta.block_size}-session blocks of real historical returns — transparent, and it keeps short-term clustering, but it can only replay moves that already happened.
              </p>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ page */
export default function Forecast() {
  const [sp, setSp] = useSearchParams();
  const universe = useQuery({ queryKey: ["universe"], queryFn: () => api.get<InstrumentRef[]>("/api/market/universe"), staleTime: 300_000 });
  const models = useQuery({ queryKey: ["model-cards"], queryFn: () => api.get<ModelsResp>("/api/market/models"), staleTime: 600_000 });

  const instParam = sp.get("instrument");
  const instrument = useMemo(() => {
    const u = universe.data ?? [];
    if (!u.length) return undefined;
    return (
      u.find((x) => String(x.id) === instParam) ||
      u.find((x) => x.symbol === (instParam || "").toUpperCase()) ||
      u.find((x) => x.symbol === "NIFTY50") ||
      u[0]
    );
  }, [universe.data, instParam]);
  const horizon = [1, 5, 21].includes(Number(sp.get("h"))) ? Number(sp.get("h")) : 21;
  const model = MODEL_ORDER.includes(sp.get("model") || "") && sp.get("model") !== "chronos" ? (sp.get("model") as string) : "ridge";
  const set = (k: string, v: string | number) => {
    const p = new URLSearchParams(sp);
    p.set(k, String(v));
    setSp(p, { replace: true });
  };

  const fq = useQuery({
    queryKey: ["forecast", instrument?.id, horizon, model],
    queryFn: () => api.get<ForecastResp>(`/api/market/forecast${qs({ instrument_id: instrument!.id, horizon, model })}`),
    enabled: !!instrument,
    placeholderData: keepPreviousData,
    staleTime: 120_000,
  });
  const f = fq.data?.forecast;
  const ev: Evaluation | undefined = fq.data?.evaluation;
  const naive = ev?.metrics?.naive;
  const v = verdict(ev?.metrics?.[model], model, naive);
  const unit = f?.instrument.unit ?? instrument?.unit ?? "points";
  // keep the forecast fan legible: show less history for short horizons
  const chartRows = useMemo(() => {
    const rows = fq.data?.chart ?? [];
    const hist = horizon === 1 ? 30 : horizon === 5 ? 60 : 120;
    const nHist = rows.filter((r) => r.price !== undefined).length;
    return rows.slice(Math.max(0, nHist - hist));
  }, [fq.data, horizon]);

  const modelItems = (models.data?.models ?? [])
    .slice()
    .sort((a, b) => MODEL_ORDER.indexOf(a.id) - MODEL_ORDER.indexOf(b.id))
    .map((m) => ({
      value: m.id,
      label: m.id === "chronos" && !m.available ? "Chronos · not installed" : m.id === "naive" ? "Naïve" : m.id === "drift" ? "Historical drift" : m.name.replace(" regression", ""),
      disabled: m.id === "chronos" && !m.available,
      hint: m.desc,
    }));

  const grouped = GROUPS.map((g) => ({ ...g, items: (universe.data ?? []).filter((u) => g.classes.includes(u.asset_class)) })).filter((g) => g.items.length);

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Markets"
        title="Forecast"
        subtitle="Experimental return ranges with calibrated uncertainty — every model benchmarked against a naïve no-change baseline, and every forecast logged to the public track record."
        actions={
          <Link to="/app/track-record" className="btn-ghost !py-1.5 text-sm">
            <History className="h-4 w-4" /> Track record
          </Link>
        }
      />

      <Card pad={false}>
        <div className="grid gap-3 p-4 sm:p-5 lg:grid-cols-[minmax(220px,320px)_auto_1fr] lg:items-end">
          <Field label="Instrument">
            <Select value={instrument?.id ?? ""} onChange={(e) => set("instrument", e.target.value)} disabled={!universe.data} aria-label="Instrument">
              {grouped.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.items.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </Field>
          <ControlGroup label="Horizon">
            <Segmented label="Forecast horizon" value={horizon} onChange={(h) => set("h", h)} items={HORIZONS} />
          </ControlGroup>
          <ControlGroup label="Model">
            {modelItems.length ? (
              <Segmented label="Model" value={model} onChange={(m) => set("model", m)} items={modelItems} />
            ) : (
              <Skeleton className="h-10 w-full max-w-md" />
            )}
          </ControlGroup>
        </div>
      </Card>

      {fq.error ? (
        <Card>
          <ErrorState error={fq.error} onRetry={() => fq.refetch()} />
        </Card>
      ) : !f || !fq.data ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-[420px]" />
          <Skeleton className="h-[420px] lg:col-span-2" />
        </div>
      ) : (
        <>
          <Notice tone={v.tone} title={v.title} icon={v.icon}>
            {v.body}
          </Notice>

          <div className={clsx("grid gap-4 lg:grid-cols-3 transition-opacity [&>*]:min-w-0", fq.isFetching && "opacity-60")}>
            <Card
              title={f.instrument.name}
              subtitle={`${f.model_name} · ${f.horizon_label}`}
              actions={fq.isFetching ? <Spinner className="h-4 w-4" /> : f.synthetic ? <Badge tone="warn">Synthetic data</Badge> : <Badge tone="accent">Experimental</Badge>}
            >
              <div className="label">Central estimate</div>
              <div className="mt-1 flex items-baseline gap-3">
                <Delta value={f.point_return} className="text-[28px] font-bold" />
                <span className="text-sm text-muted tnum">≈ {priceFmt(f.price_point, unit)}</span>
              </div>
              <p className="mt-1 text-xs text-faint">
                Log return from {priceFmt(f.base_price, unit)} on {date(f.cutoff_date)} to {date(f.target_date)}.
              </p>

              <div className="mt-5 space-y-3">
                <div>
                  <div className="mb-1 flex items-baseline justify-between text-sm">
                    <span className="font-medium text-ink">80% range</span>
                    <span className="tnum font-semibold">{pct(f.interval80[0], 1, true)} to {pct(f.interval80[1], 1, true)}</span>
                  </div>
                  <div className="text-right text-xs text-muted tnum">{priceFmt(f.price_interval80[0], unit)} – {priceFmt(f.price_interval80[1], unit)}</div>
                </div>
                <div>
                  <div className="mb-1 flex items-baseline justify-between text-sm">
                    <span className="font-medium text-ink">50% range</span>
                    <span className="tnum font-semibold">{pct(f.interval50[0], 1, true)} to {pct(f.interval50[1], 1, true)}</span>
                  </div>
                  <div className="text-right text-xs text-muted tnum">{priceFmt(f.price_interval50[0], unit)} – {priceFmt(f.price_interval50[1], unit)}</div>
                </div>
                <RangeBar lo80={f.interval80[0]} hi80={f.interval80[1]} lo50={f.interval50[0]} hi50={f.interval50[1]} point={f.point_return} height={16} className="mt-2" />
                <div className="flex justify-between text-[11px] text-faint">
                  <span>wider band = 80% · darker = 50% · tick = central</span>
                </div>
              </div>

              <p className="mt-5 rounded-lg bg-surface2/60 p-3 text-xs leading-relaxed text-muted">
                An 80% range should miss about 1 time in 5. Outcomes outside it are expected, and they're recorded on the Track Record page.
              </p>
            </Card>

            <Card className="lg:col-span-2" title="Price path & forecast range" subtitle={`Last ${chartRows.filter((r) => r.price !== undefined).length} sessions and the ${f.horizon_label} forecast fan`}>
              <FanChart data={chartRows} cutoff={f.cutoff_date} unit={unit} />
              <SourceBadge className="mt-3" source={f.source} synthetic={f.synthetic} delay="Daily closes; split/dividend-adjusted for modelling" />
            </Card>
          </div>

          <div className="space-y-4 [&>*]:min-w-0">
            <Card
              className=""
              title="Walk-forward evaluation"
              subtitle={ev?.test_start ? `Out-of-sample ${date(ev.test_start)} → ${date(ev.test_end)} · refit every ${ev.refit_every} sessions · scored every ${ev.eval_step} session(s)` : "Out-of-sample testing"}
              actions={ev?.cached ? <Badge tone="neutral">Cached run</Badge> : undefined}
            >
              {ev?.error || !ev?.metrics ? (
                <Notice tone="warn">{ev?.error ?? "Evaluation unavailable."}</Notice>
              ) : (
                <>
                  <div className="-mx-4 overflow-x-auto sm:-mx-5">
                    <table className="table-base min-w-[860px] [&_td]:whitespace-nowrap">
                      <thead>
                        <tr>
                          <th>Model</th>
                          <th className="!text-right">MAE</th>
                          <th className="!text-right">RMSE</th>
                          <th className="!text-right">Direction</th>
                          <th className="!text-right">80% cover</th>
                          <th className="!text-right">50% cover</th>
                          <th className="!text-right">80% width</th>
                          <th className="!text-right">Skill vs naïve</th>
                          <th>vs naïve</th>
                          <th className="!text-right">n</th>
                        </tr>
                      </thead>
                      <tbody>
                        {EVAL_ORDER.filter((k) => ev.metrics[k]).map((k) => {
                          const m = ev.metrics[k];
                          const card = models.data?.models.find((x) => x.id === k);
                          return (
                            <tr key={k} className={clsx(k === model && "bg-accent/[0.06]")}>
                              <td>
                                <button className="text-left font-medium text-ink hover:text-accent" onClick={() => set("model", k)}>
                                  {card?.name ?? k}
                                </button>
                                {card?.kind === "baseline" && <div className="text-[11px] text-faint">baseline</div>}
                              </td>
                              <td className="text-right tnum">{num(m.mae)} pp</td>
                              <td className="text-right tnum">{num(m.rmse)} pp</td>
                              <td className="text-right tnum">{m.directional_accuracy === null ? <span className="text-faint" title="Naïve predicts no direction">n/a</span> : pct(m.directional_accuracy * 100, 0)}</td>
                              <td className={clsx("text-right font-semibold tnum", coverageTone(m.coverage80, 0.8))}>{pct(m.coverage80 * 100, 0)}</td>
                              <td className={clsx("text-right tnum", coverageTone(m.coverage50, 0.5))}>{pct(m.coverage50 * 100, 0)}</td>
                              <td className="text-right tnum">{num(m.width80, 1)} pp</td>
                              <td className="text-right"><Delta value={m.skill_vs_naive * 100} digits={1} arrow={false} /></td>
                              <td>
                                {m.beats_naive === null ? (
                                  <Badge tone="neutral">Benchmark</Badge>
                                ) : m.beats_naive === "significant" ? (
                                  <Badge tone="pos">Beats · significant</Badge>
                                ) : m.beats_naive === "marginal" ? (
                                  <Badge tone="warn">Marginal</Badge>
                                ) : (
                                  <Badge tone="neg">Doesn't beat</Badge>
                                )}
                              </td>
                              <td className="text-right tnum text-muted">{m.n}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-faint">
                    Errors are in percentage points of {f.horizon_label} return. Coverage should sit near its nominal level (80% / 50%) — green means within 5 pp. Skill = 1 − MAE / naïve MAE; negative means worse than predicting no change. Significance uses a paired t-test on absolute errors at non-overlapping origins.
                  </p>
                </>
              )}
            </Card>

          </div>
          <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
              <Card title="What the model leans on" subtitle="Association, not causation">
                {f.factors.length ? (
                  <ul className="space-y-2.5">
                    {f.factors.map((fa) => (
                      <li key={fa.feature}>
                        <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                          <span className="flex min-w-0 items-center gap-2">
                            {fa.sign && (
                              <span className={clsx("grid h-4 w-4 shrink-0 place-items-center rounded text-[10px] font-bold", fa.sign === "+" ? "bg-pos/15 text-pos" : "bg-neg/15 text-neg")} title={fa.sign === "+" ? "Higher values associated with higher forecasts" : "Higher values associated with lower forecasts"}>
                                {fa.sign === "+" ? "+" : "−"}
                              </span>
                            )}
                            <span className="truncate text-ink">{fa.label}</span>
                          </span>
                          <span className="tnum text-xs text-muted">{pct(fa.weight * 100, 0)}</span>
                        </div>
                        <ScoreBar value={fa.weight} max={f.factors[0].weight} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">{model === "naive" || model === "drift" ? "Baselines use no features — that's what makes them baselines." : "No feature attribution for this model."}</p>
                )}
                {f.factors.length > 0 && (
                  <p className="mt-3 text-xs text-faint">Share of the model's total {model === "ridge" ? "standardised coefficient weight" : "split gain"}. These are patterns the model found in past prices, not reasons prices move.</p>
                )}
              </Card>

              <Card title={<span className="flex items-center gap-2"><Receipt className="h-4 w-4 text-accent" /> Logged to the track record</span>}>
                <KeyValue
                  className="!grid-cols-1"
                  items={[
                    ["Record", `#${fq.data.logged.id}`],
                    ["Logged", dateTime(fq.data.logged.created_at)],
                    ["Hash", <code key="h" className="text-xs" title={fq.data.logged.record_hash}>{fq.data.logged.record_hash.slice(0, 16)}…</code>],
                  ]}
                />
                <p className="mt-3 text-xs text-faint">One record per instrument, model, horizon and data date — append-only and hash-chained. It will be scored automatically after {date(f.target_date)}.</p>
                <Link to="/app/track-record?origin=live" className="btn-ghost mt-3 w-full !py-1.5 text-sm">View live track record</Link>
              </Card>

              <Card title="Forecast details" subtitle="Everything needed to reproduce this number">
                <KeyValue
                  className="!grid-cols-1 [&_dd]:min-w-0 [&_dd]:break-words"
                  items={[
                    ["Model", `${f.model_name} (${f.model_version})`],
                    ["Code version", f.code_version],
                    ["Cutoff → target", `${date(f.cutoff_date)} → ${date(f.target_date)}`],
                    ["Training window", f.training_window ? `${date(f.training_window[0])} – ${date(f.training_window[1])}` : "—"],
                    ["Train / calibration rows", `${f.n_train.toLocaleString("en-IN")} / ${f.n_calibration.toLocaleString("en-IN")}`],
                    ["Interval method", <span key="m" className="text-xs font-normal">{f.interval_method}</span>],
                    ["Dataset hash", <code key="d" className="text-xs">{f.dataset_hash}</code>],
                  ]}
                />
              </Card>
          </div>
        </>
      )}

      {instrument && <Scenarios instrumentId={instrument.id} unit={unit} />}

      {models.data && (
        <div className="grid gap-4 xl:grid-cols-5 [&>*]:min-w-0">
          <Card className="xl:col-span-3" title="Model cards" subtitle={`Code version ${models.data.code_version}`}>
            <div className="grid gap-3 sm:grid-cols-2">
              {models.data.models
                .slice()
                .sort((a, b) => MODEL_ORDER.indexOf(a.id) - MODEL_ORDER.indexOf(b.id))
                .map((m) => (
                  <div key={m.id} className={clsx("rounded-xl border p-3.5", m.id === model ? "border-accent/40 bg-accent/[0.05]" : "border-line/60 bg-surface2/30")}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-semibold text-ink">{m.name}</div>
                      <Badge tone={m.kind === "baseline" ? "neutral" : m.kind === "experimental" ? "warn" : "accent"} className="capitalize">{m.kind}</Badge>
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-muted">{m.desc}</p>
                    <div className="mt-2 flex items-center gap-2 text-[11px] text-faint">
                      {m.version && <code>{m.version}</code>}
                      {!m.available && <Badge tone="neutral">Not installed</Badge>}
                    </div>
                  </div>
                ))}
            </div>
          </Card>
          <Card className="xl:col-span-2" title={<span className="flex items-center gap-2"><Sigma className="h-4 w-4 text-accent" /> Evaluation protocol</span>} subtitle="Built to avoid look-ahead bias">
            <ol className="space-y-2 text-sm">
              {models.data.protocol.steps.map((s, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent/12 text-[11px] font-bold text-accent">{i + 1}</span>
                  <span className="text-muted">{s}</span>
                </li>
              ))}
            </ol>
            <div className="mt-4">
              <div className="label mb-2">Features (prices only, known at forecast time)</div>
              <div className="flex flex-wrap gap-1.5">
                {Object.values(models.data.protocol.features).map((x) => (
                  <span key={x} className="rounded-md border border-line bg-surface2/60 px-2 py-0.5 text-[11px] text-muted">{x}</span>
                ))}
              </div>
            </div>
          </Card>
        </div>
      )}

      <Disclaimer>
        Forecasts are experimental statistical estimates from past prices only. They are not predictions to act on and not investment advice; FinLex is not a SEBI-registered adviser. Ranges are calibrated on historical data and will be wrong some of the time — see the Track Record for every hit and miss.
      </Disclaimer>
    </div>
  );
}
