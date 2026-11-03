import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { CheckCircle2, Download, FileSpreadsheet, FileText, History, Lock, ShieldCheck, Upload, X } from "lucide-react";
import { useMemo, useRef, useState, type DragEvent } from "react";
import { Link } from "react-router-dom";
import { useRefreshPortfolio } from "@/components/portfolio/AddHoldingModal";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  Notice,
  PageHeader,
  Select,
  Skeleton,
  Stat,
  Tabs,
  toast,
  type Tone,
} from "@/components/ui";
import { api } from "@/lib/api";
import { ago, date, inr, qty } from "@/lib/format";
import type { ImportBatch, ImportRow } from "@/lib/types";

type Mode = "csv" | "pdf";
type Decision = { include: boolean; key?: string };
type Filter = "all" | "attention" | "included";

const MAX_MB = 5;
const STATUS: Record<ImportRow["status"], { label: string; tone: Tone }> = {
  ok: { label: "Matched", tone: "pos" },
  new: { label: "New instrument", tone: "accent" },
  ambiguous: { label: "Needs review", tone: "warn" },
  unmatched: { label: "Unmatched", tone: "neg" },
  invalid: { label: "Invalid", tone: "neg" },
};
const TYPE_LABEL: Record<string, string> = { stock: "Stocks", etf: "ETFs", mf: "Mutual funds", gold: "Gold", silver: "Silver", fd: "Fixed deposits" };

const COLUMNS: [string, string, string][] = [
  ["asset_type", "Required", "stock, etf, mf, gold, silver or fd"],
  ["identifier", "Required", "NSE symbol (RELIANCE), AMFI code / ISIN / scheme name for funds, 'physical' for metals, bank name for FDs"],
  ["side", "Optional", "BUY (default) or SELL"],
  ["quantity", "Required", "Shares, units or grams (use 1 for an FD)"],
  ["price", "Required", "Price per unit / NAV / per gram; FD principal"],
  ["trade_date", "Required", "YYYY-MM-DD (DD-MM-YYYY and DD/MM/YYYY also accepted)"],
  ["account", "Optional", "Broker, folio or locker label — keeps holdings separate"],
  ["fees", "Optional", "Brokerage, stamp duty, making charges (₹)"],
  ["purity", "Metals", "0.999 (24K), 0.916 (22K), 0.750 (18K)"],
  ["fd_rate / fd_maturity_date / fd_compounding", "FDs", "Rate % p.a., maturity date, monthly/quarterly/half-yearly/annual/simple"],
  ["notes", "Optional", "Free text"],
];

