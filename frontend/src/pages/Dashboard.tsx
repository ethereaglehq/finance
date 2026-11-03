import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowRight, Compass, FileUp, Layers, Newspaper, PlusCircle, Sparkles, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { BarList } from "@/components/charts";
import { displayName, KpiHeader, ValueHistoryCard, type Period } from "@/components/portfolio/common";
import { AllocationDonut, MiniSpark } from "@/components/portfolio/viz";
import {
  Badge,
  Card,
  Delta,
  EmptyState,
  ErrorState,
  InstrumentAvatar,
  LivePill,
  Notice,
  PageHeader,
  ScoreBar,
  Skeleton,
  SourceBadge,
} from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dateTime, inr, inrCompact, num, pct } from "@/lib/format";
import { useChartColors } from "@/lib/theme";
import type { BriefRow, Dashboard as DashboardT } from "@/lib/types";

const CARD_SYMBOLS = ["NIFTY50", "SENSEX", "BANKNIFTY", "GOLD", "SILVER"];
const SHORT_NAMES: Record<string, string> = {
  NIFTY50: "NIFTY 50",
  SENSEX: "SENSEX",
  BANKNIFTY: "BANK NIFTY",
  GOLD: "Gold · ₹/10g",
  SILVER: "Silver · ₹/kg",
};

function MarketCard({ r }: { r: BriefRow }) {
  const isIndex = r.unit === "points";
  return (
    <Link
      to={`/app/compare?ids=${r.id}`}
      className="card group block p-4 transition hover:border-accent/40 hover:shadow-glow focus-visible:shadow-glow"
      aria-label={`${r.name}: ${num(r.price)} (${pct(r.change_pct, 2, true)} today). Open in Compare.`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">{SHORT_NAMES[r.symbol] ?? r.name}</div>
          <div className="mt-1 text-xl font-bold tnum text-ink">{isIndex ? num(r.price) : inr(r.price)}</div>
        </div>
        {r.synthetic ? <Badge tone="warn">Synthetic</Badge> : r.stale ? <Badge tone="warn">Stale</Badge> : null}
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs">
        <Delta value={r.change_pct} />
        {r.week_change_pct !== null && <span className="text-faint">5d {pct(r.week_change_pct, 2, true)}</span>}
      </div>
      <MiniSpark data={r.spark} height={44} className="mt-2" />
    </Link>
  );
}

function MarketRow({ data }: { data?: DashboardT["market"] }) {
  const rows = CARD_SYMBOLS.map((s) => [...(data?.indices ?? []), ...(data?.metals ?? [])].find((r) => r.symbol === s)).filter(Boolean) as BriefRow[];
  const first = rows[0];
  return (
    <section aria-labelledby="mkt-h">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="mkt-h" className="text-[15px] font-semibold">Markets today</h2>
        <div className="flex flex-wrap items-center gap-2">
          {data?.synthetic ? <LivePill tone="warn">Synthetic demo data</LivePill> : <LivePill>Delayed ~15 min</LivePill>}
          {data?.as_of && <span className="text-xs text-faint">as of {dateTime(data.as_of)}</span>}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {!data
          ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[132px] rounded-2xl" />)
          : rows.map((r) => <MarketCard key={r.symbol} r={r} />)}
      </div>
      {first && <SourceBadge className="mt-2" source={first.source} delay="Gold/silver: COMEX × USD/INR international reference" />}
    </section>
  );
}

function StartCards() {
  const items = [
    { to: "/app/portfolio?add=1", icon: PlusCircle, title: "Add a holding", desc: "Stocks, mutual funds, ETFs, gold, silver or an FD — takes a minute." },
    { to: "/app/import", icon: FileUp, title: "Import a statement", desc: "CSV template or CAMS / KFintech / NSDL / CDSL PDF. Reviewed before anything is saved." },
    { to: "/app/compare", icon: Compass, title: "Explore the market", desc: "Compare NIFTY 50, gold and silver in rupees over any period." },
  ];
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {items.map((it) => (
        <Link key={it.to} to={it.to} className="card group flex flex-col p-5 transition hover:border-accent/40 hover:shadow-glow">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent/12 text-accent">
            <it.icon className="h-5 w-5" />
          </span>
          <span className="mt-4 text-[15px] font-semibold">{it.title}</span>
          <span className="mt-1 flex-1 text-sm text-muted">{it.desc}</span>
          <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-accent">
            Start <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
          </span>
        </Link>
      ))}
    </div>
  );
}

