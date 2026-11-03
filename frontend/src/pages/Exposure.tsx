/* True Exposure — look through mutual funds/ETFs to company, sector and asset-class concentration. */
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { BrainCircuit, ChevronDown, FileSearch, Layers, ListChecks, Settings2, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { shortFund } from "@/components/analysis/Segmented";
import { BarList, Donut, HeatMatrix, Legend } from "@/components/charts";
import {
  Badge,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Notice,
  PageHeader,
  ScoreBar,
  Skeleton,
  Stat,
  Tabs,
  type Tone,
} from "@/components/ui";
import { api } from "@/lib/api";
import { date, inr, inrCompact, pct } from "@/lib/format";
import { useChartColors } from "@/lib/theme";
import type { Company, Exposure as ExposureT } from "@/lib/types";

function KpiSkeleton() {
  return (
    <div className="space-y-4">
      <div className="card grid grid-cols-2 gap-5 p-5 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-28" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-[420px] lg:col-span-2" />
        <Skeleton className="h-[420px]" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ company bars with inline contributor drill-down */
function CompanyBars({ companies, threshold }: { companies: Company[]; threshold: number }) {
  const c = useChartColors();
  const [open, setOpen] = useState<string | null>(companies[0]?.key ?? null);
  const max = Math.max(threshold * 1.15, ...companies.map((x) => x.pct), 1);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Legend
          items={[
            { label: "Held directly", color: c.series[0] },
            { label: "Via funds / ETFs", color: c.series[2] },
            { label: `Your ${threshold}% threshold`, color: c.warn },
          ]}
        />
        <span className="text-xs text-faint">Click a company to see where it comes from</span>
      </div>
      <ul className="space-y-1">
        {companies.map((co) => {
          const isOpen = open === co.key;
          const w = Math.max(1.5, (co.pct / max) * 100);
          const over = co.pct >= threshold;
          return (
            <li key={co.key} className={clsx("rounded-xl transition", isOpen && "bg-surface2/50")}>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : co.key)}
                className="w-full rounded-xl px-2.5 py-2 text-left hover:bg-surface2/60"
              >
                <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <ChevronDown className={clsx("h-3.5 w-3.5 shrink-0 text-faint transition", isOpen && "rotate-180")} />
                    <span className="truncate font-medium text-ink">{co.name}</span>
                    {over && <Badge tone="warn">Above {threshold}%</Badge>}
                  </span>
                  <span className="shrink-0 tnum">
                    <span className="font-semibold text-ink">{pct(co.pct, 2)}</span>
                    <span className="ml-2 hidden text-xs text-faint sm:inline">{inrCompact(co.total)}</span>
                  </span>
                </div>
                <div className="relative ml-5 h-2 overflow-hidden rounded-full bg-surface2">
                  <div className="flex h-full gap-[2px]" style={{ width: `${w}%` }}>
                    {co.direct > 0 && <div className="h-full rounded-l-full" style={{ flex: co.direct, background: c.series[0] }} />}
                    {co.indirect > 0 && <div className={clsx("h-full rounded-r-full", co.direct <= 0 && "rounded-l-full")} style={{ flex: co.indirect, background: c.series[2] }} />}
                  </div>
                  <div className="absolute top-0 h-full w-[2px] bg-warn" style={{ left: `${(threshold / max) * 100}%` }} aria-hidden />
                </div>
              </button>
              {isOpen && (
                <div className="px-3 pb-3 pl-8 animate-fadein">
                  <div className="mb-2 text-xs text-muted">
                    {co.sector} · {inr(co.total)} in total — {inr(co.direct)} direct, {inr(co.indirect)} through {co.contributors.filter((x) => x.kind === "indirect").length} fund(s)
                  </div>
                  <ul className="divide-y divide-line/40 text-sm">
                    {co.contributors.map((ct, i) => (
                      <li key={i} className="flex items-center justify-between gap-3 py-1.5">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: ct.kind === "direct" ? c.series[0] : c.series[2] }} />
                          <span className="truncate text-muted">{ct.kind === "direct" ? "Direct holding" : shortFund(ct.via)}</span>
                        </span>
                        <span className="shrink-0 tnum text-ink">
                          {inr(ct.value)} <span className="text-faint">· {pct((ct.value / co.total) * 100, 0)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CompanyTable({ companies }: { companies: Company[] }) {
  const max = Math.max(...companies.map((c) => c.pct), 1e-9);
  return (
    <div className="-mx-4 overflow-x-auto sm:-mx-5">
      <table className="table-base min-w-[720px]">
        <thead>
          <tr>
            <th>Company</th>
            <th>Sector</th>
            <th className="!text-right">Direct</th>
            <th className="!text-right">Via funds</th>
            <th className="!text-right">Total</th>
            <th className="w-44">Share of portfolio</th>
          </tr>
        </thead>
        <tbody>
          {companies.map((c) => (
            <tr key={c.key}>
              <td>
                <div className="font-medium text-ink">{c.name}</div>
                <div className="text-xs text-faint">{c.symbol ?? "Matched by name"} · {c.n_sources} source{c.n_sources === 1 ? "" : "s"}</div>
              </td>
              <td className="text-muted">{c.sector}</td>
              <td className="text-right tnum">{c.direct ? inr(c.direct) : <span className="text-faint">—</span>}</td>
              <td className="text-right tnum">{c.indirect ? inr(c.indirect) : <span className="text-faint">—</span>}</td>
              <td className="text-right font-semibold tnum">{inr(c.total)}</td>
              <td>
                <div className="flex items-center gap-2">
                  <ScoreBar value={c.pct} max={max} className="flex-1" />
                  <span className="w-14 text-right text-xs font-semibold tnum">{pct(c.pct, 2)}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ page */
export default function Exposure() {
  const q = useQuery({ queryKey: ["exposure"], queryFn: () => api.get<ExposureT>("/api/exposure") });
  const [view, setView] = useState<"bars" | "table">("bars");
  const [showAllPairs, setShowAllPairs] = useState(false);
  const [limit, setLimit] = useState(12);
  const e = q.data;

  const derived = useMemo(() => {
    if (!e) return null;
    const realSectors = e.sectors.filter((s) => s.sector !== "Not itemised" && s.sector !== "Unclassified");
    // keep funds that overlap with at least one other fund (drops gold/silver ETFs that share nothing)
    const keep = e.overlap.funds.map((_, i) => e.overlap.matrix[i].some((v, j) => j !== i && v > 0));
    const fundIdx = e.overlap.funds.map((_, i) => i).filter((i) => keep[i]);
    const names = fundIdx.map((i) => shortFund(e.overlap.funds[i]));
    const values = fundIdx.map((i) => fundIdx.map((j) => (i === j ? null : e.overlap.matrix[i][j])));
    const pairs = e.overlap.pairs.filter((p) => p.overlap_pct > 0);
    const covered = e.coverage.filter((c) => c.covered).length;
    return { realSectors, names, values, pairs, covered };
  }, [e]);

  const header = (
    <PageHeader
      eyebrow="Your money"
      title="True Exposure"
      subtitle="What you actually own once every mutual fund and ETF is looked through — company, sector and asset-class concentration, and how much your funds overlap."
      actions={
        <>
          <Link to="/app/settings" className="btn-ghost !py-1.5 text-sm">
            <Settings2 className="h-4 w-4" /> Thresholds
          </Link>
          <Link to="/app/portfolio" className="btn-quiet !py-1.5 text-sm">
            Holdings
          </Link>
        </>
      }
    />
  );

  if (q.isLoading)
    return (
      <div>
        {header}
        <KpiSkeleton />
      </div>
    );
  if (q.error || !e || !derived)
    return (
      <div>
        {header}
        <Card>
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        </Card>
      </div>
    );

  if (!e.total_value || (e.companies.length === 0 && e.coverage.length === 0)) {
    return (
      <div>
        {header}
        <Card>
          <EmptyState
            icon={<Layers className="h-5 w-5" />}
            title="Nothing to look through yet"
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Link to="/app/portfolio" className="btn-primary">Add holdings</Link>
                <Link to="/app/import" className="btn-ghost">Import a statement</Link>
              </div>
            }
          >
            Add stocks, mutual funds or ETFs and FinLex will combine your direct shares with each fund's disclosed portfolio to show your real company and sector exposure.
          </EmptyState>
        </Card>
      </div>
    );
  }

  const top = e.companies[0];
  const topSector = derived.realSectors[0];
  const thr = e.thresholds;
  const companies = e.companies.slice(0, limit);
  const equity = e.asset_mix.find((a) => a.label === "Equity");

  return (
    <div className="space-y-4">
      {header}

      {/* flags */}
      {e.flags.length > 0 ? (
        <div className="grid gap-2">
          {e.flags.map((f, i) => (
            <Notice key={i} tone="warn" title={f.type === "company" ? `Concentration in ${f.name}` : `Sector concentration: ${f.name}`}>
              {f.message}
            </Notice>
          ))}
        </div>
      ) : (
        <Notice tone="pos" icon={<ShieldCheck className="h-4 w-4" />} title="Within your thresholds">
          No single company is above {thr.company_pct}% and no sector is above {thr.sector_pct}% of your portfolio (estimated, look-through).
        </Notice>
      )}

      {/* KPIs */}
      <div className="card grid grid-cols-2 gap-x-5 gap-y-5 p-4 sm:p-5 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Portfolio value" value={inrCompact(e.total_value)} sub={inr(e.total_value)} />
        <Stat label="Companies" value={e.companies.length} sub="direct + look-through" />
        <Stat
          label="Largest company"
          value={top ? pct(top.pct, 1) : "—"}
          sub={<span className="block truncate">{top?.name ?? "—"}</span>}
          hint="Direct shares plus your share of every fund holding it"
        />
        <Stat label="Largest sector" value={topSector ? pct(topSector.pct, 1) : "—"} sub={<span className="block truncate">{topSector?.sector ?? "—"}</span>} />
        <Stat
          label="Not itemised"
          value={pct(e.unitemised_pct, 1)}
          sub="fund holdings beyond the disclosed list"
          hint="Part of each fund's portfolio is not listed in the dataset; it is kept separate rather than guessed."
        />
        <Stat label="Funds covered" value={`${derived.covered}/${e.coverage.length}`} sub="have look-through data" />
      </div>

      {/* companies + asset mix */}
      <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <Card
          className="lg:col-span-2"
          title="Top company exposure"
          subtitle="Direct shares + (your value in each fund × the fund's disclosed weight)"
          actions={
            <Tabs
              size="sm"
              value={view}
              onChange={setView}
              items={[
                { value: "bars", label: "Bars" },
                { value: "table", label: "Table" },
              ]}
            />
          }
        >
          {view === "bars" ? <CompanyBars companies={companies} threshold={thr.company_pct} /> : <CompanyTable companies={companies} />}
          {e.companies.length > 12 && (
            <div className="mt-3 flex justify-center">
              <button className="btn-quiet !py-1 text-xs" onClick={() => setLimit(limit > 12 ? 12 : 40)}>
                {limit > 12 ? "Show top 12" : `Show more (${Math.min(40, e.companies.length)})`}
              </button>
            </div>
          )}
        </Card>

        <Card title="Look-through asset mix" subtitle="Funds split into what they hold">
          <div className="lg:[&>div]:!flex-col">
          <Donut
            items={e.asset_mix.map((a) => ({ label: a.label === "Fund (undisclosed remainder)" ? "Not disclosed" : a.label, value: a.value }))}
            center={
              <div>
                <div className="text-xl font-bold tnum">{pct(equity?.pct ?? 0, 0)}</div>
                <div className="text-[11px] text-faint">equity</div>
              </div>
            }
          />
          </div>
          <p className="mt-4 text-xs leading-relaxed text-faint">
            Debt & cash includes fixed deposits plus the debt and cash parts of hybrid and liquid funds. Gold and silver include ETF bullion.
          </p>
        </Card>
      </div>

      {/* sectors + overlap */}
      <div className="grid gap-4 lg:grid-cols-5 [&>*]:min-w-0">
        <Card className="lg:col-span-2" title="Sector concentration" subtitle={`Estimated · marker = your ${thr.sector_pct}% threshold`}>
          {derived.realSectors.length ? (
            <BarList
              items={derived.realSectors.slice(0, 10).map((s) => ({ key: s.sector, label: s.sector, value: s.pct, sub: undefined }))}
              max={Math.max(thr.sector_pct * 1.15, ...derived.realSectors.map((s) => s.pct))}
              threshold={thr.sector_pct}
              valueLabel={(v) => pct(v, 1)}
            />
          ) : (
            <p className="text-sm text-muted">No equity holdings with sector data yet.</p>
          )}
          {e.unitemised_pct > 0.5 && (
            <p className="mt-4 text-xs text-faint">
              Another {pct(e.unitemised_pct, 1)} of your portfolio ({inrCompact(e.unitemised_value)}) sits in fund holdings that are not itemised, so true sector shares may be higher.
            </p>
          )}
        </Card>

        <Card className="lg:col-span-3" title="Fund overlap" subtitle="Sum of the smaller weight of every stock two funds both hold">
          {derived.names.length >= 2 ? (
            <HeatMatrix rows={derived.names} cols={derived.names} values={derived.values} max={100} format={(v) => `${v.toFixed(0)}%`} />
          ) : (
            <EmptyState icon={<Layers className="h-5 w-5" />} title="Need two equity funds">
              Overlap compares the disclosed portfolios of at least two mutual funds or equity ETFs.
            </EmptyState>
          )}
        </Card>
      </div>

      {derived.pairs.length > 0 && (
        <Card title="Most-overlapping fund pairs" subtitle="Common holdings, shown with the smaller of the two weights">
          <ul className="grid gap-3 md:grid-cols-2 [&>*]:min-w-0">
            {(showAllPairs ? derived.pairs : derived.pairs.slice(0, 4)).map((p, i) => {
              const t: Tone = p.overlap_pct >= 60 ? "neg" : p.overlap_pct >= 40 ? "warn" : "accent";
              return (
                <li key={i} className="rounded-xl border border-line/60 bg-surface2/30 p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 text-sm">
                      <div className="truncate font-medium text-ink" title={p.a}>{shortFund(p.a)}</div>
                      <div className="truncate text-muted" title={p.b}>& {shortFund(p.b)}</div>
                    </div>
                    <Badge tone={t} className="!text-xs">{pct(p.overlap_pct, 1)} overlap</Badge>
                  </div>
                  <ScoreBar value={p.overlap_pct} max={100} tone={t} className="mt-2.5" />
                  <div className="mt-2.5 text-xs text-faint">{p.n_common} stocks in common{p.n_common > p.common.length ? ` · top ${p.common.length} shown` : ""}</div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {p.common.slice(0, 8).map((c) => (
                      <Chip key={c.name} tone="neutral" className="max-w-full !text-[11px]">
                        {c.name.replace(/ (Ltd|Limited)\.?$/i, "")} · {c.min.toFixed(1)}%
                      </Chip>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
          {derived.pairs.length > 4 && (
            <div className="mt-3 flex justify-center">
              <button className="btn-quiet !py-1 text-xs" onClick={() => setShowAllPairs((s) => !s)}>
                {showAllPairs ? "Show fewer" : `Show all ${derived.pairs.length} pairs`}
              </button>
            </div>
          )}
        </Card>
      )}

      {/* coverage + data quality */}
      <div className="grid gap-4 xl:grid-cols-5 [&>*]:min-w-0">
        <Card className="xl:col-span-3" title="Look-through coverage" subtitle="Which funds have holdings data, and how old it is">
          {e.coverage.length ? (
            <div className="-mx-4 overflow-x-auto sm:-mx-5">
              <table className="table-base min-w-[620px]">
                <thead>
                  <tr>
                    <th>Fund / ETF</th>
                    <th>Status</th>
                    <th>Disclosure date</th>
                    <th className="!text-right">Weights sum</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {e.coverage.map((c) => (
                    <tr key={c.holding_id}>
                      <td className="max-w-[240px]">
                        <Link to={`/app/portfolio/${c.holding_id}`} className="block truncate font-medium text-ink hover:text-accent" title={c.name}>
                          {shortFund(c.name)}
                        </Link>
                      </td>
                      <td>{c.covered ? <Badge tone="pos">Covered</Badge> : <Badge tone="warn">No data</Badge>}</td>
                      <td className="whitespace-nowrap text-muted">{date(c.disclosure_date)}</td>
                      <td className="text-right tnum">{c.weight_sum !== undefined ? pct(c.weight_sum, 1) : "—"}</td>
                      <td className="max-w-[260px] text-xs text-faint">
                        <span className="line-clamp-2" title={c.source ?? ""}>{c.source ?? "Not in dataset — counted as an undisclosed fund"}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted">You hold no mutual funds or ETFs — all exposure is direct.</p>
          )}
        </Card>

        <Card className="xl:col-span-2" title="Data quality" subtitle="Checks run before any aggregation">
          <div className="space-y-4">
            <div>
              <div className="label mb-2 flex items-center gap-1.5">
                <ListChecks className="h-3.5 w-3.5" /> Validation rules
              </div>
              {e.data_quality.rules.length === 0 ? (
                <p className="text-sm text-muted">All rules passed: weights within 100%, no negatives, no duplicates, disclosures recent.</p>
              ) : (
                <ul className="space-y-2">
                  {e.data_quality.rules.map((r, i) => (
                    <li key={i} className="flex gap-2.5 text-sm">
                      <Badge tone={r.level === "error" ? "neg" : r.level === "warning" ? "warn" : "info"} className="mt-0.5 shrink-0 self-start capitalize">
                        {r.level}
                      </Badge>
                      <span className="text-muted">{r.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-xl border border-line/60 bg-surface2/30 p-3.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <BrainCircuit className="h-4 w-4 text-accent" /> Autoencoder anomaly check
                </div>
                <Badge tone="warn">Experimental</Badge>
              </div>
              <p className="mt-1 text-xs text-faint">Flags unusual-looking fund snapshots for review — it never alters data.</p>
              {e.data_quality.autoencoder.available ? (
                <>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                    <dt className="text-muted">Model</dt>
                    <dd className="text-right text-ink">{e.data_quality.autoencoder.model}</dd>
                    <dt className="text-muted">Flag threshold (MSE)</dt>
                    <dd className="text-right tnum text-ink">{e.data_quality.autoencoder.threshold?.toFixed(3)}</dd>
                    <dt className="text-muted">Detects synthetic corruptions</dt>
                    <dd className="text-right tnum text-ink">
                      {pct((e.data_quality.autoencoder.validation?.synthetic_corruption_detection_rate ?? 0) * 100, 0)}
                      <span className="text-faint"> of {e.data_quality.autoencoder.validation?.n_corruptions}</span>
                    </dd>
                    <dt className="text-muted">Clean snapshots flagged</dt>
                    <dd className="text-right tnum text-ink">
                      {pct((e.data_quality.autoencoder.validation?.clean_flag_rate ?? 0) * 100, 0)}
                      <span className="text-faint"> of {e.data_quality.autoencoder.validation?.n_schemes}</span>
                    </dd>
                  </dl>
                  <div className="mt-3">
                    {e.data_quality.autoencoder_flags.length ? (
                      <ul className="space-y-1.5">
                        {e.data_quality.autoencoder_flags.map((f) => (
                          <li key={f.scheme_id} className="flex items-center justify-between gap-2 text-sm">
                            <span className="truncate text-ink">{shortFund(f.name)}</span>
                            <Badge tone="warn">Review · {f.error.toFixed(2)}</Badge>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="flex items-center gap-1.5 text-xs text-pos">
                        <ShieldCheck className="h-3.5 w-3.5" /> None of your funds' snapshots look unusual.
                      </p>
                    )}
                  </div>
                  <details className="mt-3 text-xs">
                    <summary className="cursor-pointer text-muted hover:text-ink">Reconstruction error per fund</summary>
                    <ul className="mt-2 space-y-1.5">
                      {Object.entries(e.data_quality.held_scores)
                        .filter(([, s]) => s)
                        .map(([id, s]) => (
                          <li key={id} className="flex items-center gap-2">
                            <span className="w-40 shrink-0 truncate text-muted" title={s!.name}>{shortFund(s!.name)}</span>
                            <ScoreBar value={s!.error} max={Math.max(e.data_quality.autoencoder.threshold ?? 1, s!.error)} tone={s!.flagged ? "warn" : "accent"} className="flex-1" />
                            <span className="w-10 text-right tnum text-faint">{s!.error.toFixed(2)}</span>
                          </li>
                        ))}
                    </ul>
                  </details>
                </>
              ) : (
                <p className="mt-2 text-xs text-muted">{e.data_quality.autoencoder.reason ?? "Not available."}</p>
              )}
            </div>
          </div>
        </Card>
      </div>

      <Card title="How these numbers are built" subtitle="Methodology & limitations">
        <div className="grid gap-4 text-sm text-muted md:grid-cols-3">
          <div className="flex gap-3">
            <FileSearch className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <p>{e.method}</p>
          </div>
          <div className="flex gap-3">
            <Layers className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <p>
              Fund holdings come from a curated, illustrative top-holdings snapshot (disclosure dates shown above), not live AMC feeds. Holdings beyond the itemised list are kept in a separate “not itemised” bucket instead of being guessed.
            </p>
          </div>
          <div className="flex gap-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <p>
              Thresholds ({thr.company_pct}% per company, {thr.sector_pct}% per sector) are your own settings. Crossing one is an observation to understand, not a signal to act on.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
