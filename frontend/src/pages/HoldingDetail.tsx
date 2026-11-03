import { useMutation, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowLeft, ChartCandlestick, GitCompareArrows, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { axisProps, ChartTooltip, Legend } from "@/components/charts";
import { useRefreshPortfolio } from "@/components/portfolio/AddHoldingModal";
import { displayName, FreshnessMarks, instrumentSub, todayIST } from "@/components/portfolio/common";
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
  KeyValue,
  Modal,
  Notice,
  ScoreBar,
  Select,
  Skeleton,
  SourceBadge,
  Stat,
  Tabs,
  Textarea,
  toast,
} from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { date, inr, monthYear, num, pct, qty } from "@/lib/format";
import { useChartColors } from "@/lib/theme";
import type { HoldingRow, InstrumentRef, Quote } from "@/lib/types";

interface Tx {
  id: number;
  type: "BUY" | "SELL";
  quantity: number;
  price: number;
  fees: number;
  trade_date: string;
  source: string;
}
interface Detail {
  holding: HoldingRow | null;
  transactions: Tx[];
  price_history: { date: string; price: number }[];
  lookthrough: { name: string; weight: number; sector: string | null; asset_type: string; value: number; disclosure_date: string; source: string }[];
  quote: Quote | null;
}
type Account = { id: number; label: string };

const COMP_N: Record<string, number> = { monthly: 12, quarterly: 4, "half-yearly": 2, annual: 1, simple: 0 };

function fdValueAt(meta: Record<string, unknown>, on: string): number {
  const principal = Number(meta.principal);
  const rate = Number(meta.rate) / 100;
  const start = new Date(String(meta.start_date));
  const end = new Date(String(meta.maturity_date));
  const at = new Date(on);
  const t = (Math.min(Math.max(at.getTime(), start.getTime()), end.getTime()) - start.getTime()) / (365 * 864e5);
  const n = COMP_N[String(meta.compounding)] ?? 4;
  return n === 0 ? principal * (1 + rate * t) : principal * Math.pow(1 + rate / n, n * t);
}

