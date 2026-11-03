import { useMutation, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Download, FileUp, Pencil, Plus, PlusCircle, Search, Trash2, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AddHoldingModal, useRefreshPortfolio } from "@/components/portfolio/AddHoldingModal";
import { AllocationDonut } from "@/components/portfolio/viz";
import {
  displayName,
  downloadCsv,
  FreshnessMarks,
  instrumentSub,
  KpiHeader,
  PnlCell,
  TYPE_TABS,
  ValueHistoryCard,
  WeightBar,
  type Period,
  type TypeTab,
} from "@/components/portfolio/common";
import {
  Badge,
  Button,
  Card,
  Delta,
  EmptyState,
  ErrorState,
  Field,
  Input,
  InstrumentAvatar,
  Modal,
  Notice,
  PageHeader,
  Select,
  Skeleton,
  Switch,
  Tabs,
  toast,
} from "@/components/ui";
import { api } from "@/lib/api";
import { inr, inrCompact, pct, qty } from "@/lib/format";
import type { HoldingRow, Valuation } from "@/lib/types";

type Account = { id: number; label: string; account_type: string; holdings: number };
const ACCOUNT_TYPES = [
  ["broker", "Broker / demat"],
  ["mf", "Mutual-fund folio"],
  ["physical", "Physical (locker)"],
  ["bank", "Bank"],
  ["demat", "Depository"],
  ["other", "Other"],
] as const;

