import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Check, Download, KeyRound, LogOut, RefreshCw, ShieldCheck, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Badge, Button, Card, ErrorState, Field, Input, Notice, PageHeader, Select, Skeleton, Switch, Tabs, toast } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { ago, dateTime } from "@/lib/format";
import type { SourceRow, Status, User } from "@/lib/types";

type Tab = "profile" | "privacy" | "sources" | "security" | "data";
const TABS: { value: Tab; label: string }[] = [
  { value: "profile", label: "Profile" },
  { value: "privacy", label: "Privacy & AI" },
  { value: "sources", label: "Data sources" },
  { value: "security", label: "Security" },
  { value: "data", label: "Your data" },
];

interface SettingsResp {
  user: User;
  llm_configured: boolean;
}

export default function Settings() {
  const [sp, setSp] = useSearchParams();
  const tab = (TABS.some((t) => t.value === sp.get("tab")) ? sp.get("tab") : "profile") as Tab;
  const q = useQuery({ queryKey: ["settings"], queryFn: () => api.get<SettingsResp>("/api/settings") });
  return (
    <div>
      <PageHeader eyebrow="Settings" title="Settings & data" subtitle="Your profile, privacy choices, the data sources behind every number, security, and full export or deletion of your data." />
      <Tabs<Tab> className="mb-5" value={tab} onChange={(v) => setSp(v === "profile" ? {} : { tab: v }, { replace: true })} items={TABS} />
      {q.isLoading ? (
        <Skeleton className="h-80 w-full rounded-2xl" />
      ) : q.error ? (
        <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>
      ) : (
        <>
          {tab === "profile" && <Profile user={q.data!.user} />}
          {tab === "privacy" && <Privacy s={q.data!} />}
          {tab === "sources" && <Sources />}
          {tab === "security" && <Security user={q.data!.user} />}
          {tab === "data" && <DataTab user={q.data!.user} />}
        </>
      )}
    </div>
  );
}

function useSaveSettings() {
  const qc = useQueryClient();
  const { refresh } = useAuth();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch<{ user: User }>("/api/settings", body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["settings"] });
      // preferences drive exposure thresholds and plan rules
      qc.invalidateQueries({ queryKey: ["exposure"] });
      qc.invalidateQueries({ queryKey: ["plan-review"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      await refresh();
    },
  });
}

/* ------------------------------------------------------------------ profile */
function Profile({ user }: { user: User }) {
  const save = useSaveSettings();
  const p = user.preferences;
  const [name, setName] = useState(user.name);
  const [risk, setRisk] = useState(p.risk_level);
  const [horizon, setHorizon] = useState(String(p.horizon_years));
  const [cThr, setCThr] = useState(String(p.company_threshold_pct));
  const [sThr, setSThr] = useState(String(p.sector_threshold_pct));
  const [goals, setGoals] = useState((p.goals ?? []).join(", "));
  const num = (s: string) => Number(s);
  const valid = num(horizon) >= 0 && num(horizon) <= 60 && num(cThr) > 0 && num(cThr) <= 100 && num(sThr) > 0 && num(sThr) <= 100;
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card title="Profile & preferences" subtitle="Used to describe your portfolio — FinLex never uses them to recommend products.">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            save.mutate(
              {
                name,
                risk_level: risk,
                horizon_years: num(horizon),
                company_threshold_pct: num(cThr),
                sector_threshold_pct: num(sThr),
                goals: goals.split(",").map((g) => g.trim()).filter(Boolean),
              },
              { onSuccess: () => toast("Preferences saved") },
            );
          }}
        >
          {save.error && <Notice tone="neg">{(save.error as Error).message}</Notice>}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Display name"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></Field>
            <Field label="Email"><Input value={user.is_demo ? "Demo session" : user.email} disabled /></Field>
            <Field label="Risk level you identify with" hint="Sets the ranges the Plan rules use.">
              <Select value={risk} onChange={(e) => setRisk(e.target.value as User["preferences"]["risk_level"])}>
                <option value="conservative">Conservative</option>
                <option value="moderate">Moderate</option>
                <option value="aggressive">Aggressive</option>
              </Select>
            </Field>
            <Field label="Investment horizon (years)">
              <Input type="number" min={0} max={60} step={0.5} value={horizon} onChange={(e) => setHorizon(e.target.value)} />
            </Field>
            <Field label="Company concentration flag (%)" hint="True Exposure flags any single company above this.">
              <Input type="number" min={1} max={100} step={0.5} value={cThr} onChange={(e) => setCThr(e.target.value)} />
            </Field>
            <Field label="Sector concentration flag (%)">
              <Input type="number" min={1} max={100} step={1} value={sThr} onChange={(e) => setSThr(e.target.value)} />
            </Field>
          </div>
          <Field label="Goals (optional, comma-separated)" hint="Just for your own reference, e.g. house deposit 2030, retirement">
            <Input value={goals} onChange={(e) => setGoals(e.target.value)} maxLength={600} />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" loading={save.isPending} disabled={!valid}>Save changes</Button>
          </div>
        </form>
      </Card>
      <Card title="Account">
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between gap-3"><dt className="text-muted">Type</dt><dd>{user.is_demo ? <Badge tone="warn">Demo (24h)</Badge> : <Badge tone="pos">Personal</Badge>}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted">Created</dt><dd className="text-ink">{dateTime(user.created_at)}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted">AI processing</dt><dd>{user.consent_llm ? <Badge tone="accent">Allowed</Badge> : <Badge>Off</Badge>}</dd></div>
        </dl>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ privacy */
