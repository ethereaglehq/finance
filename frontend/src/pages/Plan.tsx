import { useMutation, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { AlertTriangle, CheckCircle2, ChevronDown, Cpu, Play, RotateCcw, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { StackedBar, StackLegend, type Segment } from "@/components/assist/StackedBar";
import { Badge, Button, Card, Chip, Disclaimer, EmptyState, ErrorState, Field, Input, Notice, PageHeader, Select, Skeleton, Switch } from "@/components/ui";
import { api } from "@/lib/api";
import { date, pct } from "@/lib/format";
import type { PlanResp, Review, Rule } from "@/lib/types";

interface ClassesResp {
  classes: { id: string; label: string; proxy: string | null }[];
  risk_caps: Record<string, number>;
}

const PROXY_NAMES: Record<string, string> = {
  NIFTY50: "NIFTY 50 index",
  MF118989: "HDFC Mid Cap Fund",
  MF119091: "HDFC Liquid Fund",
  GOLD: "Gold INR reference",
  SILVER: "Silver INR reference",
};

export default function Plan() {
  return (
    <div>
      <PageHeader
        eyebrow="Assist"
        title="Plan"
        subtitle="A rule-based review of your portfolio and a sandbox to explore asset-class mixes that satisfy constraints you set. Educational — not advice."
      />
      <div className="space-y-6">
        <ReviewSection />
        <Explorer />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ expert system */
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function factValue(v: unknown): string {
  if (Array.isArray(v)) return v.join("–");
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return String(v);
}

function RuleCard({ r }: { r: Rule }) {
  return (
    <li className={clsx("rounded-xl border p-4", r.severity === "warning" ? "border-warn/30 bg-warn/[0.05]" : "border-accent/25 bg-accent/[0.04]")}>
      <div className="flex flex-wrap items-center gap-2">
        <AlertTriangle className={clsx("h-4 w-4", r.severity === "warning" ? "text-warn" : "text-accent")} aria-hidden />
        <span className="font-semibold text-ink">{r.title}</span>
        <Badge tone={r.severity === "warning" ? "warn" : "info"}>{r.severity === "warning" ? "Worth a look" : "Note"}</Badge>
        <span className="ml-auto font-mono text-[11px] text-faint">{r.id}</span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-ink/90">{r.explanation}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {Object.entries(r.facts).map(([k, v]) => (
          <span key={k} className="rounded-md border border-line/70 bg-surface px-2 py-0.5 text-[11px] text-muted">
            {k.replace(/_/g, " ")}: <span className="font-semibold text-ink">{factValue(v)}</span>
          </span>
        ))}
      </div>
      <div className="mt-2 text-[11px] text-faint">Rule fires when: {r.condition}</div>
    </li>
  );
}

function ReviewSection() {
  const q = useQuery({ queryKey: ["plan-review"], queryFn: () => api.get<Review>("/api/plan/review") });
  const [showPassed, setShowPassed] = useState(false);
  if (q.isLoading) return <Skeleton className="h-72 w-full rounded-2xl" />;
  if (q.error) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  const r = q.data!;
  const fired = r.rules.filter((x) => x.fired);
  const passed = r.rules.filter((x) => !x.fired);
  const segs: Segment[] = r.current_allocation.map((a) => ({ key: a.class, label: a.label, value: a.pct }));
  const empty = segs.every((s) => s.value === 0);
  return (
    <Card
      title={<span className="flex items-center gap-2"><Cpu className="h-4 w-4 text-accent" /> Portfolio review · expert system</span>}
      subtitle="Fixed, transparent rules. Each observation lists the facts it used."
      actions={
        <div className="hidden flex-wrap gap-1.5 sm:flex">
          <Chip tone="accent">{cap(r.profile.risk_level)} profile</Chip>
          <Chip>{r.profile.horizon_years} yr horizon</Chip>
        </div>
      }
    >
      <div className="mb-4 flex flex-wrap gap-1.5 sm:hidden">
        <Chip tone="accent">{cap(r.profile.risk_level)} profile</Chip>
        <Chip>{r.profile.horizon_years} yr horizon</Chip>
      </div>
      {empty ? (
        <EmptyState title="Add holdings to get a review" action={<Link to="/app/portfolio" className="btn-primary">Go to portfolio</Link>}>
          The rules check concentration, overlap, allocation vs your stated profile and data freshness.
        </EmptyState>
      ) : (
        <>
          <div className="label mb-2">Current mix by asset class</div>
          <StackedBar segments={segs} height={16} showValues />
          <div className="mt-2.5"><StackLegend segments={segs} /></div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            {r.current_allocation.map((a) => <span key={a.class}>{a.label} <span className="font-semibold tnum text-ink">{pct(a.pct, 1)}</span></span>)}
          </div>
          <div className="mt-5 flex items-center justify-between gap-3">
            <p className="text-sm text-muted">{r.summary}</p>
          </div>
          {fired.length > 0 && <ul className="mt-3 space-y-3">{fired.map((x) => <RuleCard key={x.id} r={x} />)}</ul>}
          {passed.length > 0 && (
            <div className="mt-4 rounded-xl border border-line/60">
              <button onClick={() => setShowPassed((s) => !s)} aria-expanded={showPassed} className="flex w-full items-center justify-between px-4 py-3 text-sm">
                <span className="flex items-center gap-2 text-muted"><CheckCircle2 className="h-4 w-4 text-pos" /> {passed.length} rule{passed.length > 1 ? "s" : ""} passed</span>
                <ChevronDown className={clsx("h-4 w-4 text-faint transition", showPassed && "rotate-180")} />
              </button>
              {showPassed && (
                <ul className="divide-y divide-line/40 border-t border-line/60">
                  {passed.map((x) => (
                    <li key={x.id} className="flex flex-col gap-1 px-4 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between">
                      <span className="text-ink"><span className="mr-2 font-mono text-[11px] text-faint">{x.id}</span>{x.title}</span>
                      <span className="text-xs text-faint">{x.condition} — not met</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
      <Disclaimer className="mt-4">{r.disclaimer}</Disclaimer>
    </Card>
  );
}

/* ------------------------------------------------------------------ CSP + A* explorer */
type Bounds = Record<string, { min: number; max: number }>;

function Explorer() {
  const cls = useQuery({ queryKey: ["plan-classes"], queryFn: () => api.get<ClassesResp>("/api/plan/classes"), staleTime: Infinity });
  const classes = cls.data?.classes ?? [];
  const blank = useMemo<Bounds>(() => Object.fromEntries(classes.map((c) => [c.id, { min: 0, max: 100 }])), [classes]);
  const [bounds, setBounds] = useState<Bounds>({});
  const [risk, setRisk] = useState<string>("");
  const [useCap, setUseCap] = useState(true);
  const [customCap, setCustomCap] = useState<string>("");
  const [step, setStep] = useState(5);
  const b = { ...blank, ...bounds };
  const sumMin = classes.reduce((s, c) => s + (b[c.id]?.min ?? 0), 0);
  const sumMax = classes.reduce((s, c) => s + (b[c.id]?.max ?? 100), 0);
  const badPair = classes.filter((c) => (b[c.id]?.min ?? 0) > (b[c.id]?.max ?? 100));
  const run = useMutation({
    mutationFn: () =>
      api.post<PlanResp>("/api/plan/allocate", {
        bounds: b,
        risk_level: risk || null,
        use_risk_cap: useCap,
        max_vol_pct: useCap && customCap ? Number(customCap) : null,
        step,
      }),
  });
  const set = (id: string, k: "min" | "max", v: string) => {
    const n = Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
    setBounds((x) => ({ ...x, [id]: { ...(b[id] ?? { min: 0, max: 100 }), [k]: n } }));
  };
  const preset = (p: "gold20" | "reset" | "debt10") => {
    if (p === "reset") setBounds({});
    if (p === "gold20") setBounds({ gold: { min: 0, max: 20 } });
    if (p === "debt10") setBounds({ debt: { min: 10, max: 100 }, gold: { min: 0, max: 20 } });
  };
  const capDefault = cls.data?.risk_caps[risk || "moderate"];

  return (
    <Card
      title={<span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-accent" /> Allocation explorer · CSP + A* search</span>}
      subtitle="Set limits per asset class. FinLex checks they're mutually feasible, then searches for mixes that satisfy them, ordered by how little they change your current mix."
    >
      {cls.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : cls.error ? (
        <ErrorState error={cls.error} />
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              run.mutate();
            }}
          >
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => preset("gold20")}>Max 20% gold</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => preset("debt10")}>≥10% debt, ≤20% gold</Button>
              <Button type="button" variant="quiet" size="sm" onClick={() => preset("reset")}><RotateCcw className="h-3.5 w-3.5" /> Reset</Button>
            </div>
            <div className="overflow-hidden rounded-xl border border-line/70">
              <div className="grid grid-cols-[1fr_76px_76px] gap-2 border-b border-line/60 bg-surface2/50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
                <span>Asset class</span><span>Min %</span><span>Max %</span>
              </div>
              {classes.map((c) => {
                const v = b[c.id] ?? { min: 0, max: 100 };
                const bad = v.min > v.max;
                return (
                  <div key={c.id} className={clsx("grid grid-cols-[1fr_76px_76px] items-center gap-2 border-b border-line/40 px-3 py-2 last:border-0", bad && "bg-neg/[0.06]")}>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-ink">{c.label}</div>
                      <div className="truncate text-[10px] text-faint">Risk proxy: {c.proxy ? PROXY_NAMES[c.proxy] ?? c.proxy : "none (cash)"}</div>
                    </div>
                    <Input type="number" min={0} max={100} step={step} value={v.min} onChange={(e) => set(c.id, "min", e.target.value)} aria-label={`${c.label} minimum percent`} className="!px-2 text-right tnum" />
                    <Input type="number" min={0} max={100} step={step} value={v.max} onChange={(e) => set(c.id, "max", e.target.value)} aria-label={`${c.label} maximum percent`} className="!px-2 text-right tnum" />
                  </div>
                );
              })}
            </div>
            <div className={clsx("rounded-lg px-3 py-2 text-xs", sumMin > 100 || sumMax < 100 || badPair.length ? "bg-neg/10 text-neg" : "bg-surface2/60 text-muted")}>
              Minimums add to <b className="tnum">{sumMin}%</b> (must be ≤ 100) · maximums add to <b className="tnum">{sumMax}%</b> (must be ≥ 100)
              {badPair.length > 0 && <> · {badPair.map((c) => c.label).join(", ")}: min above max</>}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Risk level" hint="Defaults to your profile">
                <Select value={risk} onChange={(e) => setRisk(e.target.value)}>
                  <option value="">Use my profile</option>
                  <option value="conservative">Conservative</option>
                  <option value="moderate">Moderate</option>
                  <option value="aggressive">Aggressive</option>
                </Select>
              </Field>
              <Field label="Step size">
                <Select value={step} onChange={(e) => setStep(Number(e.target.value))}>
                  {[10, 5, 2, 1].map((s) => <option key={s} value={s}>{s}% increments</option>)}
                </Select>
              </Field>
            </div>
            <div className="rounded-xl border border-line/70 p-3">
              <Switch checked={useCap} onChange={setUseCap} label="Cap historical volatility" />
              {useCap && (
                <div className="mt-3 flex items-center gap-2">
                  <Input type="number" min={1} max={60} step={0.5} value={customCap} onChange={(e) => setCustomCap(e.target.value)} placeholder={capDefault ? String(capDefault) : ""} className="w-28 text-right tnum" aria-label="Volatility cap percent" />
                  <span className="text-xs text-muted">% a year · blank = {capDefault ?? "—"}% for {risk ? `a ${risk}` : "your"} profile</span>
                </div>
              )}
            </div>
            <Button type="submit" className="w-full" loading={run.isPending} disabled={sumMin > 100 || sumMax < 100 || badPair.length > 0}>
              <Play className="h-4 w-4" /> Find allocations
            </Button>
          </form>
          <div className="min-w-0">
            {run.isPending ? (
              <Skeleton className="h-80 w-full" />
            ) : run.error ? (
              <Notice tone="neg" title="Couldn't run the search">{(run.error as Error).message}</Notice>
            ) : run.data ? (
              <Results res={run.data} classes={classes} />
            ) : (
              <EmptyState icon={<Play className="h-5 w-5" />} title="Set your constraints and run the search">
                Try the "Max 20% gold" preset. FinLex will report whether your limits can all be satisfied, and show the closest feasible mixes with their historical risk.
              </EmptyState>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function Results({ res, classes }: { res: PlanResp; classes: ClassesResp["classes"] }) {
  const label = (id: string) => res.labels?.[id] ?? classes.find((c) => c.id === id)?.label ?? id;
  const ids = classes.map((c) => c.id);
  const currentSegs: Segment[] = ids.map((id) => ({ key: id, label: label(id), value: res.current[id] ?? 0 }));
  return (
    <div className="space-y-4">
      {res.problems.map((p) => <Notice key={p} tone="neg" title="Constraints can't all be met">{p}</Notice>)}
      {res.violations_now.length > 0 && (
        <Notice tone="warn" title="Your current mix is outside these limits">
          <ul className="mt-1 space-y-0.5">{res.violations_now.map((v) => <li key={v}>• {v}</li>)}</ul>
        </Notice>
      )}
      {res.feasible && (
        <>
          <div className="rounded-xl border border-line/70 bg-surface2/40 p-3.5">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-semibold text-ink">Your current mix</span>
              <span className="text-xs text-muted">
                Historical: return {pct(res.current_stats?.hist_return_pct, 1)} · volatility {pct(res.current_stats?.hist_vol_pct, 1)}
              </span>
            </div>
            <StackedBar segments={currentSegs} height={14} showValues />
            <div className="mt-2.5"><StackLegend segments={currentSegs} /></div>
          </div>
          <ol className="space-y-3">
            {res.solutions.map((s, i) => {
              const segs: Segment[] = ids.map((id) => ({ key: id, label: label(id), value: s.allocation[id] ?? 0 }));
              return (
                <li key={i} className="rounded-xl border border-line/70 p-3.5">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-ink">Option {i + 1}</span>
                    {i === 0 && <Badge tone="accent">Closest to current</Badge>}
                    <span className="ml-auto flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                      <span>Change needed <b className="tnum text-ink">{pct(s.turnover_pct, 1)}</b></span>
                      <span>Hist. return <b className="tnum text-ink">{pct(s.hist_return_pct, 1)}</b></span>
                      <span>Hist. volatility <b className="tnum text-ink">{pct(s.hist_vol_pct, 1)}</b></span>
                    </span>
                  </div>
                  <StackedBar segments={segs} height={14} showValues />
                  <details className="group mt-2.5">
                    <summary className="cursor-pointer list-none text-xs font-medium text-accent hover:underline">
                      <span className="group-open:hidden">Show per-class breakdown</span>
                      <span className="hidden group-open:inline">Hide breakdown</span>
                    </summary>
                    <div className="mt-2 overflow-x-auto">
                      <table className="table-base text-xs">
                        <thead><tr><th>Asset class</th><th className="!text-right">Current</th><th className="!text-right">Option</th><th className="!text-right">Change</th></tr></thead>
                        <tbody>
                          {ids.map((id) => {
                            const cur = res.current[id] ?? 0;
                            const nv = s.allocation[id] ?? 0;
                            const d = nv - cur;
                            return (
                              <tr key={id}>
                                <td className="!py-1.5">{label(id)}</td>
                                <td className="!py-1.5 text-right tnum text-muted">{pct(cur, 1)}</td>
                                <td className="!py-1.5 text-right tnum font-semibold">{pct(nv, 0)}</td>
                                <td className={clsx("!py-1.5 text-right tnum", Math.abs(d) < 0.05 ? "text-faint" : "text-ink")}>{Math.abs(d) < 0.05 ? "—" : `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(1)} pp`}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </details>
                </li>
              );
            })}
          </ol>
        </>
      )}
      {res.search && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-line/60 p-3 text-xs text-muted">
            <div className="label mb-1.5">Search</div>
            <div>{res.search.algorithm}</div>
            <div className="mt-1.5 flex flex-wrap gap-x-3">
              <span>Nodes expanded <b className="tnum text-ink">{res.search.nodes_expanded}</b></span>
              <span>Rejected by vol cap <b className="tnum text-ink">{res.search.rejected_by_vol_cap}</b></span>
              <span>Step <b className="text-ink">{res.search.step_pct}%</b></span>
              {res.vol_cap_pct ? <span>Vol cap <b className="text-ink">{pct(res.vol_cap_pct, 1)}</b></span> : <span>No vol cap</span>}
            </div>
          </div>
          {res.risk_model && (
            <div className="rounded-xl border border-line/60 p-3 text-xs text-muted">
              <div className="label mb-1.5">Risk model</div>
              <div>{res.risk_model.note}</div>
              {res.risk_model.window && <div className="mt-1">Window {date(res.risk_model.window[0])} – {date(res.risk_model.window[1])}</div>}
              <div className="mt-1 text-faint">
                Proxies: {Object.entries(res.risk_model.proxies).map(([k, v]) => `${label(k)} → ${v ? PROXY_NAMES[v] ?? v : "3.5% fixed"}`).join(" · ")}
              </div>
            </div>
          )}
        </div>
      )}
      <Notice tone="warn" title="Hypothetical mixes, not recommendations">
        {res.disclaimer ?? "These mixes only satisfy the constraints you entered. They are not suggestions to buy or sell anything."} Historical figures describe past behaviour of proxy series, not expected returns.
      </Notice>
    </div>
  );
}