function HoldingsTable({ rows, onOpen }: { rows: HoldingRow[]; onOpen: (id: number) => void }) {
  const maxW = Math.max(...rows.map((r) => r.weight), 1);
  return (
    <div className="relative hidden overflow-x-auto lg:block">
      <table className="table-base">
        <thead>
          <tr>
            <th>Instrument</th>
            <th className="!text-right">Qty</th>
            <th className="!text-right">Avg cost</th>
            <th className="!text-right">Price / NAV</th>
            <th className="!text-right">Value</th>
            <th className="!text-right">P&L</th>
            <th className="!text-right">Today</th>
            <th className="!text-right">XIRR</th>
            <th>Weight</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((h) => (
            <tr
              key={h.id}
              tabIndex={0}
              className={clsx("cursor-pointer", h.closed && "opacity-60")}
              onClick={() => onOpen(h.id)}
              onKeyDown={(e) => e.key === "Enter" && onOpen(h.id)}
              aria-label={`Open ${h.instrument.name}`}
            >
              <td className="max-w-[300px] xl:max-w-[380px]">
                <div className="flex items-center gap-3">
                  <InstrumentAvatar symbol={h.instrument.symbol} assetClass={h.instrument.asset_class} />
                  <div className="min-w-0">
                    <div className="truncate font-medium text-ink">{displayName(h)}</div>
                    <div className="truncate text-xs text-faint">
                      {instrumentSub(h)} · <span className="text-muted">{h.account?.label ?? "Unassigned"}</span>
                    </div>
                  </div>
                </div>
              </td>
              <td className="text-right tnum">{h.instrument.asset_class === "fd" ? "—" : qty(h.quantity)}</td>
              <td className="text-right tnum text-muted">{h.instrument.asset_class === "fd" ? inr(h.avg_cost) : inr(h.avg_cost, { decimals: true })}</td>
              <td className="text-right">
                <div className="tnum">{h.price === null ? "—" : h.instrument.asset_class === "fd" ? "—" : inr(h.price, { decimals: true })}</div>
                <FreshnessMarks h={h} />
              </td>
              <td className="text-right font-semibold tnum">{h.closed ? <Badge>Closed</Badge> : inr(h.value)}</td>
              <td>{h.closed ? <div className="text-right text-xs text-muted">Realised {inr(h.realised_pnl, { sign: true })}</div> : <PnlCell pnl={h.pnl} pnlPct={h.pnl_pct} />}</td>
              <td className="text-right">{h.closed ? "—" : <Delta value={h.day_change_pct} className="text-xs" />}</td>
              <td className="text-right tnum text-muted">{h.xirr === null ? "—" : pct(h.xirr, 1)}</td>
              <td>
                <WeightBar value={h.weight} max={maxW} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HoldingsCards({ rows }: { rows: HoldingRow[] }) {
  return (
    <ul className="divide-y divide-line/50 lg:hidden">
      {rows.map((h) => (
        <li key={h.id}>
          <Link to={`/app/portfolio/${h.id}`} className={clsx("flex items-center gap-3 px-4 py-3 transition hover:bg-surface2/50", h.closed && "opacity-60")}>
            <InstrumentAvatar symbol={h.instrument.symbol} assetClass={h.instrument.asset_class} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-ink">{displayName(h)}</div>
              <div className="truncate text-xs text-faint">
                {h.instrument.asset_class === "fd" ? instrumentSub(h) : `${qty(h.quantity)} × ${h.price === null ? "—" : inr(h.price, { decimals: true })}`}
                {h.account ? ` · ${h.account.label}` : ""}
              </div>
              <FreshnessMarks h={h} />
            </div>
            <div className="shrink-0 text-right">
              <div className="text-sm font-semibold tnum">{h.closed ? "Closed" : inrCompact(h.value)}</div>
              {!h.closed && <Delta value={h.pnl_pct} className="text-xs" />}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function AccountsCard() {
  const refresh = useRefreshPortfolio();
  const q = useQuery({ queryKey: ["accounts"], queryFn: () => api.get<Account[]>("/api/accounts") });
  const [editing, setEditing] = useState<Account | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ label: "", account_type: "broker" });
  const [err, setErr] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<Account | null>(null);
  const save = useMutation({
    mutationFn: () => (editing ? api.patch(`/api/accounts/${editing.id}`, form) : api.post("/api/accounts", form)),
    onSuccess: () => {
      toast(editing ? "Account updated" : "Account added");
      setEditing(null);
      setCreating(false);
      refresh();
    },
    onError: (e) => setErr((e as Error).message),
  });
  const del = useMutation({
    mutationFn: (id: number) => api.del(`/api/accounts/${id}`),
    onSuccess: () => {
      toast("Account removed");
      setConfirmDel(null);
      refresh();
    },
    onError: (e) => {
      toast((e as Error).message, "neg");
      setConfirmDel(null);
    },
  });
  const openForm = (a: Account | null) => {
    setErr(null);
    setForm(a ? { label: a.label, account_type: a.account_type } : { label: "", account_type: "broker" });
    if (a) setEditing(a);
    else setCreating(true);
  };
  return (
    <Card
      title="Accounts"
      subtitle="Brokers, folios, lockers and banks stay separate"
      actions={
        <Button size="sm" variant="ghost" onClick={() => openForm(null)}>
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      }
    >
      {q.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <p className="text-sm text-muted">No accounts yet. They're created automatically when you add or import holdings.</p>
      ) : (
        <ul className="divide-y divide-line/50">
          {q.data.map((a) => (
            <li key={a.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{a.label}</div>
                <div className="text-xs text-faint">
                  {ACCOUNT_TYPES.find(([v]) => v === a.account_type)?.[1] ?? a.account_type} · {a.holdings} holding{a.holdings === 1 ? "" : "s"}
                </div>
              </div>
              <button className="btn-quiet !p-1.5" onClick={() => openForm(a)} aria-label={`Rename ${a.label}`}>
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button className="btn-quiet !p-1.5 hover:!text-neg" onClick={() => setConfirmDel(a)} aria-label={`Delete ${a.label}`} disabled={a.holdings > 0} title={a.holdings > 0 ? "Move or delete its holdings first" : "Delete account"}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={creating || !!editing}
        onClose={() => (setCreating(false), setEditing(null))}
        title={editing ? "Edit account" : "New account"}
        footer={
          <>
            <Button variant="ghost" onClick={() => (setCreating(false), setEditing(null))}>
              Cancel
            </Button>
            <Button loading={save.isPending} disabled={!form.label.trim()} onClick={() => save.mutate()}>
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Label">
            <Input value={form.label} maxLength={120} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. Zerodha, Groww, SBI locker" />
          </Field>
          <Field label="Type">
            <Select value={form.account_type} onChange={(e) => setForm({ ...form, account_type: e.target.value })}>
              {ACCOUNT_TYPES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          {err && <Notice tone="neg">{err}</Notice>}
        </div>
      </Modal>
      <Modal
        open={!!confirmDel}
        onClose={() => setConfirmDel(null)}
        title="Delete account?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDel(null)}>
              Cancel
            </Button>
            <Button variant="danger" className="btn-danger" loading={del.isPending} onClick={() => confirmDel && del.mutate(confirmDel.id)}>
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">“{confirmDel?.label}” has no holdings and will be removed.</p>
      </Modal>
    </Card>
  );
}

export default function Portfolio() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [tab, setTab] = useState<TypeTab>("all");
  const [account, setAccount] = useState("");
  const [search, setSearch] = useState("");
  const [showClosed, setShowClosed] = useState(false);
  const [period, setPeriod] = useState<Period>("1Y");
  const [allocBy, setAllocBy] = useState<"type" | "account" | "sector">("type");
  const addOpen = sp.get("add") === "1";
  const setAddOpen = (v: boolean) => {
    const n = new URLSearchParams(sp);
    if (v) n.set("add", "1");
    else n.delete("add");
    setSp(n, { replace: true });
  };

  const q = useQuery({ queryKey: ["portfolio"], queryFn: () => api.get<Valuation>("/api/portfolio") });
  const v = q.data;

  useEffect(() => {
    if (account && v && !v.accounts.some((a) => String(a.id) === account)) setAccount("");
  }, [v, account]);

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const t of TYPE_TABS) out[t.value] = (v?.holdings ?? []).filter((h) => !h.closed && t.match(h.instrument.asset_class)).length;
    return out;
  }, [v]);

  const rows = useMemo(() => {
    const t = TYPE_TABS.find((x) => x.value === tab)!;
    const s = search.trim().toLowerCase();
    return (v?.holdings ?? [])
      .filter((h) => (showClosed || !h.closed) && t.match(h.instrument.asset_class))
      .filter((h) => !account || String(h.account?.id ?? "none") === account)
      .filter((h) => !s || h.instrument.name.toLowerCase().includes(s) || h.instrument.symbol.toLowerCase().includes(s) || (h.account?.label ?? "").toLowerCase().includes(s))
      .sort((a, b) => Number(a.closed) - Number(b.closed) || (b.value ?? 0) - (a.value ?? 0));
  }, [v, tab, search, account, showClosed]);

  const sub = useMemo(() => {
    const open = rows.filter((r) => !r.closed && r.value !== null);
    const value = open.reduce((s, r) => s + (r.value ?? 0), 0);
    const invested = open.reduce((s, r) => s + r.invested, 0);
    return { value, invested, pnl: value - invested, pnlPct: invested ? ((value - invested) / invested) * 100 : 0 };
  }, [rows]);

  const exportCsv = () => {
    downloadCsv(`finlex-holdings-${new Date().toISOString().slice(0, 10)}.csv`, [
      ["Instrument", "Symbol/Code", "Type", "Account", "Quantity", "Avg cost", "Price", "Value", "Invested", "P&L", "P&L %", "Day change %", "XIRR %", "Weight %", "Price as of", "Source"],
      ...rows.map((h) => [
        h.instrument.name,
        h.instrument.asset_class === "mf" ? h.instrument.amfi_code : h.instrument.symbol,
        h.type_label,
        h.account?.label ?? "",
        h.quantity,
        h.avg_cost.toFixed(4),
        h.price?.toFixed(4),
        h.value?.toFixed(2),
        h.invested.toFixed(2),
        h.pnl?.toFixed(2),
        h.pnl_pct?.toFixed(2),
        h.day_change_pct?.toFixed(2),
        h.xirr?.toFixed(2),
        h.weight.toFixed(2),
        h.as_of,
        h.source,
      ]),
    ]);
  };

  const alloc = !v ? [] : allocBy === "type" ? v.allocation.by_type : allocBy === "account" ? v.allocation.by_account : v.allocation.by_sector;
  const hasHoldings = (v?.holdings ?? []).length > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="My Portfolio"
        title="Everything you own"
        subtitle="Stocks, mutual funds, ETFs, gold, silver and deposits across all your accounts — valued with delayed market prices and clearly labelled estimates."
        actions={
          <>
            <Link to="/app/import" className="btn-ghost">
              <FileUp className="h-4 w-4" /> Import
            </Link>
            <Button onClick={() => setAddOpen(true)}>
              <PlusCircle className="h-4 w-4" /> Add holding
            </Button>
          </>
        }
      />

      {q.error ? (
        <Card>
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        </Card>
      ) : (
        <KpiHeader totals={v?.totals} loading={!v} />
      )}

      <Card pad={false}>
        <div className="flex flex-col gap-3 border-b border-line/60 p-4 sm:p-5">
          <Tabs<TypeTab> value={tab} onChange={setTab} items={TYPE_TABS.map((t) => ({ value: t.value, label: t.label, count: counts[t.value] }))} />
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-56">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
              <Input className="pl-9" placeholder="Search holdings" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search holdings" />
            </div>
            <div className="w-full sm:w-52">
              <Select value={account} onChange={(e) => setAccount(e.target.value)} aria-label="Filter by account">
                <option value="">All accounts</option>
                {v?.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
                <option value="none">Unassigned</option>
              </Select>
            </div>
            <Switch checked={showClosed} onChange={setShowClosed} label="Show closed" />
            <Button variant="ghost" size="sm" className="sm:ml-auto" onClick={exportCsv} disabled={!rows.length} title="Download the visible rows as CSV">
              <Download className="h-3.5 w-3.5" /> CSV
            </Button>
          </div>
        </div>

        {!v ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : !hasHoldings ? (
          <EmptyState
            icon={<Wallet className="h-5 w-5" />}
            title="No holdings yet"
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => setAddOpen(true)}>
                  <PlusCircle className="h-4 w-4" /> Add your first holding
                </Button>
                <Link to="/app/import" className="btn-ghost">
                  <FileUp className="h-4 w-4" /> Import CSV / statement
                </Link>
              </div>
            }
          >
            Add a stock, fund, ETF, gold, silver or a fixed deposit — or import a CAMS/CDSL statement.
          </EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState title="Nothing matches these filters">Try another tab, account or search term.</EmptyState>
        ) : (
          <>
            <HoldingsTable rows={rows} onOpen={(id) => nav(`/app/portfolio/${id}`)} />
            <HoldingsCards rows={rows} />
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/60 px-4 py-3 text-sm sm:px-5">
              <span className="text-muted">
                {rows.length} row{rows.length === 1 ? "" : "s"} shown
              </span>
              <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="text-muted">
                  Value <span className="font-semibold tnum text-ink">{inr(sub.value)}</span>
                </span>
                <span className="text-muted">
                  Invested <span className="tnum text-ink">{inr(sub.invested)}</span>
                </span>
                <span className={clsx("font-semibold tnum", sub.pnl >= 0 ? "text-pos" : "text-neg")}>
                  {inr(sub.pnl, { sign: true })} ({pct(sub.pnlPct, 2, true)})
                </span>
              </span>
            </div>
          </>
        )}
      </Card>

      {hasHoldings && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <ValueHistoryCard className="xl:col-span-2" period={period} onPeriod={setPeriod} />
          <Card
            title="Allocation"
            subtitle={allocBy === "sector" ? "Direct stocks only — see True Exposure for funds" : undefined}
            actions={
              <Tabs
                size="sm"
                value={allocBy}
                onChange={setAllocBy}
                items={[
                  { value: "type", label: "Type" },
                  { value: "account", label: "Account" },
                  { value: "sector", label: "Sector" },
                ]}
              />
            }
          >
            {alloc.length ? (
              <AllocationDonut
                items={alloc}
                size={160}
                center={
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-faint">{allocBy}</div>
                    <div className="text-sm font-bold tnum">{inrCompact(alloc.reduce((s, x) => s + x.value, 0))}</div>
                  </div>
                }
              />
            ) : (
              <p className="text-sm text-muted">No direct stock holdings to group by sector.</p>
            )}
          </Card>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <AccountsCard />
        <Card className="xl:col-span-2" title="Data quality" subtitle="Missing, stale, simulated or estimated prices are flagged — never hidden">
          {!v ? (
            <Skeleton className="h-24 w-full" />
          ) : v.issues.length === 0 ? (
            <Notice tone="pos" title="All holdings have fresh prices">
              Every open holding was valued with a recent market price or NAV.
            </Notice>
          ) : (
            <ul className="space-y-2">
              {v.issues.map((i, k) => (
                <li key={k}>
                  <Notice tone={i.level === "error" ? "neg" : i.level === "warning" ? "warn" : "info"}>
                    {i.message}{" "}
                    {i.holding_id && (
                      <Link to={`/app/portfolio/${i.holding_id}`} className="font-semibold text-accent hover:underline">
                        Open
                      </Link>
                    )}
                  </Notice>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <AddHoldingModal open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}