function MarketBrief({ m }: { m: DashboardT["market"] }) {
  const mood = m.news_mood;
  const score = mood.score_0_100 ?? Math.round((mood.score + 1) * 50);
  return (
    <Card
      title="Daily market brief"
      subtitle="What moved — facts from stored prices, not predictions"
      actions={
        <Link to="/app/pulse" className="btn-quiet !px-2 !py-1 text-xs">
          Market Pulse <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      }
    >
      <p className="text-sm leading-relaxed text-muted">{m.summary || "Market data is still loading."}</p>
      {mood.n > 0 && (
        <div className="mt-4 rounded-xl border border-line/60 bg-surface2/40 p-3">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-semibold text-ink">Headline tone · last 48h</span>
            <span className={clsx("font-semibold capitalize", mood.label === "positive" ? "text-pos" : mood.label === "negative" ? "text-neg" : "text-muted")}>
              {score} {mood.label}
            </span>
          </div>
          <ScoreBar value={score} tone={mood.label === "positive" ? "pos" : mood.label === "negative" ? "neg" : "warn"} />
          <div className="mt-2 text-[11px] text-faint">
            {mood.counts.positive} positive · {mood.counts.neutral} neutral · {mood.counts.negative} negative of {mood.n} headlines. Describes wording, not direction.
          </div>
        </div>
      )}
    </Card>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const c = useChartColors();
  const [period, setPeriod] = useState<Period>("1Y");
  const q = useQuery({ queryKey: ["dashboard"], queryFn: () => api.get<DashboardT>("/api/dashboard"), refetchInterval: 5 * 60_000 });
  const d = q.data;
  const empty = d && d.totals.holdings === 0;
  const greeting = user?.is_demo ? "Demo portfolio" : user?.name ? `Hi, ${user.name.split(" ")[0]}` : "Your money, at a glance";

  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Dashboard"
        title={greeting}
        subtitle="Everything you hold, what you're really exposed to, and how the market moved — in one private view."
        actions={
          <>
            <Link to="/app/import" className="btn-ghost">
              <FileUp className="h-4 w-4" /> Import
            </Link>
            <Link to="/app/portfolio?add=1" className="btn-primary">
              <PlusCircle className="h-4 w-4" /> Add holding
            </Link>
          </>
        }
      />

      {empty && !user?.is_demo && !user?.preferences?.onboarded && (
        <Notice
          tone="accent"
          icon={<Sparkles className="h-4 w-4" />}
          title="Finish setting up FinLex"
          className="items-center"
        >
          Tell us your risk profile and concentration thresholds so exposure checks match you.{" "}
          <Link to="/app/onboarding" className="font-semibold text-accent hover:underline">
            Start the 2-minute setup →
          </Link>
        </Notice>
      )}

      {empty ? (
        <Card pad={false}>
          <EmptyState icon={<Sparkles className="h-5 w-5" />} title="Your portfolio is empty">
            Add what you own to see your net worth, true company exposure across funds, and how it compares with gold, silver and NIFTY.
          </EmptyState>
          <div className="px-5 pb-5">
            <StartCards />
          </div>
        </Card>
      ) : (
        <KpiHeader totals={d?.totals} loading={!d} />
      )}

      <MarketRow data={d?.market} />

      {!empty && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <ValueHistoryCard className="xl:col-span-2" period={period} onPeriod={setPeriod} />
          <Card title="Allocation" subtitle="By instrument type" actions={<Link to="/app/portfolio" className="btn-quiet !px-2 !py-1 text-xs">Details</Link>}>
            {!d ? (
              <Skeleton className="h-48 w-full" />
            ) : (
              <AllocationDonut
                items={d.allocation.by_type}
                size={168}
                center={
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-faint">Total</div>
                    <div className="text-sm font-bold tnum">{inrCompact(d.totals.value)}</div>
                  </div>
                }
              />
            )}
          </Card>
        </div>
      )}

      {!empty && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Card
            title="True exposure"
            subtitle="Largest companies once your funds are looked through (estimates)"
            actions={
              <Link to="/app/exposure" className="btn-quiet !px-2 !py-1 text-xs">
                <Layers className="h-3.5 w-3.5" /> Explore
              </Link>
            }
          >
            {!d ? (
              <Skeleton className="h-56 w-full" />
            ) : !d.exposure || !d.exposure.companies.length ? (
              <p className="text-sm text-muted">No company exposure yet.</p>
            ) : (
              <div className="space-y-4">
                <BarList
                  items={d.exposure.companies.slice(0, 6).map((co) => ({
                    key: co.key,
                    label: co.name,
                    value: co.pct,
                    sub: `${inrCompact(co.total)} · ${co.direct > 0 ? `direct ${inrCompact(co.direct)} + ` : ""}via ${co.contributors.filter((x) => x.kind === "indirect").length} fund(s)`,
                    segments: [
                      { value: co.direct, name: "Direct", color: c.series[0] },
                      { value: co.indirect, name: "Via funds", color: c.series[2] },
                    ].filter((s) => s.value > 0),
                  }))}
                  max={Math.max(d.exposure.companies[0]?.pct ?? 0, (user?.preferences?.company_threshold_pct ?? 10) * 1.15)}
                  threshold={user?.preferences?.company_threshold_pct ?? 10}
                  valueLabel={(v) => pct(v, 1)}
                />
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-faint">
                  <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: c.series[0] }} />Direct</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: c.series[2] }} />Via funds</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-3 w-[2px] bg-warn" />Your {user?.preferences?.company_threshold_pct ?? 10}% threshold</span>
                </div>
                {d.exposure.flags.map((f) => (
                  <Notice key={f.name} tone="warn" icon={<TriangleAlert className="h-4 w-4" />}>
                    {f.message}
                  </Notice>
                ))}
                {d.exposure.top_overlap[0] && d.exposure.top_overlap[0].overlap_pct >= 30 && (
                  <Link to="/app/exposure" className="block rounded-xl border border-line/70 bg-surface2/40 p-3 text-sm transition hover:border-accent/40">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-ink">Highest fund overlap</span>
                      <Badge tone={d.exposure.top_overlap[0].overlap_pct >= 50 ? "warn" : "neutral"}>{pct(d.exposure.top_overlap[0].overlap_pct, 0)}</Badge>
                    </div>
                    <div className="mt-1 text-xs text-muted">
                      {d.exposure.top_overlap[0].a} & {d.exposure.top_overlap[0].b} share {d.exposure.top_overlap[0].n_common} stocks.
                    </div>
                  </Link>
                )}
              </div>
            )}
          </Card>

          <Card
            title="Top holdings"
            subtitle="By current value"
            actions={
              <Link to="/app/portfolio" className="btn-quiet !px-2 !py-1 text-xs">
                All holdings <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            }
          >
            {!d ? (
              <Skeleton className="h-56 w-full" />
            ) : (
              <ul className="-mx-2 divide-y divide-line/40">
                {d.top_holdings.map((h) => (
                  <li key={h.id}>
                    <Link to={`/app/portfolio/${h.id}`} className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition hover:bg-surface2/60">
                      <InstrumentAvatar symbol={h.instrument.symbol} assetClass={h.instrument.asset_class} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-ink">{displayName(h)}</div>
                        <div className="truncate text-xs text-faint">
                          {h.type_label} · {pct(h.weight, 1)} of portfolio
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold tnum">{inrCompact(h.value)}</div>
                        <Delta value={h.pnl_pct} className="text-xs" />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {d ? <MarketBrief m={d.market} /> : <Skeleton className="h-64 rounded-2xl" />}
        </div>
      )}

      {empty && d && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <MarketBrief m={d.market} />
          <Card title="How FinLex works" subtitle="Understand before acting">
            <ol className="space-y-3 text-sm text-muted">
              {[
                ["Consolidate", "Holdings from every broker, folio and locker in one private view — no broker login."],
                ["Look through", "See the companies inside your funds and where they overlap."],
                ["Compare honestly", "NIFTY, gold and silver in rupees, with forecast ranges and their track record — misses included."],
              ].map(([t, s], i) => (
                <li key={t} className="flex gap-3">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent/12 text-xs font-bold text-accent">{i + 1}</span>
                  <span>
                    <span className="font-semibold text-ink">{t}.</span> {s}
                  </span>
                </li>
              ))}
            </ol>
            <Link to="/app/pulse" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline">
              <Newspaper className="h-4 w-4" /> Read today's market pulse
            </Link>
          </Card>
        </div>
      )}

      {d && !empty && d.issues.length > 0 && (
        <Card title="Data notices" subtitle="Anything that could make a number less reliable">
          <ul className="space-y-2">
            {d.issues.map((i, k) => (
              <li key={k}>
                <Notice tone={i.level === "error" ? "neg" : i.level === "warning" ? "warn" : "info"}>
                  {i.message}{" "}
                  {i.holding_id && (
                    <Link to={`/app/portfolio/${i.holding_id}`} className="font-semibold text-accent hover:underline">
                      View holding
                    </Link>
                  )}
                </Notice>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
