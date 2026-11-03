/* "Add holding" modal: stocks/ETFs, mutual funds (AMFI search), physical gold/silver or metal ETFs, fixed deposits. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Check, Landmark, Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { InstrumentPicker } from "@/components/InstrumentPicker";
import { Button, Field, InstrumentAvatar, Input, Modal, Notice, Select, Tabs, toast } from "@/components/ui";
import { api, qs } from "@/lib/api";
import { date, inr, num } from "@/lib/format";
import type { InstrumentRef } from "@/lib/types";
import { displayName, QUERY_KEYS_TO_REFRESH, todayIST } from "./common";

type Kind = "stock" | "mf" | "metal" | "fd";
type Account = { id: number; label: string; account_type: string; holdings?: number };
type MfHit = { code: string; name: string; isin: string | null; nav: string | null; date: string | null; instrument_id: number | null };

const NEW_ACCOUNT = "__new__";
const GOLD_PURITY = [
  { v: 0.999, l: "24K (999)" },
  { v: 0.916, l: "22K (916)" },
  { v: 0.75, l: "18K (750)" },
];
const SILVER_PURITY = [
  { v: 0.999, l: "Fine silver (999)" },
  { v: 0.925, l: "Sterling (925)" },
];

export function useRefreshPortfolio() {
  const qc = useQueryClient();
  return () => QUERY_KEYS_TO_REFRESH.forEach((k) => qc.invalidateQueries({ queryKey: k }));
}

function SelectedInstrument({ inst, onClear, note }: { inst: InstrumentRef; onClear: () => void; note?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/[0.06] px-3 py-2.5">
      <InstrumentAvatar symbol={inst.symbol} assetClass={inst.asset_class} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{inst.name}</div>
        <div className="truncate text-xs text-muted">
          {inst.asset_class === "mf" ? `AMFI ${inst.amfi_code}` : inst.symbol}
          {inst.quote ? ` · last ${inst.quote.synthetic ? "(synthetic) " : ""}${inr(inst.quote.price, { decimals: true })} on ${date(inst.quote.as_of)}` : ""}
          {note ? ` · ${note}` : ""}
        </div>
      </div>
      <button type="button" className="btn-quiet !p-1.5" onClick={onClear} aria-label="Change instrument">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function AddHoldingModal({ open, onClose, initialKind = "stock" }: { open: boolean; onClose: () => void; initialKind?: Kind }) {
  const refresh = useRefreshPortfolio();
  const [kind, setKind] = useState<Kind>(initialKind);
  const [inst, setInst] = useState<InstrumentRef | null>(null);
  const [metalMode, setMetalMode] = useState<"gold" | "silver" | "etf">("gold");
  const [purity, setPurity] = useState(0.999);
  const [form, setForm] = useState({ quantity: "", price: "", trade_date: todayIST(), fees: "", notes: "" });
  const [fd, setFd] = useState({ bank: "", principal: "", rate: "", start_date: todayIST(), maturity_date: "", compounding: "quarterly" });
  const [accountSel, setAccountSel] = useState<string>("");
  const [newAccount, setNewAccount] = useState("");
  const [symbol, setSymbol] = useState("");
  const [mfQuery, setMfQuery] = useState("");
  const [mfDebounced, setMfDebounced] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const today = todayIST();

  useEffect(() => {
    if (open) {
      setKind(initialKind);
      setErr(null);
    }
  }, [open, initialKind]);

  useEffect(() => {
    const t = setTimeout(() => setMfDebounced(mfQuery.trim()), 300);
    return () => clearTimeout(t);
  }, [mfQuery]);

  const accounts = useQuery({ queryKey: ["accounts"], queryFn: () => api.get<Account[]>("/api/accounts"), enabled: open });
  const metals = useQuery({
    queryKey: ["instruments", "metals-ref"],
    queryFn: () => api.get<InstrumentRef[]>(`/api/instruments${qs({ asset_class: "gold,silver", limit: 10 })}`),
    enabled: open && kind === "metal",
  });
  const mfHits = useQuery({
    queryKey: ["mf-search", mfDebounced],
    queryFn: () => api.get<MfHit[]>(`/api/instruments/search-mf${qs({ q: mfDebounced })}`),
    enabled: open && kind === "mf" && mfDebounced.length >= 3 && !inst,
    staleTime: 5 * 60_000,
  });

  const refMetal = useMemo(() => (metals.data ?? []).find((m) => m.symbol === (metalMode === "silver" ? "SILVER" : "GOLD")), [metals.data, metalMode]);
  useEffect(() => {
    if (kind === "metal" && metalMode !== "etf") setInst(refMetal ?? null);
  }, [kind, metalMode, refMetal]);

  const perGramRef = refMetal?.quote ? (refMetal.quote.price / (metalMode === "silver" ? 1000 : 10)) * (purity / 0.999) : null;

  const reset = () => {
    setInst(null);
    setForm({ quantity: "", price: "", trade_date: todayIST(), fees: "", notes: "" });
    setFd({ bank: "", principal: "", rate: "", start_date: todayIST(), maturity_date: "", compounding: "quarterly" });
    setSymbol("");
    setMfQuery("");
    setAccountSel("");
    setNewAccount("");
    setMetalMode("gold");
    setPurity(0.999);
    setErr(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const addEquity = useMutation({
    mutationFn: (sym: string) => api.post<InstrumentRef>("/api/instruments/add-equity", { symbol: sym.trim().toUpperCase(), etf: false }),
    onSuccess: (i) => {
      setInst(i);
      setSymbol("");
      setErr(null);
    },
    onError: (e) => setErr((e as Error).message),
  });
  const addMf = useMutation({
    mutationFn: (code: string) => api.post<InstrumentRef>("/api/instruments/add-mf", { code }),
    onSuccess: (i) => {
      setInst(i);
      setErr(null);
    },
    onError: (e) => setErr((e as Error).message),
  });

  const accountPayload = () => {
    if (accountSel === NEW_ACCOUNT) return newAccount.trim() ? { account_label: newAccount.trim() } : {};
    if (accountSel) return { account_id: Number(accountSel) };
    return {};
  };

  const save = useMutation({
    mutationFn: async () => {
      if (kind === "fd") {
        return api.post<{ id: number }>("/api/holdings/fd", {
          bank: fd.bank.trim(),
          principal: Number(fd.principal),
          rate: Number(fd.rate),
          start_date: fd.start_date,
          maturity_date: fd.maturity_date,
          compounding: fd.compounding,
          ...(accountSel === NEW_ACCOUNT ? { account_label: newAccount.trim() || fd.bank.trim() } : accountSel ? { account_id: Number(accountSel) } : {}),
        });
      }
      return api.post<{ id: number }>("/api/holdings", {
        instrument_id: inst!.id,
        quantity: Number(form.quantity),
        price: Number(form.price),
        trade_date: form.trade_date,
        fees: form.fees ? Number(form.fees) : 0,
        notes: form.notes,
        ...(kind === "metal" && metalMode !== "etf" ? { purity } : {}),
        ...accountPayload(),
      });
    },
    onSuccess: () => {
      toast(kind === "fd" ? "Fixed deposit added" : `${inst ? displayName({ instrument: inst }) : "Holding"} added to your portfolio`);
      refresh();
      close();
    },
    onError: (e) => setErr((e as Error).message),
  });

  const validate = (): string | null => {
    if (accountSel === NEW_ACCOUNT && !newAccount.trim() && kind !== "fd") return "Enter a name for the new account.";
    if (kind === "fd") {
      if (!fd.bank.trim()) return "Enter the bank or institution.";
      if (!(Number(fd.principal) > 0)) return "Principal must be a positive amount.";
      const r = Number(fd.rate);
      if (!(r > 0 && r < 30)) return "Interest rate must be between 0 and 30% p.a.";
      if (!fd.maturity_date) return "Choose a maturity date.";
      if (fd.maturity_date <= fd.start_date) return "Maturity must be after the start date.";
      if (fd.start_date > today) return "Start date can't be in the future.";
      return null;
    }
    if (!inst) return "Choose an instrument first.";
    if (!(Number(form.quantity) > 0)) return kind === "metal" && metalMode !== "etf" ? "Weight in grams must be positive." : "Quantity must be positive.";
    if (form.price === "" || Number(form.price) < 0 || Number.isNaN(Number(form.price))) return "Enter the price you paid per unit.";
    if (!form.trade_date) return "Choose the purchase date.";
    if (form.trade_date > today) return "Purchase date can't be in the future.";
    if (form.fees && Number(form.fees) < 0) return "Fees can't be negative.";
    return null;
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = validate();
    if (v) {
      setErr(v);
      return;
    }
    setErr(null);
    save.mutate();
  };

  const physical = kind === "metal" && metalMode !== "etf";
  const qtyLabel = physical ? "Weight (grams)" : kind === "mf" ? "Units" : "Quantity";
  const priceLabel = physical ? "Price paid per gram (₹)" : kind === "mf" ? "Purchase NAV (₹)" : "Price per unit (₹)";
  const amount = Number(form.quantity) * Number(form.price) + (Number(form.fees) || 0);

  return (
    <Modal
      open={open}
      onClose={close}
      title="Add a holding"
      wide
      footer={
        <>
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form="add-holding-form" loading={save.isPending}>
            <Plus className="h-4 w-4" /> Add to portfolio
          </Button>
        </>
      }
    >
      <div className="mb-4">
        <Tabs<Kind>
          value={kind}
          onChange={(k) => {
            setKind(k);
            setInst(null);
            setErr(null);
          }}
          items={[
            { value: "stock", label: "Stock / ETF" },
            { value: "mf", label: "Mutual fund" },
            { value: "metal", label: "Gold / Silver" },
            { value: "fd", label: "Fixed deposit" },
          ]}
          className="w-full"
        />
      </div>
      <form id="add-holding-form" onSubmit={submit} className="space-y-4" noValidate>
        {kind === "stock" && (
          <div className="space-y-2">
            {inst ? (
              <SelectedInstrument inst={inst} onClear={() => setInst(null)} />
            ) : (
              <>
                <Field label="Search NSE stocks & ETFs">
                  <InstrumentPicker assetClass="equity,etf" onSelect={setInst} placeholder="e.g. RELIANCE, HDFC Bank, NIFTYBEES" autoFocus />
                </Field>
                <div className="flex flex-col gap-2 rounded-xl border border-dashed border-line px-3 py-2.5 sm:flex-row sm:items-end">
                  <Field label="Not listed? Add any NSE symbol" className="flex-1">
                    <Input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} placeholder="e.g. TATAELXSI" maxLength={20} />
                  </Field>
                  <Button type="button" variant="ghost" disabled={!/^[A-Z0-9&-]{1,20}$/.test(symbol)} loading={addEquity.isPending} onClick={() => addEquity.mutate(symbol)}>
                    Look up symbol
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {kind === "mf" &&
          (inst ? (
            <SelectedInstrument inst={inst} onClear={() => setInst(null)} />
          ) : (
            <div className="space-y-2">
              <Field label="Search any AMFI scheme" hint="Searches the full AMFI scheme list by name — check the plan (Direct/Regular) and option (Growth/IDCW) before choosing.">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
                  <Input className="pl-9" value={mfQuery} onChange={(e) => setMfQuery(e.target.value)} placeholder="e.g. parag parikh flexi" autoFocus />
                </div>
              </Field>
              {mfDebounced.length >= 3 && (
                <ul className="max-h-64 overflow-y-auto rounded-xl border border-line bg-surface2/30 p-1" aria-label="Scheme results">
                  {mfHits.isLoading && <li className="px-3 py-2 text-sm text-muted">Searching AMFI schemes…</li>}
                  {mfHits.error && <li className="px-3 py-2 text-sm text-neg">{(mfHits.error as Error).message}</li>}
                  {mfHits.data?.length === 0 && <li className="px-3 py-2 text-sm text-muted">No schemes match “{mfDebounced}”.</li>}
                  {mfHits.data?.map((h) => (
                    <li key={h.code}>
                      <button
                        type="button"
                        disabled={addMf.isPending}
                        className="flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-surface2 disabled:opacity-60"
                        onClick={() => {
                          if (h.instrument_id) {
                            api.get<InstrumentRef>(`/api/instruments/${h.instrument_id}`).then(setInst, (e) => setErr((e as Error).message));
                          } else addMf.mutate(h.code);
                        }}
                      >
                        <InstrumentAvatar symbol="MF" assetClass="mf" className="!h-7 !w-7 !text-[10px]" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-ink">{h.name}</span>
                          <span className="block text-xs text-faint">
                            AMFI {h.code}
                            {h.nav && Number.isFinite(Number(h.nav))
                              ? ` · NAV ₹${h.nav}${h.date ? ` on ${h.date}` : ""}`
                              : [h.nav, h.date].filter(Boolean).length
                                ? ` · ${[h.nav, h.date].filter(Boolean).join(" · ")}`
                                : ""}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {addMf.isPending && <p className="text-xs text-muted">Adding scheme and loading its NAV history…</p>}
            </div>
          ))}

        {kind === "metal" && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Metal type">
              {(
                [
                  ["gold", "Physical gold", "Coins, bars, jewellery"],
                  ["silver", "Physical silver", "Coins, bars, utensils"],
                  ["etf", "Gold / silver ETF", "Exchange-traded units"],
                ] as const
              ).map(([v, l, d]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={metalMode === v}
                  onClick={() => {
                    setMetalMode(v);
                    setPurity(0.999);
                    setInst(null);
                  }}
                  className={clsx(
                    "rounded-xl border px-3 py-2.5 text-left transition",
                    metalMode === v ? "border-accent/60 bg-accent/[0.08] ring-1 ring-accent/30" : "border-line hover:bg-surface2",
                  )}
                >
                  <div className="text-sm font-semibold">{l}</div>
                  <div className="text-xs text-faint">{d}</div>
                </button>
              ))}
            </div>
            {metalMode === "etf" ? (
              inst ? (
                <SelectedInstrument inst={inst} onClear={() => setInst(null)} />
              ) : (
                <Field label="Search ETFs">
                  <InstrumentPicker assetClass="etf" onSelect={setInst} placeholder="e.g. GOLDBEES, SILVERBEES" />
                </Field>
              )
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Purity">
                  <Select value={String(purity)} onChange={(e) => setPurity(Number(e.target.value))}>
                    {(metalMode === "silver" ? SILVER_PURITY : GOLD_PURITY).map((p) => (
                      <option key={p.v} value={p.v}>
                        {p.l}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="rounded-xl border border-line bg-surface2/40 px-3 py-2 text-xs text-muted">
                  <div className="font-medium text-ink">Reference value today</div>
                  {perGramRef ? (
                    <>
                      ≈ {inr(perGramRef, { decimals: true })} per gram at this purity
                      <div className="mt-0.5 text-faint">International rate in INR; excludes import duty, GST and making charges. Valuations are labelled as estimates.</div>
                    </>
                  ) : (
                    "Loading reference price…"
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {kind === "fd" ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Bank / institution">
              <div className="relative">
                <Landmark className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
                <Input className="pl-9" value={fd.bank} onChange={(e) => setFd({ ...fd, bank: e.target.value })} placeholder="e.g. SBI, HDFC Bank" maxLength={120} autoFocus />
              </div>
            </Field>
            <Field label="Principal (₹)">
              <Input type="number" inputMode="decimal" min={0} step="any" value={fd.principal} onChange={(e) => setFd({ ...fd, principal: e.target.value })} />
            </Field>
            <Field label="Interest rate (% p.a.)">
              <Input type="number" inputMode="decimal" min={0} max={30} step="0.01" value={fd.rate} onChange={(e) => setFd({ ...fd, rate: e.target.value })} />
            </Field>
            <Field label="Compounding">
              <Select value={fd.compounding} onChange={(e) => setFd({ ...fd, compounding: e.target.value })}>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly (most banks)</option>
                <option value="half-yearly">Half-yearly</option>
                <option value="annual">Annual</option>
                <option value="simple">Simple interest</option>
              </Select>
            </Field>
            <Field label="Start date">
              <Input type="date" max={today} value={fd.start_date} onChange={(e) => setFd({ ...fd, start_date: e.target.value })} />
            </Field>
            <Field label="Maturity date">
              <Input type="date" min={fd.start_date} value={fd.maturity_date} onChange={(e) => setFd({ ...fd, maturity_date: e.target.value })} />
            </Field>
          </div>
        ) : (
          (inst || physical) && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={qtyLabel}>
                <Input type="number" inputMode="decimal" min={0} step="any" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
              </Field>
              <Field
                label={priceLabel}
                hint={
                  inst?.quote && !physical ? (
                    <button type="button" className="text-accent hover:underline" onClick={() => setForm({ ...form, price: String(Number(inst.quote!.price.toFixed(4))) })}>
                      Use latest price {inr(inst.quote.price, { decimals: true })}
                    </button>
                  ) : physical && perGramRef ? (
                    <button type="button" className="text-accent hover:underline" onClick={() => setForm({ ...form, price: perGramRef.toFixed(2) })}>
                      Use reference {inr(perGramRef, { decimals: true })}/g
                    </button>
                  ) : undefined
                }
              >
                <Input type="number" inputMode="decimal" min={0} step="any" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
              </Field>
              <Field label="Purchase date">
                <Input type="date" max={today} value={form.trade_date} onChange={(e) => setForm({ ...form, trade_date: e.target.value })} />
              </Field>
              <Field label="Fees & charges (₹, optional)" hint="Brokerage, stamp duty, making charges…">
                <Input type="number" inputMode="decimal" min={0} step="any" value={form.fees} onChange={(e) => setForm({ ...form, fees: e.target.value })} />
              </Field>
              <Field label="Note (optional)" className="sm:col-span-2">
                <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} maxLength={500} placeholder={physical ? "e.g. 22K coins from …" : "e.g. SIP, long-term"} />
              </Field>
            </div>
          )
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Account / where it's held" hint="Keeps each broker, folio or locker separate.">
            <Select value={accountSel} onChange={(e) => setAccountSel(e.target.value)}>
              <option value="">{kind === "fd" ? "Use the bank name" : "Unassigned"}</option>
              {(accounts.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
              <option value={NEW_ACCOUNT}>+ New account…</option>
            </Select>
          </Field>
          {accountSel === NEW_ACCOUNT && (
            <Field label="New account name">
              <Input value={newAccount} onChange={(e) => setNewAccount(e.target.value)} placeholder="e.g. Zerodha, Groww, Home locker" maxLength={120} autoFocus />
            </Field>
          )}
        </div>

        {kind !== "fd" && Number(form.quantity) > 0 && Number(form.price) >= 0 && form.price !== "" && (
          <div className="flex items-center gap-2 rounded-lg bg-surface2/60 px-3 py-2 text-sm text-muted">
            <Check className="h-4 w-4 text-pos" />
            Cost basis {inr(amount, { decimals: true })} for {num(Number(form.quantity), Number(form.quantity) % 1 ? 3 : 0)} {physical ? "g" : "units"}
          </div>
        )}
        {err && <Notice tone="neg">{err}</Notice>}
      </form>
    </Modal>
  );
}
