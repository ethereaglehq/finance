import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Bell, BellRing, CheckCheck, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { InstrumentPicker } from "@/components/InstrumentPicker";
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, Notice, PageHeader, Select, Skeleton, Switch, toast } from "@/components/ui";
import { api } from "@/lib/api";
import { ago, dateTime } from "@/lib/format";
import type { Alert, AlertEvent, InstrumentRef } from "@/lib/types";

const NEEDS_INSTRUMENT = new Set(["price_move", "price_above", "price_below", "new_filing"]);
const NO_THRESHOLD = new Set(["new_filing", "data_stale"]);
const DEFAULTS: Record<string, number> = { price_move: 2, concentration: 10, sector: 30, price_above: 0, price_below: 0 };

function thresholdLabel(rule: string, inst: InstrumentRef | null): string {
  if (rule === "price_move") return "Daily move (±%)";
  if (rule === "concentration") return "Single company above (%)";
  if (rule === "sector") return "Any sector above (%)";
  if (rule === "price_above" || rule === "price_below") return inst?.unit === "points" ? "Level (index points)" : "Price level (₹)";
  return "Threshold";
}

function describe(a: Alert): string {
  const t = a.threshold;
  switch (a.rule_type) {
    case "price_move": return `Daily move of ±${t}% or more`;
    case "price_above": return `Price above ${t.toLocaleString("en-IN")}`;
    case "price_below": return `Price below ${t.toLocaleString("en-IN")}`;
    case "concentration": return `Any company ≥ ${t}% of portfolio (look-through)`;
    case "sector": return `Any sector ≥ ${t}% of portfolio`;
    case "new_filing": return "New results document added";
    case "data_stale": return "A holding's price becomes stale or missing";
    default: return a.rule_label;
  }
}

