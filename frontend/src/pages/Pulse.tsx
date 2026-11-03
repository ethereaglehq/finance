import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ChevronDown, ExternalLink, FileText, Newspaper, Trash2, Upload } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { Sparkline } from "@/components/charts";
import { InstrumentPicker } from "@/components/InstrumentPicker";
import {
  Badge,
  Button,
  Card,
  Chip,
  Delta,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LivePill,
  Modal,
  Notice,
  PageHeader,
  ScoreBar,
  Select,
  Skeleton,
  SourceBadge,
  Tabs,
  Textarea,
  toast,
  type Tone,
} from "@/components/ui";
import { api, qs } from "@/lib/api";
import { ago, date, num, pct, priceFmt } from "@/lib/format";
import { useChartColors } from "@/lib/theme";
import type { Brief, BriefRow, Filing, InstrumentRef, Mood, NewsItem } from "@/lib/types";

type Tab = "brief" | "news" | "filings";

export default function Pulse() {
  const [sp, setSp] = useSearchParams();
  const tab = (["brief", "news", "filings"].includes(sp.get("tab") || "") ? sp.get("tab") : "brief") as Tab;
  return (
    <div>
      <PageHeader
        eyebrow="Markets"
        title="Market Pulse"
        subtitle="A concise, source-linked summary of what moved in Indian markets, the tone of today's headlines, and plain-language readings of company results."
        actions={<LivePill>Delayed data</LivePill>}
      />
      <Tabs<Tab>
        className="mb-5"
        value={tab}
        onChange={(v) => setSp(v === "brief" ? {} : { tab: v }, { replace: true })}
        items={[
          { value: "brief", label: "Daily brief" },
          { value: "news", label: "News & tone" },
          { value: "filings", label: "Results & filings" },
        ]}
      />
      {tab === "brief" && <BriefTab />}
      {tab === "news" && <NewsTab />}
      {tab === "filings" && <FilingsTab />}
    </div>
  );
}

/* ------------------------------------------------------------------ brief */
function BriefTab() {
  const q = useQuery({ queryKey: ["pulse-brief"], queryFn: () => api.get<Brief>("/api/pulse/brief"), refetchInterval: 5 * 60_000 });
  if (q.isLoading) return <BriefSkeleton />;
  if (q.error) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  const b = q.data!;
  return (
    <div className="space-y-5">
      <section className="card relative overflow-hidden">
        <div className="hero-glow pointer-events-none absolute inset-0" />
        <div className="relative p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <Newspaper className="h-4 w-4 text-accent" />
            <span className="label !text-accent">Today in Indian markets</span>
            <Badge tone={b.summary_engine.startsWith("claude") ? "accent" : "neutral"}>
              {b.summary_engine.startsWith("claude") ? "AI-written · numbers validated" : "Template from verified prices"}
            </Badge>
            {b.synthetic && <Badge tone="warn">Synthetic demo data</Badge>}
          </div>
          <p className="mt-3 max-w-4xl text-[15px] leading-relaxed text-ink sm:text-base">{b.summary || "Market data is still loading."}</p>
          <SourceBadge className="mt-4" asOf={b.as_of} source="Exchange & reference prices as labelled per row" delay="Describes what moved, not why" />
        </div>
      </section>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-ink">Indices</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {b.indices.map((r) => <QuoteCard key={r.id} r={r} />)}
        </div>
      </div>
      <div>
        <h2 className="mb-3 text-sm font-semibold text-ink">Gold & silver (INR)</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {b.metals.map((r) => <QuoteCard key={r.id} r={r} />)}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card title="Largest moves in NIFTY 50" subtitle="Day change, factual only" className="lg:col-span-1">
          <MoverList title="Up the most" rows={b.gainers} />
          <div className="my-4 h-px bg-line/60" />
          <MoverList title="Down the most" rows={b.losers} />
        </Card>
        <Card title="Sector moves" subtitle="Average day change of NIFTY 50 stocks per sector" className="lg:col-span-1">
          {b.sectors.length ? <DivergingBars items={b.sectors.map((s) => ({ label: s.sector, value: s.avg_change_pct, sub: `${s.n} stock${s.n > 1 ? "s" : ""}` }))} /> : <EmptyState title="No sector data yet" />}
        </Card>
        <div className="space-y-5">
          <Card title="Market breadth" subtitle="NIFTY 50 constituents today">
            <Breadth {...b.breadth} />
          </Card>
          <Card title="Headline tone" subtitle="Last 48 hours · language signal, not a forecast">
            <MoodGauge mood={b.news_mood} />
          </Card>
        </div>
      </div>
      <ul className="space-y-1 text-xs text-faint">
        {b.notes.map((n) => <li key={n}>• {n}</li>)}
      </ul>
    </div>
  );
}

function BriefSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-40 w-full rounded-2xl" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-72 rounded-2xl" />)}
      </div>
    </div>
  );
}

function QuoteCard({ r }: { r: BriefRow }) {
  return (
    <div className="card p-4" title={`${r.source} · ${r.delay_note}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">{r.symbol}</div>
          <div className="truncate text-[11px] text-faint">{r.name}</div>
        </div>
        {r.synthetic ? <Badge tone="warn">Synthetic</Badge> : r.stale ? <Badge tone="warn">Stale</Badge> : null}
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div>
          <div className="text-xl font-bold tnum text-ink">{priceFmt(r.price, r.unit)}</div>
          <div className="mt-0.5 flex items-center gap-2 text-xs">
            <Delta value={r.change_pct} />
            <span className="text-faint">5d</span>
            <Delta value={r.week_change_pct} arrow={false} />
          </div>
        </div>
        <Sparkline data={r.spark} className="max-w-[120px]" height={44} />
      </div>
      <div className="mt-2 text-[10px] text-faint">{r.unit === "points" ? "Index points" : r.unit} · {ago(r.as_of)}</div>
    </div>
  );
}

function MoverList({ title, rows }: { title: string; rows: Brief["gainers"] }) {
  return (
    <div>
      <div className="label mb-2">{title}</div>
      {rows.length === 0 ? (
        <div className="text-sm text-muted">No data</div>
      ) : (
        <ul className="space-y-2">
          {rows.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 text-sm">
              <div className="min-w-0">
                <div className="font-semibold text-ink">{m.symbol}</div>
                <div className="truncate text-xs text-faint">{m.name}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="tnum text-ink">{priceFmt(m.price)}</div>
                <Delta value={m.change_pct} className="text-xs" />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Diverging horizontal bars around a zero line: positive right (gain hue), negative left (loss hue); signed labels in text ink. */
function DivergingBars({ items }: { items: { label: string; value: number; sub?: string }[] }) {
  const c = useChartColors();
  const max = Math.max(...items.map((i) => Math.abs(i.value)), 0.01);
  return (
    <ul className="space-y-2">
      {items.map((it) => {
        const w = (Math.abs(it.value) / max) * 50;
        const pos = it.value >= 0;
        return (
          <li key={it.label} title={`${it.label}: ${pct(it.value, 2, true)}${it.sub ? ` (${it.sub})` : ""}`}>
            <div className="mb-0.5 flex items-baseline justify-between gap-2 text-xs">
              <span className="min-w-0 truncate text-muted">{it.label}</span>
              <span className="shrink-0 font-semibold tnum text-ink">{pct(it.value, 2, true)}</span>
            </div>
            <div className="relative h-2 w-full rounded-full bg-surface2">
              <div className="absolute left-1/2 top-[-2px] h-3 w-px bg-line" />
              <div
                className={clsx("absolute top-0 h-2", pos ? "rounded-r-full" : "rounded-l-full")}
                style={{ width: `${Math.max(w, 0.8)}%`, left: pos ? "50%" : `${50 - w}%`, background: pos ? c.pos : c.neg }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Breadth({ advancers, decliners, unchanged }: { advancers: number; decliners: number; unchanged: number }) {
  const c = useChartColors();
  const total = advancers + decliners + unchanged || 1;
  const segs = [
    { label: "Advanced", n: advancers, color: c.pos },
    { label: "Unchanged", n: unchanged, color: c.muted },
    { label: "Declined", n: decliners, color: c.neg },
  ];
  return (
    <div>
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full bg-surface2" role="img" aria-label={`${advancers} advanced, ${unchanged} unchanged, ${decliners} declined`}>
        {segs.map((s) => s.n > 0 && <div key={s.label} style={{ width: `${(s.n / total) * 100}%`, background: s.color }} title={`${s.label}: ${s.n}`} />)}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        {segs.map((s) => (
          <div key={s.label}>
            <div className="text-lg font-bold tnum text-ink">{s.n}</div>
            <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted">
              <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
              {s.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const moodTone: Record<string, Tone> = { positive: "pos", negative: "neg", neutral: "neutral" };

function MoodGauge({ mood }: { mood: Mood }) {
  const score = mood.score_0_100 ?? Math.round((mood.score + 1) * 50);
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <div className="text-sm text-muted">Tone score</div>
        <div className="text-sm">
          <span className="text-lg font-bold tnum text-ink">{score}</span>
          <span className="text-faint"> / 100</span>{" "}
          <Badge tone={moodTone[mood.label]} className="ml-1 capitalize">{mood.label}</Badge>
        </div>
      </div>
      <ScoreBar className="mt-2" value={score} tone={moodTone[mood.label] === "neutral" ? "warn" : moodTone[mood.label]} />
      <div className="mt-2 flex justify-between text-[10px] text-faint">
        <span>0 · negative wording</span>
        <span>100 · positive wording</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <Chip tone="pos">{mood.counts.positive} positive</Chip>
        <Chip>{mood.counts.neutral} neutral</Chip>
        <Chip tone="neg">{mood.counts.negative} negative</Chip>
      </div>
      <div className="mt-2 text-[11px] text-faint">Based on {mood.n} headline{mood.n === 1 ? "" : "s"}.</div>
    </div>
  );
}

/* ------------------------------------------------------------------ news */
function NewsTab() {
  const [hours, setHours] = useState(72);
  const [symbol, setSymbol] = useState<string | null>(null);
  const [shown, setShown] = useState(20);
  const all = useQuery({
    queryKey: ["pulse-news", hours],
    queryFn: () => api.get<{ items: NewsItem[]; mood: Mood; model: string; note: string }>(`/api/pulse/news${qs({ hours, limit: 200 })}`),
  });
  const filtered = useQuery({
    queryKey: ["pulse-news", hours, symbol],
    queryFn: () => api.get<{ items: NewsItem[]; mood: Mood; model: string; note: string }>(`/api/pulse/news${qs({ hours, limit: 200, symbol })}`),
    enabled: !!symbol,
  });
  const entityCounts = useMemo(() => {
    const m = new Map<string, number>();
    (all.data?.items ?? []).forEach((n) => n.entities.forEach((e) => m.set(e, (m.get(e) || 0) + 1)));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
  }, [all.data]);
  const data = symbol ? filtered.data : all.data;
  const loading = symbol ? filtered.isLoading : all.isLoading;
  const err = symbol ? filtered.error : all.error;
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-36">
            <Select value={hours} onChange={(e) => setHours(Number(e.target.value))} aria-label="Time window">
              <option value={24}>Last 24 hours</option>
              <option value={72}>Last 3 days</option>
              <option value={168}>Last 7 days</option>
              <option value={336}>Last 14 days</option>
            </Select>
          </div>
          <button onClick={() => (setSymbol(null), setShown(20))} className={clsx("rounded-full border px-3 py-1 text-xs font-medium transition", !symbol ? "border-accent/40 bg-accent/15 text-accent" : "border-line text-muted hover:text-ink")}>
            All headlines
          </button>
          {entityCounts.map(([e, n]) => (
            <button key={e} onClick={() => (setSymbol(e === symbol ? null : e), setShown(20))} aria-pressed={e === symbol}
              className={clsx("rounded-full border px-3 py-1 text-xs font-medium transition", e === symbol ? "border-accent/40 bg-accent/15 text-accent" : "border-line text-muted hover:text-ink")}>
              {e} <span className="text-faint">{n}</span>
            </button>
          ))}
        </div>
        <Card pad={false}>
          {loading ? (
            <div className="space-y-3 p-5">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
          ) : err ? (
            <ErrorState error={err} />
          ) : !data?.items.length ? (
            <EmptyState icon={<Newspaper className="h-5 w-5" />} title="No headlines in this window">Try a longer time window or clear the filter.</EmptyState>
          ) : (
            <>
              <ul className="divide-y divide-line/50">
                {data.items.slice(0, shown).map((n) => <NewsRow key={n.id} n={n} />)}
              </ul>
              <div className="flex items-center justify-between gap-3 border-t border-line/50 px-4 py-3 text-xs text-faint sm:px-5">
                <span>Showing {Math.min(shown, data.items.length)} of {data.items.length} headlines</span>
                {shown < data.items.length && (
                  <Button variant="ghost" size="sm" onClick={() => setShown((n) => n + 20)}>Show more</Button>
                )}
              </div>
            </>
          )}
        </Card>
      </div>
      <div className="space-y-5 lg:sticky lg:top-20 lg:self-start">
        <Card title={symbol ? `Tone · ${symbol}` : "Overall tone"} subtitle={data?.note}>
          {data ? <MoodGauge mood={data.mood} /> : <Skeleton className="h-28 w-full" />}
          {data && <div className="mt-3 text-[11px] text-faint">Model: {data.model}</div>}
        </Card>
        <SentimentEval />
      </div>
    </div>
  );
}

function NewsRow({ n }: { n: NewsItem }) {
  const t = moodTone[n.sentiment.label];
  return (
    <li className="px-4 py-3.5 sm:px-5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-faint">
        <span className="font-medium text-muted">{n.publisher}</span>
        <span>· {ago(n.published_at)}</span>
        {n.is_sample && <Badge tone="warn">Sample</Badge>}
      </div>
      <div className="mt-1 flex items-start justify-between gap-3">
        {n.url ? (
          <a href={n.url} target="_blank" rel="noopener noreferrer" className="group min-w-0 text-[15px] font-medium leading-snug text-ink hover:text-accent">
            {n.headline}
            <ExternalLink className="ml-1 inline h-3.5 w-3.5 opacity-50 group-hover:opacity-100" aria-label="opens publisher site" />
          </a>
        ) : (
          <span className="min-w-0 text-[15px] font-medium leading-snug text-ink">{n.headline}</span>
        )}
        <Badge tone={t} className="shrink-0 capitalize" >{n.sentiment.label} {n.sentiment.score > 0 ? "+" : ""}{num(n.sentiment.score, 2)}</Badge>
      </div>
      {n.summary && n.summary !== "Sample headline for offline demo." && <p className="mt-1 line-clamp-2 text-sm text-muted">{n.summary}</p>}
      {n.entities.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {n.entities.map((e) => <Badge key={e} tone="accent">{e}</Badge>)}
        </div>
      )}
    </li>
  );
}

function SentimentEval() {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["sentiment-eval"],
    queryFn: () => api.get<{ accuracy: number; n: number; model: string; rows: { text: string; gold: string; pred: string }[] }>("/api/pulse/sentiment-eval"),
    enabled: open,
    staleTime: Infinity,
  });
  return (
    <Card pad={false}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left">
        <div>
          <div className="text-[15px] font-semibold text-ink">How accurate is the tone model?</div>
          <div className="text-xs text-muted">Checked against hand-labelled headlines</div>
        </div>
        <ChevronDown className={clsx("h-4 w-4 shrink-0 text-faint transition", open && "rotate-180")} />
      </button>
      {open && (
        <div className="border-t border-line/60 px-5 pb-5 pt-4">
          {q.isLoading ? <Skeleton className="h-24 w-full" /> : q.error ? <ErrorState error={q.error} /> : q.data && (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold tnum text-ink">{pct(q.data.accuracy * 100, 0)}</span>
                <span className="text-sm text-muted">correct on {q.data.n} labelled headlines</span>
              </div>
              <p className="mt-1 text-xs text-faint">{q.data.model}. A small test set — treat accuracy as indicative, and remember tone describes wording, not where prices go.</p>
              <div className="mt-3 max-h-80 overflow-y-auto">
                <table className="table-base">
                  <thead><tr><th>Headline</th><th>Label</th><th>Model</th></tr></thead>
                  <tbody>
                    {q.data.rows.map((r) => (
                      <tr key={r.text}>
                        <td className="!py-2 text-xs text-ink">{r.text}</td>
                        <td className="!py-2"><Badge tone={moodTone[r.gold]} className="capitalize">{r.gold}</Badge></td>
                        <td className="!py-2">
                          <Badge tone={r.gold === r.pred ? moodTone[r.pred] : "warn"} className="capitalize">{r.pred}{r.gold !== r.pred ? " ✕" : ""}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ filings */
function FilingsTab() {
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<number | null>(null);
  const list = useQuery({ queryKey: ["filings"], queryFn: () => api.get<Filing[]>("/api/pulse/filings") });
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
      <div className="space-y-3 lg:col-span-3">
        <Card title="Results documents" subtitle="Facts are extracted from the document text; interpretation is kept separate." pad={false}>
          {list.isLoading ? (
            <div className="space-y-3 p-5">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
          ) : list.error ? (
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          ) : !list.data?.length ? (
            <EmptyState icon={<FileText className="h-5 w-5" />} title="No filings yet">Upload an NSE/BSE results PDF or paste the results table to get a plain-language reading.</EmptyState>
          ) : (
            <ul className="divide-y divide-line/50">
              {list.data.map((f) => {
                const rev = f.facts.metrics.revenue;
                const np = f.facts.metrics.net_profit;
                return (
                  <li key={f.id}>
                    <button onClick={() => setOpenId(f.id)} className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition hover:bg-surface2/50 sm:px-5">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent"><FileText className="h-4 w-4" /></span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-ink">{f.issuer}</span>
                          {f.is_sample && <Badge tone="warn">Synthetic sample</Badge>}
                          {f.private && <Badge>Private upload</Badge>}
                        </div>
                        <div className="mt-0.5 text-xs text-faint">{f.filing_type} · {f.period || "Period not detected"} · added {date(f.published_at)}</div>
                        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                          {rev && <span>Revenue YoY <Delta value={rev.yoy_pct} digits={1} className="text-xs" /></span>}
                          {np && <span>Net profit YoY <Delta value={np.yoy_pct} digits={1} className="text-xs" /></span>}
                          {f.facts.missing.length > 0 && <span className="text-faint">{f.facts.missing.length} item(s) not found</span>}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
      <div className="lg:col-span-2">
        <UploadFiling onDone={(id) => (qc.invalidateQueries({ queryKey: ["filings"] }), setOpenId(id))} />
      </div>
      <FilingModal id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

function UploadFiling({ onDone }: { onDone: (id: number) => void }) {
  const [issuer, setIssuer] = useState("");
  const [period, setPeriod] = useState("");
  const [source, setSource] = useState("");
  const [inst, setInst] = useState<InstrumentRef | null>(null);
  const [mode, setMode] = useState<"file" | "text">("file");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const m = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.set("issuer", issuer.trim());
      fd.set("period", period.trim());
      fd.set("source_uri", source.trim());
      if (inst) fd.set("instrument_id", String(inst.id));
      if (mode === "file" && file) fd.set("file", file);
      if (mode === "text") fd.set("text", text);
      return api.upload<Filing>("/api/pulse/filings", fd);
    },
    onSuccess: (f) => {
      toast("Filing analysed");
      setIssuer(""); setPeriod(""); setSource(""); setInst(null); setFile(null); setText("");
      onDone(f.id);
    },
  });
  const ready = issuer.trim().length >= 2 && (mode === "file" ? !!file : text.trim().length > 20) && (!source || /^https?:\/\//.test(source));
  return (
    <Card title="Analyse a results document" subtitle="PDF or text from NSE/BSE. Stays private to your account.">
      <form className="space-y-3.5" onSubmit={(e) => { e.preventDefault(); if (ready) m.mutate(); }}>
        {m.error && <Notice tone="neg">{(m.error as Error).message}</Notice>}
        <Field label="Company / issuer">
          <Input value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="e.g. Infosys Ltd" required minLength={2} maxLength={200} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Period (optional)"><Input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="Q2 FY27" /></Field>
          <Field label="Source link (optional)" error={source && !/^https?:\/\//.test(source) ? "Must start with https://" : null}>
            <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="https://nsearchives…" inputMode="url" />
          </Field>
        </div>
        <Field group label="Link to a listed stock (optional)" hint={inst ? undefined : "Enables 'new filing' alerts for this stock."}>
          {inst ? (
            <div className="flex items-center justify-between rounded-lg border border-line bg-surface2/60 px-3 py-2 text-sm">
              <span className="truncate">{inst.name} <span className="text-faint">({inst.symbol})</span></span>
              <button type="button" className="text-xs text-accent hover:underline" onClick={() => setInst(null)}>Change</button>
            </div>
          ) : (
            <InstrumentPicker assetClass="equity" onSelect={setInst} placeholder="Search a stock…" />
          )}
        </Field>
        <Tabs<"file" | "text"> size="sm" value={mode} onChange={setMode} items={[{ value: "file", label: "Upload PDF / TXT" }, { value: "text", label: "Paste text" }]} />
        {mode === "file" ? (
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-surface2/40 px-4 py-6 text-center text-sm text-muted transition hover:border-accent/50">
            <Upload className="h-5 w-5 text-accent" />
            {file ? <span className="font-medium text-ink">{file.name} <span className="text-faint">({(file.size / 1024).toFixed(0)} KB)</span></span> : <span>Choose a PDF or .txt file (max 5 MB)</span>}
            <input type="file" accept=".pdf,.txt,application/pdf,text/plain" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
        ) : (
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} className="font-mono text-xs" placeholder={"Revenue from operations  4,820.50  4,512.30  4,210.75\nNet profit for the period  525.30  488.90  452.10\nBasic EPS (Rs.)  13.13  12.22  11.30"} />
        )}
        <Button type="submit" className="w-full" loading={m.isPending} disabled={!ready}>Analyse document</Button>
        <p className="text-[11px] text-faint">FinLex extracts reported figures only; missing items are reported as missing, never estimated.</p>
      </form>
    </Card>
  );
}

function FilingModal({ id, onClose }: { id: number | null; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["filing", id], queryFn: () => api.get<Filing>(`/api/pulse/filings/${id}`), enabled: id !== null });
  const del = useMutation({
    mutationFn: () => api.del(`/api/pulse/filings/${id}`),
    onSuccess: () => {
      toast("Filing deleted");
      qc.invalidateQueries({ queryKey: ["filings"] });
      onClose();
    },
  });
  const f = q.data;
  return (
    <Modal open={id !== null} onClose={onClose} wide title={f ? f.issuer : "Filing"}
      footer={f && (
        <>
          {f.private && (
            <Button variant="danger" size="sm" loading={del.isPending} onClick={() => window.confirm("Delete this filing from your account?") && del.mutate()}>
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </>
      )}>
      {q.isLoading ? <Skeleton className="h-64 w-full" /> : q.error ? <ErrorState error={q.error} /> : f && <FilingDetail f={f} />}
    </Modal>
  );
}

function fmtVal(v: number | null | undefined) {
  return v === null || v === undefined ? "—" : num(v, 2);
}

function FilingDetail({ f }: { f: Filing }) {
  const metrics = Object.entries(f.facts.metrics);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>{f.filing_type}</span>
        <span>· {f.period || "Period not detected"}</span>
        {f.is_sample && <Badge tone="warn">Synthetic sample — not a real company</Badge>}
        {f.private && <Badge>Private upload</Badge>}
      </div>

      <section>
        <SectionHead title="Reported facts" right={<Badge>Unit: {f.facts.unit}</Badge>} />
        {metrics.length === 0 ? (
          <Notice tone="warn" title="No standard line items found">The document text didn't contain recognisable result rows. Check the source document.</Notice>
        ) : (
          <div className="-mx-1 overflow-x-auto">
            <table className="table-base min-w-[620px]">
              <thead>
                <tr><th>Metric</th><th className="!text-right">Current</th><th className="!text-right">Prev. qtr</th><th className="!text-right">Year-ago</th><th className="!text-right">QoQ</th><th className="!text-right">YoY</th></tr>
              </thead>
              <tbody>
                {metrics.map(([k, m]) => (
                  <tr key={k}>
                    <td>
                      <div className="font-medium text-ink">{m.label}</div>
                      <div className="mt-0.5 max-w-[260px] truncate font-mono text-[10px] text-faint" title={m.evidence}>“{m.evidence}”</div>
                    </td>
                    <td className="text-right tnum font-semibold">{fmtVal(m.current)}</td>
                    <td className="text-right tnum text-muted">{fmtVal(m.previous_quarter)}</td>
                    <td className="text-right tnum text-muted">{fmtVal(m.year_ago_quarter)}</td>
                    <td className="text-right"><Delta value={m.qoq_pct} digits={1} arrow={false} /></td>
                    <td className="text-right"><Delta value={m.yoy_pct} digits={1} arrow={false} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Notice tone="warn">{f.facts.column_assumption}</Notice>
          <div className="space-y-2 rounded-xl border border-line/70 bg-surface2/40 px-3.5 py-3 text-sm">
            <div className="flex justify-between"><span className="text-muted">Net margin</span><span className="font-semibold tnum">{f.facts.net_margin_pct === null ? "—" : pct(f.facts.net_margin_pct, 1)}</span></div>
            <div className="text-xs text-muted">
              {f.facts.missing.length ? <>Not found in the text: <span className="text-ink">{f.facts.missing.join(", ")}</span></> : "All standard line items were found."}
            </div>
          </div>
        </div>
      </section>

      {f.facts.risk_mentions.length > 0 && (
        <section>
          <SectionHead title="Mentions worth reading in the source" />
          <ul className="space-y-2">
            {f.facts.risk_mentions.map((r) => (
              <li key={r.term} className="rounded-lg border border-line/60 bg-surface2/40 px-3 py-2">
                <Badge tone="warn" className="capitalize">{r.term}</Badge>
                <p className="mt-1 font-mono text-[11px] leading-relaxed text-muted">…{r.snippet}…</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-xl border border-accent/25 bg-accent/[0.05] p-4">
        <SectionHead title="Interpretation" right={<Badge tone="accent">Separate from reported facts</Badge>} />
        <div className="label mb-1">Plain-language reading (template from extracted facts)</div>
        <p className="text-sm leading-relaxed text-ink">{f.summary.reported}</p>
        {f.summary.interpretation && (
          <div className="mt-4 border-t border-line/60 pt-3">
            <div className="mb-1 flex items-center gap-2">
              <span className="label">AI-generated</span>
              <Badge tone="accent">Validated against extracted facts</Badge>
            </div>
            <p className="whitespace-pre-line text-sm leading-relaxed text-ink">{f.summary.interpretation}</p>
          </div>
        )}
        <p className="mt-3 text-[11px] text-faint">Verify every figure against the source filing. This is not a view on the stock.</p>
      </section>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-faint">
        {f.source_uri ? (
          <a href={f.source_uri} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
            Source document <ExternalLink className="h-3 w-3" />
          </a>
        ) : (
          <span>No source link recorded</span>
        )}
        <span className="break-all font-mono">SHA-256 {f.checksum.slice(0, 16)}…</span>
        <span>Analysed {date(f.published_at)}</span>
      </div>
    </div>
  );
}

function SectionHead({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <div className="mb-2.5 flex items-center justify-between gap-3">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {right}
    </div>
  );
}
