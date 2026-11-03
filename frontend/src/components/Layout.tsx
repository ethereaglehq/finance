/* App shell: StockWisp-style left rail (labelled, collapsible) + top bar with search, delay pill, alerts, theme, user. */
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import {
  Bell,
  BookOpen,
  Bot,
  ChartCandlestick,
  ChevronsLeft,
  FileUp,
  GitCompareArrows,
  History,
  LayoutDashboard,
  Layers,
  LogOut,
  Menu,
  Moon,
  Newspaper,
  Settings,
  SlidersHorizontal,
  Sun,
  Wallet,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { ago } from "@/lib/format";
import { useTheme } from "@/lib/theme";
import type { AlertEvent, Status } from "@/lib/types";
import { InstrumentPicker } from "./InstrumentPicker";
import { Logo, LogoMark } from "./Logo";
import { Disclaimer, LivePill, Toaster } from "./ui";

const NAV: { group: string; items: { to: string; label: string; icon: typeof Wallet; end?: boolean }[] }[] = [
  { group: "Overview", items: [{ to: "/app", label: "Dashboard", icon: LayoutDashboard, end: true }] },
  {
    group: "Your money",
    items: [
      { to: "/app/portfolio", label: "My Portfolio", icon: Wallet },
      { to: "/app/exposure", label: "True Exposure", icon: Layers },
      { to: "/app/import", label: "Import", icon: FileUp },
    ],
  },
  {
    group: "Markets",
    items: [
      { to: "/app/compare", label: "Compare", icon: GitCompareArrows },
      { to: "/app/forecast", label: "Forecast", icon: ChartCandlestick },
      { to: "/app/track-record", label: "Track Record", icon: History },
      { to: "/app/pulse", label: "Market Pulse", icon: Newspaper },
    ],
  },
  {
    group: "Assist",
    items: [
      { to: "/app/ask", label: "Ask FinLex", icon: Bot },
      { to: "/app/plan", label: "Plan", icon: SlidersHorizontal },
      { to: "/app/learn", label: "Learn", icon: BookOpen },
    ],
  },
];

function NavItems({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  return (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
      {NAV.map((g) => (
        <div key={g.group}>
          {!collapsed && <div className="label mb-1.5 px-2.5">{g.group}</div>}
          <ul className="space-y-0.5">
            {g.items.map((it) => (
              <li key={it.to}>
                <NavLink
                  to={it.to}
                  end={it.end}
                  onClick={onNavigate}
                  title={collapsed ? it.label : undefined}
                  className={({ isActive }) =>
                    clsx(
                      "group flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition",
                      collapsed && "justify-center",
                      isActive ? "bg-accent/12 text-ink ring-1 ring-accent/25" : "text-muted hover:bg-surface2 hover:text-ink",
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <it.icon className={clsx("h-[18px] w-[18px] shrink-0", isActive ? "text-accent" : "text-faint group-hover:text-muted")} />
                      {!collapsed && <span className="truncate">{it.label}</span>}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function SidebarFooter({ collapsed }: { collapsed: boolean }) {
  return (
    <div className="space-y-0.5 border-t border-line/60 px-3 py-3">
      {[
        { to: "/app/alerts", label: "Alerts", icon: Bell },
        { to: "/app/settings", label: "Settings & data", icon: Settings },
      ].map((it) => (
        <NavLink
          key={it.to}
          to={it.to}
          title={collapsed ? it.label : undefined}
          className={({ isActive }) =>
            clsx("flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition", collapsed && "justify-center",
              isActive ? "bg-accent/12 text-ink" : "text-muted hover:bg-surface2 hover:text-ink")
          }
        >
          <it.icon className="h-[18px] w-[18px] shrink-0 text-faint" />
          {!collapsed && it.label}
        </NavLink>
      ))}
    </div>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  if (!user) return null;
  const initials = (user.name || user.email).split(/[\s@.]/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("");
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-surface2" aria-haspopup="menu" aria-expanded={open}>
        <span className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-accent to-indigo-600 text-xs font-bold text-white">{initials || "U"}</span>
        <span className="hidden max-w-[140px] truncate text-sm font-medium text-ink lg:block">{user.is_demo ? "Demo investor" : user.name || user.email}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div role="menu" className="absolute right-0 z-40 mt-2 w-60 rounded-xl border border-line bg-surface p-1.5 shadow-2xl">
            <div className="px-3 py-2">
              <div className="truncate text-sm font-semibold">{user.is_demo ? "Demo investor" : user.name || "Your account"}</div>
              <div className="truncate text-xs text-faint">{user.is_demo ? "Synthetic sandbox · auto-deleted in 24h" : user.email}</div>
            </div>
            <div className="my-1 h-px bg-line/70" />
            <button role="menuitem" className="w-full rounded-lg px-3 py-2 text-left text-sm text-muted hover:bg-surface2 hover:text-ink" onClick={() => (setOpen(false), nav("/app/settings"))}>
              Settings & data
            </button>
            <button
              role="menuitem"
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-muted hover:bg-surface2 hover:text-ink"
              onClick={async () => {
                setOpen(false);
                await logout();
                nav("/");
              }}
            >
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function AlertsBell() {
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["alert-events"], queryFn: () => api.get<AlertEvent[]>("/api/alerts/events"), refetchInterval: 120_000 });
  const unread = (q.data ?? []).filter((e) => !e.read).length;
  return (
    <button className="btn-quiet relative !p-2" aria-label={`Alerts${unread ? ` (${unread} unread)` : ""}`} onClick={() => nav("/app/alerts")}>
      <Bell className="h-[18px] w-[18px]" />
      {unread > 0 && <span className="absolute right-1 top-1 grid h-4 min-w-[16px] place-items-center rounded-full bg-neg px-1 text-[10px] font-bold text-white">{unread}</span>}
    </button>
  );
}

function StatusPill() {
  const q = useQuery({ queryKey: ["status"], queryFn: () => api.get<Status>("/api/status"), refetchInterval: 60_000 });
  const s = q.data;
  if (!s) return null;
  if (!s.scheduler.prices_ready && s.scheduler.bootstrapping) return <LivePill tone="warn">Loading market data…</LivePill>;
  const label = s.market_data_mode === "synthetic" ? "Offline demo data" : "Delayed ~15 min";
  const last = s.scheduler.last?.refresh?.at || s.scheduler.last?.bootstrap?.at;
  return (
    <span title={last ? `Last refresh ${ago(last)}` : undefined}>
      <LivePill tone={s.market_data_mode === "synthetic" ? "warn" : "accent"}>{label}</LivePill>
    </span>
  );
}

export function AppLayout() {
  const { user } = useAuth();
  const { theme, toggle } = useTheme();
  const nav = useNavigate();
  const loc = useLocation();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("finlex-nav") === "collapsed";
    } catch {
      return false;
    }
  });
  const [mobile, setMobile] = useState(false);
  useEffect(() => setMobile(false), [loc.pathname]);
  useEffect(() => {
    try {
      localStorage.setItem("finlex-nav", collapsed ? "collapsed" : "open");
    } catch {
      /* ignore */
    }
  }, [collapsed]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [loc.pathname]);

  return (
    <div className="flex min-h-screen">
      {/* desktop rail */}
      <aside className={clsx("sticky top-0 hidden h-screen shrink-0 flex-col border-r border-line/60 bg-surface/60 backdrop-blur lg:flex", collapsed ? "w-[72px]" : "w-[232px]")}>
        <div className={clsx("flex h-16 items-center border-b border-line/60", collapsed ? "justify-center" : "justify-between px-4")}>
          <Link to="/app" aria-label="FinLex home">{collapsed ? <LogoMark /> : <Logo />}</Link>
          {!collapsed && (
            <button className="btn-quiet !p-1.5" onClick={() => setCollapsed(true)} aria-label="Collapse sidebar">
              <ChevronsLeft className="h-4 w-4" />
            </button>
          )}
        </div>
        {collapsed && (
          <button className="btn-quiet mx-auto mt-2 !p-1.5" onClick={() => setCollapsed(false)} aria-label="Expand sidebar">
            <ChevronsLeft className="h-4 w-4 rotate-180" />
          </button>
        )}
        <NavItems collapsed={collapsed} />
        <SidebarFooter collapsed={collapsed} />
      </aside>

      {/* mobile drawer */}
      {mobile && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobile(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-[260px] flex-col border-r border-line bg-surface animate-fadein">
            <div className="flex h-16 items-center justify-between border-b border-line/60 px-4">
              <Logo />
              <button className="btn-quiet !p-1.5" onClick={() => setMobile(false)} aria-label="Close menu">
                <X className="h-4 w-4" />
              </button>
            </div>
            <NavItems collapsed={false} onNavigate={() => setMobile(false)} />
            <SidebarFooter collapsed={false} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line/60 bg-bg/80 px-4 backdrop-blur sm:px-6">
          <button className="btn-quiet !p-2 lg:hidden" onClick={() => setMobile(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <Link to="/app" className="lg:hidden" aria-label="FinLex home">
            <LogoMark />
          </Link>
          <div className="hidden w-full max-w-sm md:block">
            <InstrumentPicker universe placeholder="Search ticker, index, gold…" onSelect={(i) => nav(`/app/compare?ids=${i.id}`)} />
          </div>
          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <div className="hidden sm:block">
              <StatusPill />
            </div>
            <button className="btn-quiet !p-2" onClick={toggle} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
              {theme === "dark" ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
            </button>
            <AlertsBell />
            <UserMenu />
          </div>
        </header>

        {user?.is_demo && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-accent/20 bg-accent/[0.07] px-4 py-2 text-xs sm:px-6">
            <span className="text-muted">
              <span className="mr-2 rounded bg-accent/15 px-1.5 py-0.5 font-bold uppercase tracking-wide text-accent">Demo</span>
              You're exploring a synthetic sample portfolio priced with real market data. It's deleted after 24 hours.
            </span>
            <Link to="/register" className="font-semibold text-accent hover:underline">
              Create a free account →
            </Link>
          </div>
        )}

        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:py-8">
          <Outlet />
        </main>
        <footer className="border-t border-line/50 px-4 py-4 sm:px-6">
          <Disclaimer className="mx-auto max-w-[1400px]" />
        </footer>
      </div>
      <Toaster />
    </div>
  );
}

export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      {children}
      <Toaster />
    </div>
  );
}