function Dropzone({ mode, file, onFile }: { mode: Mode; file: File | null; onFile: (f: File | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const accept = mode === "csv" ? ".csv,text/csv" : ".pdf,application/pdf";
  const pick = (f: File | undefined | null) => {
    if (!f) return;
    const ok = mode === "csv" ? /\.(csv|txt)$/i.test(f.name) : /\.pdf$/i.test(f.name) || f.type === "application/pdf";
    if (!ok) return setErr(mode === "csv" ? "Please choose a .csv file." : "Please choose a PDF statement.");
    if (f.size > MAX_MB * 1024 * 1024) return setErr(`File is larger than ${MAX_MB} MB.`);
    setErr(null);
    onFile(f);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    pick(e.dataTransfer.files?.[0]);
  };
  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={clsx(
          "flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition",
          over ? "border-accent bg-accent/[0.06]" : "border-line hover:border-accent/50",
        )}
      >
        {file ? (
          <div className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3">
            {mode === "csv" ? <FileSpreadsheet className="h-6 w-6 text-accent" /> : <FileText className="h-6 w-6 text-accent" />}
            <div className="text-left">
              <div className="max-w-[220px] truncate text-sm font-semibold sm:max-w-[360px]">{file.name}</div>
              <div className="text-xs text-faint">{(file.size / 1024).toFixed(1)} KB</div>
            </div>
            <button className="btn-quiet !p-1.5" onClick={() => onFile(null)} aria-label="Remove file">
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <>
            <span className="grid h-12 w-12 place-items-center rounded-xl bg-accent/12 text-accent">
              <Upload className="h-6 w-6" />
            </span>
            <p className="mt-3 text-sm font-semibold">Drag & drop your {mode === "csv" ? "CSV file" : "statement PDF"} here</p>
            <p className="mt-1 text-xs text-faint">
              or{" "}
              <button type="button" className="font-semibold text-accent hover:underline" onClick={() => input.current?.click()}>
                choose a file
              </button>{" "}
              · up to {MAX_MB} MB
            </p>
          </>
        )}
        <input ref={input} type="file" accept={accept} className="hidden" onChange={(e) => pick(e.target.files?.[0])} aria-label={`Choose ${mode === "csv" ? "CSV" : "PDF"} file`} />
      </div>
      {err && <p className="mt-2 text-sm text-neg">{err}</p>}
    </div>
  );
}

function Review({ batch, onDone, onDiscard }: { batch: ImportBatch; onDone: (b: ImportBatch["summary"]["result"]) => void; onDiscard: () => void }) {
  const refresh = useRefreshPortfolio();
  const rows = batch.rows ?? [];
  const [dec, setDec] = useState<Record<number, Decision>>(() => Object.fromEntries(rows.map((r) => [r.row, { include: r.include, key: r.match?.key }])));
  const [defaultAccount, setDefaultAccount] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [limit, setLimit] = useState(100);

  const recon = useMemo(() => {
    const byType: Record<string, number> = {};
    let included = 0;
    for (const r of rows) {
      const d = dec[r.row];
      if (!d?.include || r.status === "invalid" || !d.key) continue;
      included += 1;
      const amt = r.quantity * r.price * (r.side === "BUY" ? 1 : -1);
      byType[r.asset_type] = (byType[r.asset_type] ?? 0) + amt;
    }
    return { included, excluded: rows.length - included, byType, net: Object.values(byType).reduce((s, x) => s + x, 0) };
  }, [rows, dec]);

  const attention = rows.filter((r) => r.status === "ambiguous" || r.status === "unmatched" || r.status === "invalid");
  const visible = rows.filter((r) => (filter === "all" ? true : filter === "attention" ? attention.includes(r) : dec[r.row]?.include));

  const confirm = useMutation({
    mutationFn: () =>
      api.post<NonNullable<ImportBatch["summary"]["result"]>>(`/api/imports/${batch.id}/confirm`, {
        decisions: Object.fromEntries(Object.entries(dec).map(([k, v]) => [k, v.key ? { include: v.include, key: v.key } : { include: v.include }])),
        default_account: defaultAccount.trim() || null,
      }),
    onSuccess: (res) => {
      toast(`Imported ${res.imported} row${res.imported === 1 ? "" : "s"}`);
      refresh();
      onDone(res);
    },
    onError: (e) => toast((e as Error).message, "neg"),
  });
  const discard = useMutation({
    mutationFn: () => api.del(`/api/imports/${batch.id}`),
    onSuccess: () => {
      toast("Import discarded", "neutral");
      onDiscard();
    },
  });

  const s = batch.summary;
  return (
    <div className="space-y-6">
      <Card
        title={
          <span className="flex flex-wrap items-center gap-2">
            Review before importing <Badge tone="accent">{batch.kind === "csv" ? "CSV" : s.type ?? "Statement"}</Badge>
          </span>
        }
        subtitle={`${batch.filename} · nothing is saved to your portfolio until you confirm`}
        actions={
          <Button variant="quiet" size="sm" onClick={() => discard.mutate()} loading={discard.isPending}>
            Discard
          </Button>
        }
      >
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label="Rows found" value={rows.length} />
          <Stat label="Will import" value={<span className="text-pos">{recon.included}</span>} />
          <Stat label="Excluded" value={recon.excluded} />
          <Stat label="Net amount" value={inr(recon.net)} sub="Purchases − sales of included rows" />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {Object.entries(s.by_status ?? {}).map(([k, n]) => (
            <Badge key={k} tone={STATUS[k as ImportRow["status"]]?.tone ?? "neutral"}>
              {STATUS[k as ImportRow["status"]]?.label ?? k}: {n}
            </Badge>
          ))}
          {s.statement_period?.from && (
            <Badge>
              Period {s.statement_period.from} → {s.statement_period.to}
            </Badge>
          )}
        </div>
        {!!s.warnings?.length && (
          <Notice tone="warn" className="mt-4" title="Parser warnings">
            <ul className="list-disc pl-4">
              {s.warnings.slice(0, 6).map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </Notice>
        )}
        {Object.keys(recon.byType).length > 0 && (
          <div className="relative mt-4 overflow-x-auto">
            <table className="table-base max-w-xl">
              <thead>
                <tr>
                  <th>Asset type</th>
                  <th className="!text-right">Net amount (included)</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(recon.byType).map(([t, v]) => (
                  <tr key={t}>
                    <td>{TYPE_LABEL[t] ?? t}</td>
                    <td className="text-right tnum">{inr(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card pad={false}>
        <div className="flex flex-col gap-3 border-b border-line/60 p-4 sm:flex-row sm:items-end sm:justify-between sm:p-5">
          <Tabs<Filter>
            value={filter}
            onChange={setFilter}
            items={[
              { value: "all", label: "All rows", count: rows.length },
              { value: "attention", label: "Needs attention", count: attention.length },
              { value: "included", label: "Included", count: recon.included },
            ]}
          />
          <Field label="Account for rows without one" className="w-full sm:w-72">
            <Input value={defaultAccount} onChange={(e) => setDefaultAccount(e.target.value)} placeholder="e.g. Zerodha (default: Imported)" maxLength={120} />
          </Field>
        </div>
        {visible.length === 0 ? (
          <EmptyState title="Nothing here">No rows in this view.</EmptyState>
        ) : (
          <div className="relative overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-10">
                    <span className="sr-only">Include</span>
                  </th>
                  <th>#</th>
                  <th>Instrument</th>
                  <th>Side</th>
                  <th className="!text-right">Qty</th>
                  <th className="!text-right">Price</th>
                  <th>Date</th>
                  <th>Account</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.slice(0, limit).map((r) => {
                  const d = dec[r.row] ?? { include: false };
                  const canInclude = r.status !== "invalid" && !!d.key;
                  const needsChoice = r.status === "ambiguous" || (r.status === "unmatched" && r.candidates.length > 0);
                  return (
                    <tr key={r.row} className={clsx(!d.include && !needsChoice && "opacity-60", needsChoice && !d.key && "bg-warn/[0.04]")}>
                      <td>
                        <Checkbox
                          checked={d.include && canInclude}
                          onChange={(v) => canInclude && setDec({ ...dec, [r.row]: { ...d, include: v } })}
                          label={<span className="sr-only">Include row {r.row}</span>}
                        />
                      </td>
                      <td className="text-faint tnum">{r.row}</td>
                      <td className="min-w-[220px] max-w-[340px]">
                        {needsChoice ? (
                          <div>
                            <div className="mb-1 truncate text-xs text-faint">
                              “{r.identifier}” — choose the match:
                            </div>
                            <Select
                              value={d.key ?? ""}
                              onChange={(e) => setDec({ ...dec, [r.row]: { include: !!e.target.value, key: e.target.value || undefined } })}
                              aria-label={`Choose instrument for row ${r.row}`}
                            >
                              <option value="">— Select —</option>
                              {r.candidates.map((cnd) => (
                                <option key={cnd.key} value={cnd.key}>
                                  {cnd.name}
                                  {cnd.score ? ` (${Math.round(cnd.score * 100)}% match)` : ""}
                                </option>
                              ))}
                            </Select>
                          </div>
                        ) : (
                          <>
                            <div className="truncate font-medium text-ink">
                              {r.asset_type === "gold" ? "Physical gold" : r.asset_type === "silver" ? "Physical silver" : r.match?.name ?? r.name ?? r.identifier}
                            </div>
                            <div className="truncate text-xs text-faint">
                              {TYPE_LABEL[r.asset_type] ?? r.asset_type} · {r.identifier}
                            </div>
                          </>
                        )}
                      </td>
                      <td>
                        <Badge tone={r.side === "BUY" ? "pos" : "neg"}>{r.side === "BUY" ? "Buy" : "Sell"}</Badge>
                      </td>
                      <td className="text-right tnum">{qty(r.quantity)}</td>
                      <td className="text-right tnum">{inr(r.price, { decimals: true })}</td>
                      <td className="whitespace-nowrap">{r.trade_date ? date(r.trade_date) : "—"}</td>
                      <td className="max-w-[160px] truncate text-xs text-muted">{r.account ?? <span className="text-faint">default</span>}</td>
                      <td className="min-w-[140px]">
                        <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                        {r.errors.map((e, i) => (
                          <div key={i} className="mt-1 text-xs text-neg">
                            {e}
                          </div>
                        ))}
                        {r.status === "new" && <div className="mt-1 text-xs text-faint">Will be added with its price history</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {visible.length > limit && (
              <div className="p-4 text-center">
                <Button variant="ghost" size="sm" onClick={() => setLimit((l) => l + 200)}>
                  Show more ({visible.length - limit} hidden)
                </Button>
              </div>
            )}
          </div>
        )}
        <div className="flex flex-col gap-3 border-t border-line/60 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <p className="text-xs text-faint">Matched rows are merged into existing holdings in the same account. Sales are applied after purchases on the same date.</p>
          <Button onClick={() => confirm.mutate()} loading={confirm.isPending} disabled={recon.included === 0}>
            <CheckCircle2 className="h-4 w-4" /> Import {recon.included} row{recon.included === 1 ? "" : "s"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

export default function Import() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>("csv");
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [batch, setBatch] = useState<ImportBatch | null>(null);
  const [result, setResult] = useState<ImportBatch["summary"]["result"] | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  const recent = useQuery({ queryKey: ["imports"], queryFn: () => api.get<ImportBatch[]>("/api/imports") });

  const upload = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append("file", file!);
      if (mode === "pdf") fd.append("password", password);
      return api.upload<ImportBatch>(mode === "csv" ? "/api/imports/csv" : "/api/imports/cas", fd);
    },
    onSuccess: (b) => {
      setBatch(b);
      setResult(null);
      setFile(null);
      setPassword("");
      qc.invalidateQueries({ queryKey: ["imports"] });
    },
  });
  const open = useMutation({
    mutationFn: (id: number) => api.get<ImportBatch>(`/api/imports/${id}`),
    onSuccess: (b) => {
      setBatch(b);
      setResult(null);
    },
    onError: (e) => toast((e as Error).message, "neg"),
  });

  const reset = () => {
    setBatch(null);
    qc.invalidateQueries({ queryKey: ["imports"] });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Import"
        title="Bring in your holdings"
        subtitle="Upload a CSV or a consolidated account statement. FinLex matches every row to an instrument and shows you a review screen — nothing is saved until you confirm."
      />

      {result ? (
        <Card>
          <EmptyState
            icon={<CheckCircle2 className="h-5 w-5" />}
            title={`Imported ${result.imported} row${result.imported === 1 ? "" : "s"}`}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Link to="/app/portfolio" className="btn-primary">
                  View portfolio
                </Link>
                <Button variant="ghost" onClick={() => setResult(null)}>
                  Import another file
                </Button>
              </div>
            }
          >
            {result.skipped} skipped{result.errors.length ? `, ${result.errors.length} failed` : ""}.
          </EmptyState>
          {result.errors.length > 0 && (
            <Notice tone="warn" title="Rows that couldn't be imported" className="mt-2">
              <ul className="list-disc pl-4">
                {result.errors.slice(0, 20).map((e) => (
                  <li key={e.row}>
                    Row {e.row}: {e.error}
                  </li>
                ))}
              </ul>
            </Notice>
          )}
        </Card>
      ) : batch && batch.status === "pending" ? (
        <Review
          batch={batch}
          onDone={(r) => {
            setResult(r ?? { imported: 0, skipped: 0, errors: [] });
            reset();
          }}
          onDiscard={reset}
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <Tabs<Mode>
              value={mode}
              onChange={(m) => {
                setMode(m);
                setFile(null);
                upload.reset();
              }}
              items={[
                { value: "csv", label: "CSV file" },
                {
                  value: "pdf",
                  label: (
                    <>
                      Statement PDF<span className="hidden sm:inline"> (CAMS / KFintech / NSDL / CDSL)</span>
                    </>
                  ),
                },
              ]}
              className="mb-5"
            />
            <Dropzone mode={mode} file={file} onFile={setFile} />
            {mode === "pdf" && (
              <Field label="PDF password" hint="Usually your PAN in capitals (e.g. ABCDE1234F). Used once to open the file and never stored." className="mt-4 max-w-sm">
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
                  <Input type="password" autoComplete="off" className="pl-9" value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
              </Field>
            )}
            {upload.error && (
              <Notice tone="neg" className="mt-4">
                {(upload.error as Error).message}
              </Notice>
            )}
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button onClick={() => upload.mutate()} disabled={!file} loading={upload.isPending}>
                <Upload className="h-4 w-4" /> {upload.isPending ? "Reading file…" : "Upload & review"}
              </Button>
              {mode === "csv" && (
                <>
                  <a href="/api/imports/template.csv" download className="btn-ghost">
                    <Download className="h-4 w-4" /> CSV template
                  </a>
                  <Button variant="quiet" onClick={() => setGuideOpen(true)}>
                    Column guide
                  </Button>
                </>
              )}
            </div>
            <div className="mt-6 flex items-start gap-3 rounded-xl border border-pos/25 bg-pos/[0.06] p-3.5 text-sm">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-pos" />
              <p className="text-muted">
                <span className="font-semibold text-ink">Private by design.</span> Files are parsed in memory and never written to disk; the parsed preview is deleted once you confirm or
                discard. FinLex never asks for broker logins or order permissions.
              </p>
            </div>
          </Card>

          <div className="space-y-6">
            <Card title={mode === "csv" ? "CSV in 3 steps" : "Getting your statement"}>
              {mode === "csv" ? (
                <ol className="space-y-3 text-sm text-muted">
                  <li>
                    <span className="font-semibold text-ink">1.</span> Download the template (it includes example rows for each asset type).
                  </li>
                  <li>
                    <span className="font-semibold text-ink">2.</span> Fill one row per purchase or sale. Use NSE symbols for stocks/ETFs and AMFI codes for funds.
                  </li>
                  <li>
                    <span className="font-semibold text-ink">3.</span> Upload, fix any rows flagged for review, and confirm.
                  </li>
                </ol>
              ) : (
                <ul className="space-y-3 text-sm text-muted">
                  <li>
                    <span className="font-semibold text-ink">Mutual funds:</span> request a <em>detailed</em> CAS from CAMS or KFintech (camsonline.com / mfcentral.com) — transactions give accurate XIRR.
                  </li>
                  <li>
                    <span className="font-semibold text-ink">Demat holdings:</span> the monthly NSDL/CDSL CAS lists shares and funds. It has no purchase cost, so FinLex uses the statement price — edit transactions later.
                  </li>
                  <li>
                    <span className="font-semibold text-ink">Each folio</span> becomes its own account in FinLex.
                  </li>
                </ul>
              )}
            </Card>
            <Card title="Recent imports" actions={<History className="h-4 w-4 text-faint" />}>
              {recent.isLoading ? (
                <Skeleton className="h-20 w-full" />
              ) : recent.error ? (
                <ErrorState error={recent.error} onRetry={() => recent.refetch()} />
              ) : !recent.data?.length ? (
                <p className="text-sm text-muted">No imports yet.</p>
              ) : (
                <ul className="divide-y divide-line/50">
                  {recent.data.map((b) => (
                    <li key={b.id} className="flex items-center gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{b.filename}</div>
                        <div className="text-xs text-faint">
                          {b.kind.toUpperCase()} · {ago(b.created_at)}
                          {b.summary.result ? ` · ${b.summary.result.imported} imported` : ` · ${b.summary.rows} rows`}
                        </div>
                      </div>
                      {b.status === "pending" ? (
                        <Button size="sm" variant="ghost" onClick={() => open.mutate(b.id)} loading={open.isPending && open.variables === b.id}>
                          Review
                        </Button>
                      ) : (
                        <Badge tone={b.status === "confirmed" ? "pos" : "neutral"}>{b.status}</Badge>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}

      <Modal open={guideOpen} onClose={() => setGuideOpen(false)} title="CSV column guide" wide>
        <div className="relative overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Column</th>
                <th>Needed</th>
                <th>What to enter</th>
              </tr>
            </thead>
            <tbody>
              {COLUMNS.map(([c, n, w]) => (
                <tr key={c}>
                  <td className="font-mono text-xs text-ink">{c}</td>
                  <td>
                    <Badge tone={n === "Required" ? "accent" : "neutral"}>{n}</Badge>
                  </td>
                  <td className="text-muted">{w}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Modal>
    </div>
  );
}
