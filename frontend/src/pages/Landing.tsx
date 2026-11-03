/* Marketing landing page — StockWisp's hero/feature/FAQ rhythm, re-cut for FinLex's honest, India-first story. */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  ArrowRight,
  BadgeCheck,
  BookOpen,
  Bot,
  ChartCandlestick,
  Check,
  ChevronDown,
  Eye,
  FileText,
  History,
  Layers,
  Lock,
  Moon,
  Newspaper,
  ShieldCheck,
  Sparkles,
  Sun,
  Wallet,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Logo } from "@/components/Logo";
import { Badge, Chip, ScoreBar } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import type { User } from "@/lib/types";

function useDemo() {
  const qc = useQueryClient();
  const nav = useNavigate();
  return useMutation({
    mutationFn: () => api.post<{ user: User }>("/api/auth/demo"),
    onSuccess: (d) => {
      qc.clear();
      qc.setQueryData(["me"], { user: d.user });
      nav("/app");
    },
  });
}

function BetaBar() {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem("finlex-beta-dismissed") !== "1";
    } catch {
      return true;
    }
  });
  if (!open) return null;
  return (
    <div className="border-b border-line/60 bg-surface/70">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-2 text-[13px]">
        <span className="flex items-center gap-2 text-muted">
          <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent">Beta</span>
          FinLex is in beta. Market data is delayed, forecasts are experimental, and we publish every miss.
        </span>
        <button
          className="rounded-md border border-line px-2 py-0.5 text-xs text-muted hover:text-ink"
          onClick={() => {
            setOpen(false);
            try {
              localStorage.setItem("finlex-beta-dismissed", "1");
            } catch {
              /* ignore */
            }
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}

function Nav() {
  const { user } = useAuth();
  const { theme, toggle } = useTheme();
  return (
    <header className="sticky top-0 z-30 border-b border-line/50 bg-bg/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Link to="/" aria-label="FinLex home"><Logo /></Link>
        <nav className="hidden items-center gap-7 text-sm text-muted md:flex">
          <a href="#features" className="hover:text-ink">Features</a>
          <a href="#how" className="hover:text-ink">How it works</a>
          <a href="#honesty" className="hover:text-ink">Honesty</a>
          <a href="#faq" className="hover:text-ink">FAQ</a>
        </nav>
        <div className="flex items-center gap-2">
          <button className="btn-quiet !p-2" onClick={toggle} aria-label="Toggle theme">
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          {!user && <Link to="/login" className="btn-quiet hidden sm:inline-flex">Sign in</Link>}
          <Link to={user ? "/app" : "/register"} className="btn-light">
            {user ? "Open app" : "Get started"} <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </header>
  );
}

/* --- illustrative product preview (static, clearly labelled) --- */
function PreviewIndex({ name, value, change, up, points }: { name: string; value: string; change: string; up: boolean; points: string }) {
  return (
    <div className="rounded-xl border border-line/70 bg-surface2/60 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-faint">{name}</div>
      <div className="mt-0.5 flex items-end justify-between gap-2">
        <div>
          <div className="text-[15px] font-bold tnum">{value}</div>
          <div className={clsx("text-[11px] font-semibold", up ? "text-pos" : "text-neg")}>{change}</div>
        </div>
        <svg viewBox="0 0 80 28" className="h-7 w-20" aria-hidden>
          <polyline points={points} fill="none" strokeWidth="1.75" className={up ? "stroke-pos" : "stroke-neg"} strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}

function HeroPreview() {
  return (
    <div className="relative">
      <div className="absolute -inset-6 rounded-[28px] bg-accent/10 blur-3xl" aria-hidden />
      <div className="relative rounded-2xl border border-line bg-surface p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold"><Wallet className="h-4 w-4 text-accent" /> Dashboard</div>
          <Badge tone="neutral">Illustrative preview</Badge>
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          <div className="col-span-3 grid grid-cols-3 gap-2.5 rounded-xl border border-line/70 bg-surface2/40 p-3">
            <div><div className="label !text-[10px]">Net worth</div><div className="text-lg font-bold tnum">₹18.4L</div></div>
            <div><div className="label !text-[10px]">XIRR</div><div className="text-lg font-bold tnum text-pos">12.6%</div></div>
            <div><div className="label !text-[10px]">Today</div><div className="text-lg font-bold tnum text-pos">+₹11.7K</div></div>
          </div>
          <PreviewIndex name="NIFTY 50" value="23,810" change="+1.58%" up points="0,20 12,18 22,21 34,14 46,16 58,9 70,11 80,5" />
          <PreviewIndex name="Gold ₹/10g" value="1,20,208" change="−0.76%" up={false} points="0,6 12,9 24,7 36,12 48,10 60,16 70,14 80,19" />
          <PreviewIndex name="Silver ₹/kg" value="1,51,463" change="−2.13%" up={false} points="0,4 14,8 24,6 36,13 48,11 58,18 70,17 80,22" />
        </div>
        <div className="mt-3 rounded-xl border border-line/70 bg-surface2/40 p-3">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-semibold">True exposure</span>
            <span className="text-faint">look-through · est.</span>
          </div>
          {[
            ["HDFC Bank", 10.4, true],
            ["ICICI Bank", 7.1, false],
            ["Reliance", 3.4, false],
          ].map(([n, v, flag]) => (
            <div key={n as string} className="mb-2 last:mb-0">
              <div className="mb-1 flex justify-between text-[12px]">
                <span className="flex items-center gap-1.5">{n as string}{flag && <Badge tone="warn">above 10%</Badge>}</span>
                <span className="font-semibold tnum">{(v as number).toFixed(1)}%</span>
              </div>
              <ScoreBar value={v as number} max={12} tone={flag ? "warn" : "accent"} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const FEATURES: { icon: typeof Wallet; title: string; body: string }[] = [
  { icon: Wallet, title: "One private portfolio", body: "Stocks, mutual funds, ETFs, physical gold & silver and FDs in one view — XIRR, allocation and day change, with every price's source and timestamp." },
  { icon: Layers, title: "True exposure & overlap", body: "Look inside your funds. See that you effectively hold 10% in one bank once five funds are added up, and which funds overlap." },
  { icon: ChartCandlestick, title: "Compare in ₹", body: "NIFTY 50, sector indices, stocks, gold and silver on the same dates, normalised — returns, volatility, drawdowns and correlation." },
  { icon: History, title: "Forecasts with a track record", body: "Ridge and XGBoost ranges, calibrated and benchmarked against a no-change baseline. Every forecast is logged — misses included." },
  { icon: Newspaper, title: "Market Pulse", body: "A factual daily brief built from verified prices, headline tone, and plain-English quarterly-results summaries that separate facts from interpretation." },
  { icon: Bot, title: "Ask FinLex & Plan", body: "Ask about your own data with cited answers. Explore allocations that satisfy your constraints. It will never hand you a stock tip." },
];

const COMPARE_ROWS: [string, boolean, boolean][] = [
  ["India-first, everything in ₹", true, false],
  ["Mutual-fund look-through & overlap", true, false],
  ["Gold & silver vs equities, like-for-like", true, false],
  ["Forecasts shown as tested ranges", true, false],
  ["Public track record including misses", true, false],
  ["Explains its reasoning & cites data", true, false],
  ["No buy/sell tips (SEBI-safe design)", true, false],
  ["No broker login or order permission", true, false],
];

const FAQ: [string, ReactNode][] = [
  ["Is FinLex free?", "Yes, during beta. A future paid tier may add deeper imports and history; core portfolio tracking stays free. We will never monetise by routing trades or recommending products."],
  ["Do you give stock tips or buy/sell calls?", "No. FinLex isn't a SEBI-registered investment adviser, and personalised advice requires one. It explains what you own, what the data says and how uncertain estimates are — the decisions stay yours."],
  ["Do I need to connect my broker?", "No. Add holdings manually, upload a CSV, or import a CAMS/KFintech or NSDL/CDSL statement PDF. We never ask for broker passwords, OTPs or trading permissions."],
  ["What happens to my statement PDF?", "It's parsed in memory to show you a review screen, then discarded — never written to disk. After you confirm, even the preview rows are deleted."],
  ["Where does the data come from?", "Delayed NSE/BSE prices via Yahoo Finance, AMFI NAVs, and gold/silver references from COMEX futures converted to INR. Every screen shows the source, the delay and the as-of time."],
  ["How accurate are the forecasts?", "Often not much better than \"no change\" — and FinLex says so. The Track Record page shows hit rates against the stated 80% ranges, error versus the naïve baseline, and every miss."],
];

function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      {FAQ.map(([q, a], i) => (
        <div key={q} className="card overflow-hidden">
          <button className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-[15px] font-medium" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
            {q}
            <ChevronDown className={clsx("h-4 w-4 shrink-0 text-muted transition", open === i && "rotate-180")} />
          </button>
          {open === i && <div className="px-5 pb-5 text-sm leading-relaxed text-muted animate-fadein">{a}</div>}
        </div>
      ))}
    </div>
  );
}

export default function Landing() {
  const demo = useDemo();
  const { user } = useAuth();
  useEffect(() => {
    document.title = "FinLex — honest money intelligence for Indian investors";
  }, []);
  const demoBtn = user ? (
    <Link to="/app" className="btn-light !px-4 !py-2.5">
      Open your dashboard <ArrowRight className="h-4 w-4" />
    </Link>
  ) : (
    <button className="btn-light !px-4 !py-2.5" onClick={() => demo.mutate()} disabled={demo.isPending}>
      {demo.isPending ? "Preparing demo…" : "Try the live demo"} <ArrowRight className="h-4 w-4" />
    </button>
  );
  return (
    <div className="min-h-screen">
      <BetaBar />
      <Nav />
      <main>
        {/* hero */}
        <section className="relative overflow-hidden">
          <div className="hero-glow pointer-events-none absolute inset-0" />
          <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-14 lg:grid-cols-[1.05fr_1fr] lg:pt-20">
            <div>
              <Chip tone="accent" className="!gap-1.5"><Sparkles className="mr-1 h-3.5 w-3.5" /> Free during beta — jump in</Chip>
              <h1 className="mt-5 text-[40px] font-bold leading-[1.05] tracking-tight sm:text-[52px]">
                See what you really own.
                <br />
                Hear the market <span className="bg-gradient-to-r from-[#5b9bff] to-[#2f7cf6] bg-clip-text text-transparent">honestly</span>.
              </h1>
              <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-muted">
                FinLex brings your stocks, mutual funds, ETFs, gold, silver and FDs into one private view, looks through your funds to show your{" "}
                <b className="text-ink">true exposure</b>, compares NIFTY, gold and silver in ₹, and shows forecasts as ranges — with a public record of every{" "}
                <b className="text-ink">miss</b>.
              </p>
              <div className="mt-7 flex flex-wrap items-center gap-3">
                {demoBtn}
                {!user && <Link to="/register" className="btn-ghost !px-4 !py-2.5">Create free account</Link>}
              </div>
              {demo.error && <p className="mt-3 text-sm text-neg">{(demo.error as Error).message}</p>}
              <div className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-muted">
                <span className="flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-pos" /> No broker login</span>
                <span className="flex items-center gap-1.5"><BadgeCheck className="h-4 w-4 text-pos" /> No buy/sell tips</span>
                <span className="flex items-center gap-1.5"><Eye className="h-4 w-4 text-pos" /> Misses published</span>
              </div>
            </div>
            <HeroPreview />
          </div>
        </section>

        {/* features */}
        <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Clarity that actually helps you understand</h2>
            <p className="mt-3 text-muted">Inspired by crisp, developer-grade UX — built for Indian investors.</p>
          </div>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="card group p-5 transition hover:border-accent/40">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent/10 text-accent ring-1 ring-accent/20"><f.icon className="h-5 w-5" /></div>
                <h3 className="mt-4 font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* how it works */}
        <section id="how" className="mx-auto grid max-w-6xl scroll-mt-20 gap-6 px-5 py-12 lg:grid-cols-2">
          <div className="space-y-4">
            {[
              ["Add what you own", "Enter holdings by hand, upload a CSV, or import a CAMS/KFintech or NSDL/CDSL statement — reviewed before anything is saved."],
              ["See through your funds", "FinLex multiplies your value in each fund by its disclosed holdings to reveal company, sector and asset-class concentration."],
              ["Understand, then decide", "Compare assets in ₹, read calibrated forecast ranges and their track record, and ask questions about your own data."],
            ].map(([t, b], i) => (
              <div key={t} className="card flex gap-4 p-5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent/15 text-sm font-bold text-accent">{i + 1}</span>
                <div>
                  <h3 className="font-semibold">{t}</h3>
                  <p className="mt-1 text-sm text-muted">{b}</p>
                </div>
              </div>
            ))}
            <p className="text-xs text-faint">Market data delayed up to ~15 minutes. Fund look-through uses periodic disclosures.</p>
          </div>
          <div className="card p-5">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-sm font-semibold">Exposure card</span>
              <Badge tone="neutral">Illustrative</Badge>
            </div>
            <div className="rounded-xl border border-line/70 bg-surface2/50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-lg bg-gradient-to-br from-sky-500 to-blue-700 text-xs font-bold text-white">HB</span>
                  <div>
                    <div className="font-semibold">HDFCBANK</div>
                    <div className="text-xs text-faint">HDFC Bank Ltd. · Financial Services</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-bold tnum">₹1,91,420</div>
                  <div className="text-xs text-faint">of ₹18.4L</div>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between text-sm">
                <span className="font-medium">Effective exposure</span>
                <span className="font-semibold text-warn">10.4% · above your 10%</span>
              </div>
              <ScoreBar value={10.4} max={15} tone="warn" className="mt-2 !h-2" />
              <div className="mt-4 flex flex-wrap gap-1.5">
                <Chip tone="accent">Direct shares ₹1.3L</Chip>
                <Chip tone="info">HDFC Flexi Cap ₹15K</Chip>
                <Chip tone="info">Banking & FS fund ₹24K</Chip>
                <Chip tone="info">Large-cap fund ₹10K</Chip>
                <Chip tone="neutral">Index fund ₹12K</Chip>
              </div>
              <p className="mt-4 text-sm text-muted">Four of your funds and your direct shares all hold the same bank. Overlap between your two large-cap funds is 58% of their disclosed portfolios.</p>
            </div>
          </div>
        </section>

        {/* honesty */}
        <section id="honesty" className="mx-auto grid max-w-6xl scroll-mt-20 items-start gap-10 px-5 py-20 lg:grid-cols-2">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Simple flow, serious honesty</h2>
            <p className="mt-3 text-muted">Most money apps advertise their wins. FinLex logs every forecast in a tamper-evident, hash-chained record and scores it when the horizon passes — hits and misses alike.</p>
            <ul className="mt-6 space-y-3 text-sm">
              {["Ranges, not single numbers — with stated coverage", "Benchmarked against a no-change baseline (and says when it loses)", "Walk-forward testing with leakage controls", "Facts separated from AI interpretation, with sources"].map((t) => (
                <li key={t} className="flex items-center gap-2.5"><Check className="h-4 w-4 text-pos" /> {t}</li>
              ))}
            </ul>
            <div className="mt-6 card p-4">
              <div className="mb-3 flex items-center justify-between text-sm">
                <span className="font-semibold">Track record</span>
                <Badge tone="neutral">Illustrative</Badge>
              </div>
              {[
                ["NIFTY 50 · 1 month", "−6.6% to +2.2%", "+1.1%", true],
                ["Gold ₹/10g · 1 week", "−2.0% to +2.9%", "+3.4%", false],
                ["Silver ₹/kg · 1 month", "−9.8% to +8.7%", "−4.2%", true],
              ].map(([n, r, a, hit]) => (
                <div key={n as string} className="flex items-center justify-between gap-3 border-t border-line/50 py-2.5 text-sm">
                  <span className="min-w-0 truncate">{n as string}</span>
                  <span className="hidden text-faint sm:inline">80% range {r as string}</span>
                  <span className="tnum">{a as string}</span>
                  <Badge tone={hit ? "pos" : "neg"}>{hit ? "Hit" : "Miss"}</Badge>
                </div>
              ))}
            </div>
          </div>
          <div className="card overflow-hidden">
            <div className="border-b border-line/60 px-5 py-4 font-semibold">How FinLex differs from tip-style apps</div>
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Capability</th>
                    <th className="text-center">FinLex</th>
                    <th className="text-center">Typical tip app</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARE_ROWS.map(([c, a, b]) => (
                    <tr key={c}>
                      <td className="text-ink">{c}</td>
                      <td className="text-center">{a ? <Check className="mx-auto h-4 w-4 text-pos" aria-label="Yes" /> : <X className="mx-auto h-4 w-4 text-neg" aria-label="No" />}</td>
                      <td className="text-center">{b ? <Check className="mx-auto h-4 w-4 text-pos" aria-label="Yes" /> : <X className="mx-auto h-4 w-4 text-faint" aria-label="No" />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* trust strip */}
        <section className="mx-auto max-w-6xl px-5">
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              [Lock, "Privacy by design", "Statements parsed in memory. Export or delete everything in one click."],
              [FileText, "Sources on every screen", "Provider, delay and as-of time next to every market number."],
              [BookOpen, "Learn as you go", "Short lessons on XIRR, overlap, drawdown and forecast intervals."],
            ].map(([I, t, b]) => {
              const Icon = I as typeof Lock;
              return (
                <div key={t as string} className="flex gap-3 rounded-2xl border border-line/60 p-4">
                  <Icon className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
                  <div>
                    <div className="text-sm font-semibold">{t as string}</div>
                    <div className="mt-0.5 text-sm text-muted">{b as string}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* faq */}
        <section id="faq" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20">
          <div className="mb-10 text-center">
            <h2 className="text-3xl font-bold tracking-tight">Frequently asked</h2>
            <p className="mt-2 text-muted">Short, honest answers.</p>
          </div>
          <Faq />
        </section>

        {/* CTA */}
        <section className="mx-auto max-w-6xl px-5 pb-20">
          <div className="relative overflow-hidden rounded-3xl border border-line bg-surface p-10 text-center">
            <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-accent/20 blur-3xl" />
            <h2 className="relative text-2xl font-bold tracking-tight sm:text-3xl">Understand first. Decide yourself.</h2>
            <p className="relative mt-2 text-muted">Explore a sample portfolio priced with real market data. No sign-up, no credit card.</p>
            <div className="relative mt-6 flex flex-wrap justify-center gap-3">
              {demoBtn}
              <Link to="/register" className="btn-ghost !px-4 !py-2.5">Create free account</Link>
            </div>
          </div>
        </section>
      </main>
      <footer className="border-t border-line/60">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
          <span>© 2026 FinLex. Built for Indian investors.</span>
          <div className="flex gap-6">
            <Link to="/privacy" className="hover:text-ink">Privacy</Link>
            <Link to="/terms" className="hover:text-ink">Terms</Link>
            <a href="mailto:support@finlex.app" className="hover:text-ink">Contact</a>
          </div>
        </div>
        <p className="mx-auto max-w-6xl px-5 pb-8 text-[11px] leading-relaxed text-faint">
          FinLex is an educational analytics tool and is not registered with SEBI as an investment adviser or research analyst. Nothing on this site is a
          recommendation to buy, sell or hold any security. Market data is delayed and may contain errors; forecasts are experimental statistical estimates.
        </p>
      </footer>
    </div>
  );
}