function TxModal({ open, onClose, holdingId, tx, unit }: { open: boolean; onClose: () => void; holdingId: number; tx: Tx | null; unit: string }) {
  const refresh = useRefreshPortfolio();
  const [f, setF] = useState({ type: "BUY" as "BUY" | "SELL", quantity: "", price: "", trade_date: todayIST(), fees: "" });
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setErr(null);
      setF(
        tx
          ? { type: tx.type, quantity: String(tx.quantity), price: String(tx.price), trade_date: tx.trade_date, fees: tx.fees ? String(tx.fees) : "" }
          : { type: "BUY", quantity: "", price: "", trade_date: todayIST(), fees: "" },
      );
    }
  }, [open, tx]);
  const m = useMutation({
    mutationFn: () => {
      const body = { type: f.type, quantity: Number(f.quantity), price: Number(f.price), trade_date: f.trade_date, fees: f.fees ? Number(f.fees) : 0 };
      return tx ? api.put(`/api/transactions/${tx.id}`, body) : api.post(`/api/holdings/${holdingId}/transactions`, body);
    },
    onSuccess: () => {
      toast(tx ? "Transaction updated" : "Transaction added");
      refresh();
      onClose();
    },
    onError: (e) => setErr((e as Error).message),
  });
  const submit = () => {
    if (!(Number(f.quantity) > 0)) return setErr("Quantity must be positive.");
    if (f.price === "" || Number(f.price) < 0) return setErr("Enter a non-negative price.");
    if (!f.trade_date || f.trade_date > todayIST()) return setErr("Date can't be empty or in the future.");
    setErr(null);
    m.mutate();
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={tx ? "Edit transaction" : "Record a transaction"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={m.isPending} onClick={submit}>
            <Save className="h-4 w-4" /> Save
          </Button>
        </>
      }
    >
      <Tabs
        value={f.type}
        onChange={(t) => setF({ ...f, type: t })}
        items={[
          { value: "BUY", label: "Purchase / SIP" },
          { value: "SELL", label: "Sale / redemption" },
        ]}
        className="mb-3 w-full"
      />
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={`Quantity (${unit})`}>
            <Input type="number" inputMode="decimal" min={0} step="any" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} />
          </Field>
          <Field label="Price per unit (₹)">
            <Input type="number" inputMode="decimal" min={0} step="any" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
          </Field>
          <Field label="Date">
            <Input type="date" max={todayIST()} value={f.trade_date} onChange={(e) => setF({ ...f, trade_date: e.target.value })} />
          </Field>
          <Field label="Fees (₹)">
            <Input type="number" inputMode="decimal" min={0} step="any" value={f.fees} onChange={(e) => setF({ ...f, fees: e.target.value })} />
          </Field>
        </div>
        <p className="text-xs text-faint">Sales are matched against your average cost to compute realised P&L. A sale can't exceed the units held on that date.</p>
        {err && <Notice tone="neg">{err}</Notice>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function PriceChart({ d, h }: { d: Detail; h: HoldingRow }) {
  const c = useChartColors();
  const inst = h.instrument;
  const ref = (inst.asset_class === "gold" || inst.asset_class === "silver") && inst.exchange === "REF";
  const purity = Number(h.meta?.purity ?? 0.999);
  const scale = ref ? (1 / (inst.asset_class === "gold" ? 10 : 1000)) * (purity / 0.999) : 1;
  const data = useMemo(() => d.price_history.map((p) => ({ date: p.date, price: p.price * scale })), [d.price_history, scale]);
  const dates = data.map((p) => p.date);
  const markers = d.transactions
    .map((t) => {
      const i = dates.findIndex((x) => x >= t.trade_date);
      return i >= 0 ? { ...t, x: dates[i] } : null;
    })
    .filter(Boolean) as (Tx & { x: string })[];
  if (data.length < 2) return <p className="py-10 text-center text-sm text-muted">No price history available for this instrument.</p>;
  return (
    <>
      <div className="mb-3">
        <Legend
          items={[
            { label: ref ? "Reference price per gram (at your purity)" : "Price / NAV", color: c.series[0] },
            ...(h.quantity > 0 ? [{ label: "Your average cost", color: c.warn, dashed: true }] : []),
            { label: "Purchases", color: c.pos },
            ...(markers.some((m) => m.type === "SELL") ? [{ label: "Sales", color: c.neg }] : []),
          ]}
        />
      </div>
      <div className="h-[280px]" role="img" aria-label={`${inst.name} price history with ${markers.length} transactions marked`}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="date" {...axisProps} tickFormatter={monthYear} />
            <YAxis {...axisProps} width={70} domain={["auto", "auto"]} tickFormatter={(v: number) => (v >= 1000 ? `₹${num(v / 1000, 1)}K` : `₹${num(v, 0)}`)} />
            <Tooltip content={<ChartTooltip labelFormatter={(l) => date(l)} valueFormatter={(v) => inr(v, { decimals: true })} />} cursor={{ stroke: c.muted, strokeWidth: 1 }} />
            <Line type="monotone" dataKey="price" name="Price" stroke={c.series[0]} strokeWidth={2} dot={false} isAnimationActive={false} activeDot={{ r: 4, stroke: c.surface, strokeWidth: 2 }} />
            {h.quantity > 0 && <ReferenceLine y={h.avg_cost} stroke={c.warn} strokeDasharray="5 4" strokeWidth={1.5} ifOverflow="extendDomain" />}
            {markers.map((m) => (
              <ReferenceDot key={m.id} x={m.x} y={m.price} r={5} fill={m.type === "BUY" ? c.pos : c.neg} stroke={c.surface} strokeWidth={2} ifOverflow="extendDomain" />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

export default function HoldingDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const refresh = useRefreshPortfolio();
  const hid = Number(id);
  const q = useQuery({ queryKey: ["holding", hid], queryFn: () => api.get<Detail>(`/api/holdings/${hid}`), enabled: Number.isFinite(hid) });
  const d = q.data;
  const h = d?.holding ?? null;
  const instQ = useQuery({
    queryKey: ["instrument", h?.instrument.id],
    queryFn: () => api.get<InstrumentRef & { source: string | null }>(`/api/instruments/${h!.instrument.id}`),
    enabled: !!h && h.instrument.asset_class !== "fd",
  });
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: () => api.get<Account[]>("/api/accounts") });
  const [txOpen, setTxOpen] = useState(false);
  const [editTx, setEditTx] = useState<Tx | null>(null);
  const [delTx, setDelTx] = useState<Tx | null>(null);
  const [delHolding, setDelHolding] = useState(false);
  const [settings, setSettings] = useState({ notes: "", account_id: "", purity: "" });
  const [dirty, setDirty] = useState(false);
  const [notesTouched, setNotesTouched] = useState(false);

  useEffect(() => {
    if (h && !dirty)
      setSettings({
        notes: String((h as HoldingRow & { notes?: string }).notes ?? ""),
        account_id: h.account ? String(h.account.id) : "",
        purity: h.meta?.purity ? String(h.meta.purity) : "",
      });
  }, [h, dirty]);

  const patch = useMutation({
    mutationFn: () =>
      api.patch(`/api/holdings/${hid}`, {
        // only send notes when edited, so an unseen existing note is never blanked
        ...(notesTouched ? { notes: settings.notes } : {}),
        ...(settings.account_id ? { account_id: Number(settings.account_id) } : {}),
        ...(settings.purity ? { purity: Number(settings.purity) } : {}),
      }),
    onSuccess: () => {
      toast("Holding updated");
      setDirty(false);
      setNotesTouched(false);
      refresh();
    },
    onError: (e) => toast((e as Error).message, "neg"),
  });
  const removeTx = useMutation({
    mutationFn: (t: Tx) => api.del(`/api/transactions/${t.id}`),
    onSuccess: () => {
      toast("Transaction deleted");
      const last = (d?.transactions.length ?? 0) <= 1;
      setDelTx(null);
      refresh();
      if (last) nav("/app/portfolio");
    },
    onError: (e) => {
      toast((e as Error).message, "neg");
      setDelTx(null);
    },
  });
  const removeHolding = useMutation({
    mutationFn: () => api.del(`/api/holdings/${hid}`),
    onSuccess: () => {
      toast("Holding deleted");
      refresh();
      nav("/app/portfolio");
    },
    onError: (e) => toast((e as Error).message, "neg"),
  });

  if (q.isLoading)
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-80 w-full rounded-2xl" />
      </div>
    );
  if (q.error)
    return q.error instanceof ApiError && q.error.status === 404 ? (
      <EmptyState title="Holding not found" action={<Link to="/app/portfolio" className="btn-primary">Back to portfolio</Link>}>
        It may have been deleted.
      </EmptyState>
    ) : (
      <ErrorState error={q.error} onRetry={() => q.refetch()} />
    );
  if (!d || !h)
    return (
      <EmptyState title="This holding has no open units" action={<Link to="/app/portfolio" className="btn-primary">Back to portfolio</Link>}>
        Positions without transactions aren't shown.
      </EmptyState>
    );

  const inst = h.instrument;
  const isFd = inst.asset_class === "fd";
  const isFund = inst.asset_class === "mf" || inst.asset_class === "etf";
  const physical = (inst.asset_class === "gold" || inst.asset_class === "silver") && inst.exchange === "REF";
  const unit = physical ? "grams" : inst.asset_class === "mf" ? "units" : "shares/units";
  const inUniverse = instQ.data?.in_universe;

  return (
    <div className="space-y-6">
      <Link to="/app/portfolio" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Portfolio
      </Link>

      <section className="card relative overflow-hidden p-5 sm:p-6">
        <div className="hero-glow pointer-events-none absolute inset-0 opacity-60" />
        <div className="relative flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <InstrumentAvatar symbol={inst.symbol} assetClass={inst.asset_class} className="!h-12 !w-12 !text-sm" />
            <div className="min-w-0">
              <h1 className="break-words text-xl font-bold tracking-tight sm:text-2xl">{displayName(h)}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
                <Badge tone="accent">{h.type_label}</Badge>
                <span>{instrumentSub(h)}</span>
                {h.account && <Badge>{h.account.label}</Badge>}
                {h.closed && <Badge tone="warn">Closed position</Badge>}
                <FreshnessMarks h={h} />
              </div>
              {!isFd && h.price !== null && (
                <div className="mt-3 flex flex-wrap items-baseline gap-3">
                  <span className="text-2xl font-bold tnum">{inr(h.price, { decimals: true })}</span>
                  <span className="text-sm text-muted">{physical ? "per gram (estimate)" : inst.asset_class === "mf" ? "NAV" : "last price"}</span>
                  <Delta value={h.day_change_pct} />
                </div>
              )}
              <SourceBadge className="mt-2" source={h.source} asOf={h.as_of} delay={h.delay_note} synthetic={h.synthetic} stale={h.stale} />
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {!isFd && (
              <Link to={`/app/compare?ids=${inst.id}`} className="btn-ghost">
                <GitCompareArrows className="h-4 w-4" /> Compare this
              </Link>
            )}
            {inUniverse && (
              <Link to={`/app/forecast?instrument=${inst.id}`} className="btn-ghost">
                <ChartCandlestick className="h-4 w-4" /> Forecast range
              </Link>
            )}
            {!isFd && (
              <Button onClick={() => (setEditTx(null), setTxOpen(true))}>
                <Plus className="h-4 w-4" /> Transaction
              </Button>
            )}
          </div>
        </div>
        <div className="relative mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line/60 pt-5 md:grid-cols-3 xl:grid-cols-6">
          <Stat label="Current value" value={h.closed ? "—" : inr(h.value)} sub={isFd ? "Accrued, pre-tax" : `${qty(h.quantity)} ${unit}`} />
          <Stat label="Invested" value={inr(h.invested)} sub={isFd ? "Principal" : `Avg ${inr(h.avg_cost, { decimals: true })}`} />
          <Stat
            label="Unrealised P&L"
            value={<span className={clsx((h.pnl ?? 0) > 0 ? "text-pos" : (h.pnl ?? 0) < 0 ? "text-neg" : "")}>{inr(h.pnl, { sign: true })}</span>}
            sub={<Delta value={h.pnl_pct} />}
          />
          <Stat label="XIRR" value={h.xirr === null ? "—" : pct(h.xirr, 2)} sub="Annualised" />
          <Stat label="Realised P&L" value={inr(h.realised_pnl, { sign: true })} sub="From sales (avg cost)" />
          <Stat label="Weight" value={pct(h.weight, 2)} sub="of portfolio" />
        </div>
      </section>

      {isFd ? (
        <Card title="Deposit terms" subtitle="Value accrues from the terms you entered (estimate before tax and TDS)">
          {(() => {
            const m = h.meta as Record<string, unknown>;
            const start = String(m.start_date);
            const end = String(m.maturity_date);
            const total = new Date(end).getTime() - new Date(start).getTime();
            const done = Math.min(1, Math.max(0, (Date.now() - new Date(start).getTime()) / total));
            const maturityValue = fdValueAt(m, end);
            return (
              <div className="space-y-5">
                <KeyValue
                  items={[
                    ["Bank / institution", String(m.bank ?? "—")],
                    ["Principal", inr(Number(m.principal))],
                    ["Interest rate", `${num(Number(m.rate), 2)}% p.a.`],
                    ["Compounding", String(m.compounding)],
                    ["Start date", date(start)],
                    ["Maturity date", date(end)],
                    ["Accrued value today", inr(h.value)],
                    ["Value at maturity", inr(maturityValue)],
                  ]}
                />
                <div>
                  <div className="mb-1.5 flex justify-between text-xs text-muted">
                    <span>Term elapsed</span>
                    <span className="tnum">{pct(done * 100, 0)}</span>
                  </div>
                  <ScoreBar value={done * 100} tone="pos" />
                </div>
              </div>
            );
          })()}
        </Card>
      ) : (
        <Card title="Price history" subtitle={`Last 3 years${physical ? " · international reference converted to INR per gram" : ""}`}>
          <PriceChart d={d} h={h} />
        </Card>
      )}

      {!isFd && (
        <Card
          title="Transactions"
          subtitle="Purchases, SIP instalments and sales. Holdings and average cost are recomputed from these."
          pad={false}
          actions={
            <Button size="sm" variant="ghost" onClick={() => (setEditTx(null), setTxOpen(true))}>
              <Plus className="h-3.5 w-3.5" /> Add
            </Button>
          }
        >
          <div className="relative overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th className="!text-right">Quantity</th>
                  <th className="!text-right">Price</th>
                  <th className="!text-right">Fees</th>
                  <th className="!text-right">Amount</th>
                  <th>Source</th>
                  <th className="!text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...d.transactions].reverse().map((t) => (
                  <tr key={t.id}>
                    <td className="whitespace-nowrap">{date(t.trade_date)}</td>
                    <td>
                      <Badge tone={t.type === "BUY" ? "pos" : "neg"}>{t.type === "BUY" ? "Purchase" : "Sale"}</Badge>
                    </td>
                    <td className="text-right tnum">{qty(t.quantity)}</td>
                    <td className="text-right tnum">{inr(t.price, { decimals: true })}</td>
                    <td className="text-right tnum text-muted">{t.fees ? inr(t.fees, { decimals: true }) : "—"}</td>
                    <td className="text-right font-medium tnum">{inr(t.quantity * t.price + (t.type === "BUY" ? t.fees : -t.fees))}</td>
                    <td className="text-xs capitalize text-faint">{t.source}</td>
                    <td className="whitespace-nowrap text-right">
                      <button className="btn-quiet !p-1.5" onClick={() => (setEditTx(t), setTxOpen(true))} aria-label={`Edit transaction on ${date(t.trade_date)}`}>
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button className="btn-quiet !p-1.5 hover:!text-neg" onClick={() => setDelTx(t)} aria-label={`Delete transaction on ${date(t.trade_date)}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {isFund && (
        <Card
          title="What's inside this fund"
          subtitle={
            d.lookthrough.length
              ? `Your share of each disclosed holding · disclosure ${date(d.lookthrough[0].disclosure_date)}`
              : "No look-through data for this scheme yet"
          }
          pad={false}
          actions={
            d.lookthrough.length ? (
              <Link to="/app/exposure" className="btn-quiet !px-2 !py-1 text-xs">
                True Exposure
              </Link>
            ) : undefined
          }
        >
          {d.lookthrough.length ? (
            <>
              <div className="relative overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Holding</th>
                      <th>Sector / type</th>
                      <th>Fund weight</th>
                      <th className="!text-right">Your share (est.)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.lookthrough.map((r, i) => {
                      const muted = /not itemised|cash|debt|money market|securities|treasury/i.test(r.name) || r.asset_type !== "equity";
                      return (
                        <tr key={i} className={clsx(muted && "text-muted")}>
                          <td className={clsx("max-w-[280px] truncate", !muted && "font-medium text-ink")}>{r.name}</td>
                          <td className="text-xs">{r.sector ?? <span className="capitalize">{r.asset_type}</span>}</td>
                          <td>
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface2">
                                <div className={clsx("h-full rounded-full", muted ? "bg-faint" : "bg-accent")} style={{ width: `${Math.min(100, r.weight * 2)}%` }} />
                              </div>
                              <span className="tnum text-xs">{pct(r.weight, 1)}</span>
                            </div>
                          </td>
                          <td className="text-right tnum">{inr(r.value)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="px-5 py-3 text-[11px] text-faint">
                Source: {d.lookthrough[0].source}. Fund portfolios are periodic disclosures, not live positions — your share is an estimate.
              </p>
            </>
          ) : (
            <p className="px-5 pb-5 text-sm text-muted">This scheme isn't in FinLex's look-through dataset yet, so its underlying companies can't be shown.</p>
          )}
        </Card>
      )}

      <Card title="Holding settings">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Account">
            <Select
              value={settings.account_id}
              onChange={(e) => {
                setSettings({ ...settings, account_id: e.target.value });
                setDirty(true);
              }}
            >
              {!settings.account_id && <option value="">Unassigned</option>}
              {(accounts.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </Select>
          </Field>
          {physical && (
            <Field label="Purity">
              <Select
                value={settings.purity}
                onChange={(e) => {
                  setSettings({ ...settings, purity: e.target.value });
                  setDirty(true);
                }}
              >
                {(inst.asset_class === "gold"
                  ? [
                      ["0.999", "24K (999)"],
                      ["0.916", "22K (916)"],
                      ["0.75", "18K (750)"],
                    ]
                  : [
                      ["0.999", "Fine (999)"],
                      ["0.925", "Sterling (925)"],
                    ]
                ).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Notes" className={physical ? "" : "md:col-span-2"}>
            <Textarea
              className="!min-h-[42px]"
              rows={1}
              maxLength={500}
              value={settings.notes}
              placeholder="Add a note (e.g. where the certificate is kept)"
              onChange={(e) => {
                setSettings({ ...settings, notes: e.target.value });
                setDirty(true);
                setNotesTouched(true);
              }}
            />
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <Button variant="danger" className="btn-danger" size="sm" onClick={() => setDelHolding(true)}>
            <Trash2 className="h-3.5 w-3.5" /> Delete holding
          </Button>
          <Button disabled={!dirty} loading={patch.isPending} onClick={() => patch.mutate()}>
            <Save className="h-4 w-4" /> Save changes
          </Button>
        </div>
      </Card>

      <TxModal open={txOpen} onClose={() => setTxOpen(false)} holdingId={hid} tx={editTx} unit={unit} />
      <Modal
        open={!!delTx}
        onClose={() => setDelTx(null)}
        title="Delete this transaction?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDelTx(null)}>
              Cancel
            </Button>
            <Button variant="danger" className="btn-danger" loading={removeTx.isPending} onClick={() => delTx && removeTx.mutate(delTx)}>
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          {delTx && `${delTx.type === "BUY" ? "Purchase" : "Sale"} of ${qty(delTx.quantity)} on ${date(delTx.trade_date)} at ${inr(delTx.price, { decimals: true })}.`} Quantity, average cost and
          returns will be recomputed. {d.transactions.length <= 1 && "This is the only transaction, so the holding will be removed."}
        </p>
      </Modal>
      <Modal
        open={delHolding}
        onClose={() => setDelHolding(false)}
        title="Delete this holding?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDelHolding(false)}>
              Cancel
            </Button>
            <Button variant="danger" className="btn-danger" loading={removeHolding.isPending} onClick={() => removeHolding.mutate()}>
              Delete permanently
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          {displayName(h)} and its {d.transactions.length} transaction(s) will be removed from your portfolio. This can't be undone.
        </p>
      </Modal>
    </div>
  );
}