export default function Alerts() {
  const qc = useQueryClient();
  const alerts = useQuery({ queryKey: ["alerts"], queryFn: () => api.get<{ alerts: Alert[]; rule_types: Record<string, string> }>("/api/alerts") });
  const events = useQuery({ queryKey: ["alert-events"], queryFn: () => api.get<AlertEvent[]>("/api/alerts/events") });
  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["alerts"] });
    qc.invalidateQueries({ queryKey: ["alert-events"] });
  };
  const evaluate = useMutation({
    mutationFn: () => api.post<{ triggered: number; messages: string[] }>("/api/alerts/evaluate"),
    onSuccess: (r) => {
      toast(r.triggered ? `${r.triggered} alert${r.triggered > 1 ? "s" : ""} triggered` : "Checked — nothing new triggered", r.triggered ? "warn" : "pos");
      refreshAll();
    },
    onError: (e) => toast((e as Error).message, "neg"),
  });
  const readAll = useMutation({
    mutationFn: () => api.post("/api/alerts/events/read-all"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alert-events"] }),
  });
  const unread = (events.data ?? []).filter((e) => !e.read).length;

  return (
    <div>
      <PageHeader
        eyebrow="Settings"
        title="Alerts"
        subtitle="Rules you define, checked every refresh. Notifications appear in-app (the bell in the header); FinLex never sends trade prompts."
        actions={
          <Button variant="ghost" loading={evaluate.isPending} onClick={() => evaluate.mutate()}>
            <RefreshCw className="h-4 w-4" /> Check now
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-5">
          <CreateAlert ruleTypes={alerts.data?.rule_types} onCreated={refreshAll} />
          <Notice tone="info">Alerts describe what happened — a move, a threshold, a new document. They are not signals to act.</Notice>
        </div>
        <div className="space-y-5">
          <Card title="Your alerts" subtitle={alerts.data ? `${alerts.data.alerts.length} rule${alerts.data.alerts.length === 1 ? "" : "s"}` : undefined} pad={false}>
            {alerts.isLoading ? (
              <div className="space-y-3 p-5">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
            ) : alerts.error ? (
              <ErrorState error={alerts.error} onRetry={() => alerts.refetch()} />
            ) : !alerts.data?.alerts.length ? (
              <EmptyState icon={<Bell className="h-5 w-5" />} title="No alerts yet">Create one on the left — e.g. a ±2% daily move on NIFTY 50, or a 10% single-company concentration limit.</EmptyState>
            ) : (
              <ul className="divide-y divide-line/50">
                {alerts.data.alerts.map((a) => <AlertRow key={a.id} a={a} onChange={refreshAll} />)}
              </ul>
            )}
          </Card>
          <Card
            title={<span className="flex items-center gap-2">Notifications {unread > 0 && <Badge tone="neg">{unread} new</Badge>}</span>}
            actions={unread > 0 && (
              <Button variant="quiet" size="sm" loading={readAll.isPending} onClick={() => readAll.mutate()}>
                <CheckCheck className="h-4 w-4" /> Mark all read
              </Button>
            )}
            pad={false}
          >
            {events.isLoading ? (
              <div className="space-y-3 p-5">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
            ) : events.error ? (
              <ErrorState error={events.error} />
            ) : !events.data?.length ? (
              <EmptyState icon={<BellRing className="h-5 w-5" />} title="No notifications">When an alert's condition is met, it shows up here.</EmptyState>
            ) : (
              <ul className="divide-y divide-line/50">
                {events.data.map((e) => (
                  <li key={e.id} className={clsx("flex gap-3 px-4 py-3 sm:px-5", !e.read && "bg-accent/[0.05]")}>
                    <span className={clsx("mt-1.5 h-2 w-2 shrink-0 rounded-full", e.read ? "bg-line" : "bg-accent")} aria-label={e.read ? "read" : "unread"} />
                    <div className="min-w-0">
                      <p className={clsx("text-sm", e.read ? "text-muted" : "font-medium text-ink")}>{e.message}</p>
                      <p className="mt-0.5 text-[11px] text-faint" title={dateTime(e.triggered_at)}>{ago(e.triggered_at)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function CreateAlert({ ruleTypes, onCreated }: { ruleTypes?: Record<string, string>; onCreated: () => void }) {
  const [rule, setRule] = useState("price_move");
  const [inst, setInst] = useState<InstrumentRef | null>(null);
  const [threshold, setThreshold] = useState<string>("2");
  const needsInst = NEEDS_INSTRUMENT.has(rule);
  const needsThr = !NO_THRESHOLD.has(rule);
  const m = useMutation({
    mutationFn: () => api.post<Alert>("/api/alerts", { rule_type: rule, instrument_id: needsInst ? inst?.id : null, threshold: needsThr ? Number(threshold) : 0, enabled: true }),
    onSuccess: () => {
      toast("Alert created");
      setInst(null);
      onCreated();
    },
  });
  const thrNum = Number(threshold);
  const thrValid = !needsThr || (thrNum > 0 && (rule.startsWith("price_a") || rule.startsWith("price_b") || thrNum <= 100));
  const ready = (!needsInst || inst) && thrValid;
  return (
    <Card title={<span className="flex items-center gap-2"><Plus className="h-4 w-4 text-accent" /> New alert</span>}>
      <form className="space-y-3.5" onSubmit={(e) => { e.preventDefault(); if (ready) m.mutate(); }}>
        {m.error && <Notice tone="neg">{(m.error as Error).message}</Notice>}
        <Field label="Rule">
          <Select
            value={rule}
            onChange={(e) => {
              setRule(e.target.value);
              const d = DEFAULTS[e.target.value];
              setThreshold(d ? String(d) : inst?.quote?.price ? String(Math.round(inst.quote.price)) : "");
            }}
          >
            {Object.entries(ruleTypes ?? { price_move: "Daily move beyond ±threshold %" }).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        {needsInst && (
          <Field label="Instrument" group>
            {inst ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface2/60 px-3 py-2 text-sm">
                <span className="min-w-0 truncate">{inst.name} <span className="text-faint">({inst.symbol})</span></span>
                <button type="button" className="shrink-0 text-xs text-accent hover:underline" onClick={() => setInst(null)}>Change</button>
              </div>
            ) : (
              <InstrumentPicker
                assetClass={rule === "new_filing" ? "equity" : undefined}
                onSelect={(i) => {
                  setInst(i);
                  if ((rule === "price_above" || rule === "price_below") && i.quote?.price) setThreshold(String(Math.round(i.quote.price)));
                }}
              />
            )}
          </Field>
        )}
        {needsThr && (
          <Field label={thresholdLabel(rule, inst)} error={threshold && !thrValid ? "Enter a positive value (≤ 100 for percentages)" : null}
            hint={(rule === "price_above" || rule === "price_below") && inst?.quote ? `Current: ${inst.quote.price.toLocaleString("en-IN")}` : undefined}>
            <Input type="number" inputMode="decimal" min={0} step="any" value={threshold} onChange={(e) => setThreshold(e.target.value)} className="tnum" />
          </Field>
        )}
        <Button type="submit" className="w-full" loading={m.isPending} disabled={!ready}>Create alert</Button>
      </form>
    </Card>
  );
}

function AlertRow({ a, onChange }: { a: Alert; onChange: () => void }) {
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api.put(`/api/alerts/${a.id}`, { rule_type: a.rule_type, instrument_id: a.instrument?.id ?? null, threshold: a.threshold, enabled }),
    onSuccess: onChange,
    onError: (e) => toast((e as Error).message, "neg"),
  });
  const del = useMutation({
    mutationFn: () => api.del(`/api/alerts/${a.id}`),
    onSuccess: () => {
      toast("Alert deleted");
      onChange();
    },
  });
  return (
    <li className="flex items-center gap-3 px-4 py-3 sm:px-5">
      <Switch checked={a.enabled} disabled={toggle.isPending} onChange={(v) => toggle.mutate(v)} />
      <div className={clsx("min-w-0 flex-1", !a.enabled && "opacity-60")}>
        <div className="truncate text-sm font-medium text-ink">
          {a.instrument ? <>{a.instrument.name} <span className="text-faint">· </span></> : null}
          {describe(a)}
        </div>
        <div className="mt-0.5 text-[11px] text-faint">
          {a.last_triggered_at ? <>Last triggered {ago(a.last_triggered_at)}</> : "Not triggered yet"} · created {ago(a.created_at)}
        </div>
      </div>
      <button className="btn-quiet !p-2 hover:!text-neg" aria-label="Delete alert" onClick={() => window.confirm("Delete this alert?") && del.mutate()} disabled={del.isPending}>
        <Trash2 className="h-4 w-4" />
      </button>
    </li>
  );
}