function Privacy({ s }: { s: SettingsResp }) {
  const save = useSaveSettings();
  const status = useQuery({ queryKey: ["status"], queryFn: () => api.get<Status>("/api/status") });
  const on = s.user.consent_llm;
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Card title={<span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-accent" /> AI processing consent</span>}>
        <div className="flex items-start justify-between gap-4">
          <div className="text-sm text-muted">
            Allow Ask FinLex, filing interpretations and the daily brief to use an external AI model (Anthropic Claude).
          </div>
          <Switch
            checked={on}
            disabled={save.isPending}
            onChange={(v) => save.mutate({ consent_llm: v }, { onSuccess: () => toast(v ? "AI processing allowed" : "AI processing switched off") })}
          />
        </div>
        <div className="mt-4 rounded-xl border border-line/70 bg-surface2/40 p-3.5 text-sm">
          <div className="label mb-1.5">Server status</div>
          {status.data ? (
            status.data.llm_configured ? (
              <span className="text-ink">AI provider configured · model <span className="font-mono text-xs">{status.data.llm_model}</span></span>
            ) : (
              <span className="text-muted">No AI provider is configured on this server — answers always come from the local engine, whatever this switch says.</span>
            )
          ) : (
            <Skeleton className="h-4 w-48" />
          )}
        </div>
        <div className="mt-4 space-y-2 text-sm text-muted">
          <p><b className="text-ink">When on:</b> only the figures needed for a question (e.g. your sector percentages, a holding's value, a forecast range) are sent with your question. Your email, name and statements are never sent. Generated text that introduces numbers not in the data is rejected.</p>
          <p><b className="text-ink">When off:</b> the local engine answers from the same data on this server; nothing leaves it.</p>
        </div>
        {save.error && <Notice className="mt-3" tone="neg">{(save.error as Error).message}</Notice>}
      </Card>
      <Card title={<span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-pos" /> What FinLex stores</span>}>
        <List
          items={[
            [true, "Holdings, transactions, accounts and alerts you enter or import"],
            [true, "Preferences and Ask FinLex conversation history (clearable)"],
            [true, "An audit log of sign-ins, imports, exports and consent changes"],
            [false, "Broker passwords, OTPs, trading PINs or order permissions — never requested"],
            [false, "Uploaded statement PDFs or their passwords — parsed in memory, discarded"],
            [false, "Parsed import previews after you confirm or discard them"],
          ]}
        />
      </Card>
    </div>
  );
}

function List({ items }: { items: [boolean, ReactNode][] }) {
  return (
    <ul className="space-y-2.5 text-sm">
      {items.map(([ok, t], i) => (
        <li key={i} className="flex gap-2.5">
          {ok ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-pos" /> : <X className="mt-0.5 h-4 w-4 shrink-0 text-neg" />}
          <span className="text-muted">{ok ? "Stored: " : "Not stored: "}{t}</span>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ sources */
function Sources() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["sources"], queryFn: () => api.get<SourceRow[]>("/api/settings/sources") });
  const status = useQuery({ queryKey: ["status"], queryFn: () => api.get<Status>("/api/status") });
  const refresh = useMutation({
    mutationFn: () => api.post<{ refreshed: number; errors: Record<string, string> }>("/api/settings/refresh-prices"),
    onSuccess: (r) => {
      const nErr = Object.keys(r.errors ?? {}).length;
      toast(`Refreshed ${r.refreshed} instrument${r.refreshed === 1 ? "" : "s"}${nErr ? ` · ${nErr} failed` : ""}`, nErr ? "warn" : "pos");
      qc.invalidateQueries();
    },
    onError: (e) => toast((e as Error).message, "neg"),
  });
  const mode = status.data?.market_data_mode;
  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-[15px] font-semibold text-ink">Market data mode: {mode ? <span className="capitalize">{mode}</span> : "…"}</div>
            <p className="mt-0.5 text-sm text-muted">
              {mode === "synthetic"
                ? "Offline demo mode — all prices are simulated and labelled synthetic."
                : mode === "live"
                  ? "Live providers only; FinLex never substitutes simulated prices."
                  : "Live providers first; if one is unreachable for an instrument, a clearly labelled synthetic series is used instead."}
              {status.data && <> · {status.data.instruments_with_prices} instruments priced</>}
            </p>
          </div>
          <Button variant="ghost" loading={refresh.isPending} onClick={() => refresh.mutate()}>
            <RefreshCw className="h-4 w-4" /> Refresh my prices
          </Button>
        </div>
      </Card>
      <Card title="Source register" subtitle="Where every number comes from, its terms, frequency and known limitations." pad={false}>
        {q.isLoading ? (
          <div className="p-5"><Skeleton className="h-48 w-full" /></div>
        ) : q.error ? (
          <ErrorState error={q.error} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base min-w-[900px]">
              <thead>
                <tr><th>Data</th><th>Provider</th><th>Licence / terms</th><th>Frequency & delay</th><th>Limitations</th><th>Status</th></tr>
              </thead>
              <tbody>
                {q.data!.map((s) => {
                  const err = s.last_error_at && (!s.last_success_at || s.last_error_at > s.last_success_at);
                  const state = s.last_success_at ? (err ? "warn" : "ok") : s.last_error_at ? "err" : "idle";
                  return (
                    <tr key={s.key}>
                      <td className="font-medium text-ink">{s.domain}</td>
                      <td className="text-muted">{s.provider}</td>
                      <td className="max-w-[200px] text-xs text-muted">{s.licence}</td>
                      <td className="text-xs text-muted">{s.frequency}<br /><span className="text-faint">{s.delay}</span></td>
                      <td className="max-w-[220px] text-xs text-muted">{s.limitations}</td>
                      <td className="text-xs">
                        <span className="inline-flex items-center gap-1.5">
                          <span className={clsx("h-2 w-2 rounded-full", state === "ok" ? "bg-pos" : state === "warn" ? "bg-warn" : state === "err" ? "bg-neg" : "bg-line")} />
                          <span className="text-ink">{state === "ok" ? "OK" : state === "warn" ? "Recent error" : state === "err" ? "Failing" : "On demand"}</span>
                        </span>
                        {s.last_success_at && <div className="mt-0.5 text-faint">Last success {ago(s.last_success_at)}</div>}
                        {err && <div className="mt-0.5 max-w-[200px] truncate text-warn" title={s.last_error}>{s.last_error || "Error"}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ security */
interface AuditRow {
  id: number;
  action: string;
  object: string;
  ip: string;
  meta: Record<string, unknown>;
  at: string;
}

function Security({ user }: { user: User }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [cur, setCur] = useState("");
  const [nw, setNw] = useState("");
  const [page, setPage] = useState(1);
  const audit = useQuery({ queryKey: ["audit", page], queryFn: () => api.get<AuditRow[]>(`/api/settings/audit?page=${page}`) });
  const change = useMutation({
    mutationFn: () => api.post("/api/auth/change-password", { current_password: cur, new_password: nw }),
    onSuccess: () => {
      toast("Password changed · other sessions signed out");
      setCur("");
      setNw("");
      qc.invalidateQueries({ queryKey: ["audit"] });
    },
  });
  const logoutAll = useMutation({
    mutationFn: () => api.post("/api/settings/logout-all"),
    onSuccess: () => {
      qc.clear();
      qc.setQueryData(["me"], { user: null });
      nav("/login");
    },
  });
  const pwOk = nw.length >= 8 && /[a-z]/.test(nw) && /[A-Z]/.test(nw) && /\d/.test(nw);
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
      <div className="space-y-5">
        {!user.is_demo && (
          <Card title={<span className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-accent" /> Change password</span>}>
            <form className="space-y-3.5" onSubmit={(e) => { e.preventDefault(); change.mutate(); }}>
              {change.error && <Notice tone="neg">{(change.error as Error).message}</Notice>}
              <Field label="Current password"><Input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required /></Field>
              <Field label="New password" error={nw && !pwOk ? "8+ characters with upper, lower case and a number" : null}>
                <Input type="password" autoComplete="new-password" value={nw} onChange={(e) => setNw(e.target.value)} required />
              </Field>
              <Button type="submit" className="w-full" loading={change.isPending} disabled={!cur || !pwOk}>Update password</Button>
            </form>
          </Card>
        )}
        <Card title="Sessions">
          <p className="text-sm text-muted">Sign out of FinLex on every device and browser, including this one.</p>
          <Button variant="ghost" className="mt-3 w-full" loading={logoutAll.isPending} onClick={() => window.confirm("Sign out everywhere?") && logoutAll.mutate()}>
            <LogOut className="h-4 w-4" /> Sign out everywhere
          </Button>
        </Card>
      </div>
      <Card title="Audit log" subtitle="Security-relevant actions on your account." pad={false}>
        {audit.isLoading ? (
          <div className="p-5"><Skeleton className="h-40 w-full" /></div>
        ) : audit.error ? (
          <ErrorState error={audit.error} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="table-base min-w-[560px]">
                <thead><tr><th>Action</th><th>Object</th><th>IP</th><th>When</th></tr></thead>
                <tbody>
                  {audit.data!.length === 0 ? (
                    <tr><td colSpan={4} className="py-8 text-center text-muted">No events</td></tr>
                  ) : (
                    audit.data!.map((a) => (
                      <tr key={a.id}>
                        <td><Badge tone={a.action.includes("failed") || a.action.includes("delete") ? "warn" : "neutral"}>{a.action.replace(/_/g, " ")}</Badge></td>
                        <td className="font-mono text-xs text-muted">{a.object || "—"}</td>
                        <td className="font-mono text-xs text-muted">{a.ip || "—"}</td>
                        <td className="whitespace-nowrap text-xs text-muted" title={dateTime(a.at)}>{ago(a.at)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3">
              <Button variant="quiet" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Newer</Button>
              <Button variant="quiet" size="sm" disabled={(audit.data?.length ?? 0) < 50} onClick={() => setPage((p) => p + 1)}>Older</Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ data */
function DataTab({ user }: { user: User }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [exporting, setExporting] = useState(false);
  useEffect(() => setConfirm(""), [user.id]);
  const exportData = async () => {
    setExporting(true);
    try {
      const res = await fetch("/api/settings/export", { credentials: "same-origin" });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `finlex-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast("Export downloaded");
    } catch (e) {
      toast((e as Error).message, "neg");
    } finally {
      setExporting(false);
    }
  };
  const del = useMutation({
    mutationFn: () => api.post("/api/settings/delete-account", { password, confirm }),
    onSuccess: () => {
      qc.clear();
      qc.setQueryData(["me"], { user: null });
      nav("/", { replace: true });
    },
  });
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Card title={<span className="flex items-center gap-2"><Download className="h-4 w-4 text-accent" /> Export your data</span>}>
        <p className="text-sm text-muted">Download everything FinLex holds about you as JSON: profile, holdings with full transaction history, alerts, Ask FinLex conversations, lesson progress and your audit log.</p>
        <Button className="mt-4" variant="ghost" loading={exporting} onClick={exportData}><Download className="h-4 w-4" /> Download JSON</Button>
      </Card>
      <section className="card border-neg/40 p-5">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-neg"><Trash2 className="h-4 w-4" /> Delete account</h2>
        <p className="mt-1.5 text-sm text-muted">
          Permanently deletes your account, portfolio, holdings, transactions, alerts, uploaded filings, conversations and audit log. This can't be undone. Public forecast records aren't linked to you and remain.
        </p>
        <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); del.mutate(); }}>
          {del.error && <Notice tone="neg">{(del.error as Error).message}</Notice>}
          {!user.is_demo && (
            <Field label="Password"><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          )}
          <Field label={<>Type <span className="font-mono font-bold text-ink">DELETE</span> to confirm</>}>
            <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
          </Field>
          <Button type="submit" variant="danger" className="w-full" loading={del.isPending} disabled={confirm !== "DELETE" || (!user.is_demo && !password)}>
            Permanently delete my account
          </Button>
        </form>
      </section>
    </div>
  );
}
