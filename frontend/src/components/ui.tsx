/* FinLex UI kit — StockWisp-style dark surfaces + Metron-style consolidated stat blocks. */
import clsx from "clsx";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Check, ChevronDown, Info, Loader2, Minus, X } from "lucide-react";
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { ago, dateTime, pct, tone } from "@/lib/format";

export { clsx };

/* ------------------------------------------------------------------ layout */
export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="label mb-1.5">{eyebrow}</div>}
        <h1 className="text-[22px] font-bold tracking-tight text-ink sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ className, children, title, subtitle, actions, pad = true, id }: {
  className?: string; children?: ReactNode; title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; pad?: boolean; id?: string;
}) {
  return (
    <section id={id} className={clsx("card animate-fadein", className)}>
      {(title || actions) && (
        <header className={clsx("flex items-start justify-between gap-3", pad ? "px-4 pt-4 sm:px-5 sm:pt-5" : "px-4 pt-4")}>
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={clsx(pad && "p-4 sm:p-5", (title || actions) && pad && "pt-3 sm:pt-4")}>{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ buttons */
type BtnVariant = "primary" | "ghost" | "quiet" | "light" | "danger";
// literal class names so Tailwind's content scanner keeps every variant
const BTN: Record<BtnVariant, string> = { primary: "btn-primary", ghost: "btn-ghost", quiet: "btn-quiet", light: "btn-light", danger: "btn-danger" };
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; loading?: boolean; size?: "sm" | "md" }>(
  function Button({ variant = "primary", loading, size = "md", className, children, disabled, ...rest }, ref) {
    return (
      <button
        ref={ref}
        className={clsx(BTN[variant], size === "sm" && "!px-2.5 !py-1.5 !text-xs", className)}
        disabled={disabled || loading}
        {...rest}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {children}
      </button>
    );
  },
);

/* ------------------------------------------------------------------ badges / chips */
export type Tone = "neutral" | "accent" | "pos" | "neg" | "warn" | "info";
const toneCls: Record<Tone, string> = {
  neutral: "bg-surface2 text-muted border-line",
  accent: "bg-accent/12 text-accent border-accent/25",
  pos: "bg-pos/12 text-pos border-pos/25",
  neg: "bg-neg/12 text-neg border-neg/25",
  warn: "bg-warn/12 text-warn border-warn/30",
  info: "bg-info/12 text-info border-info/25",
};

export function Badge({ tone = "neutral", children, className, icon }: { tone?: Tone; children: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <span className={clsx("inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-semibold", toneCls[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

export function Chip({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={clsx("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", toneCls[tone], className)}>{children}</span>;
}

/** "Delayed" style pill with a pulsing dot (StockWisp header pill). */
export function LivePill({ children, tone: t = "accent" }: { children: ReactNode; tone?: Tone }) {
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium", toneCls[t])}>
      <span className="relative flex h-2 w-2">
        <span className={clsx("absolute inline-flex h-full w-full animate-ping rounded-full opacity-50", t === "warn" ? "bg-warn" : "bg-accent")} />
        <span className={clsx("relative inline-flex h-2 w-2 rounded-full", t === "warn" ? "bg-warn" : "bg-accent")} />
      </span>
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ numbers */
export function Delta({ value, suffix = "%", digits = 2, className, arrow = true, children }: {
  value: number | null | undefined; suffix?: string; digits?: number; className?: string; arrow?: boolean; children?: ReactNode;
}) {
  const t = tone(value);
  const Icon = t === "pos" ? ArrowUpRight : t === "neg" ? ArrowDownRight : Minus;
  return (
    <span className={clsx("inline-flex items-center gap-0.5 tnum font-medium", t === "pos" && "text-pos", t === "neg" && "text-neg", t === "flat" && "text-muted", className)}>
      {arrow && value !== null && value !== undefined && <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />}
      {children ?? (suffix === "%" ? pct(value, digits, true) : value === null || value === undefined ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(digits)}${suffix}`)}
    </span>
  );
}

export function Stat({ label, value, sub, hint, className, big }: { label: ReactNode; value: ReactNode; sub?: ReactNode; hint?: string; className?: string; big?: boolean }) {
  return (
    <div className={clsx("min-w-0", className)}>
      <div className="label flex items-center gap-1">
        {label}
        {hint && (
          <span title={hint} className="cursor-help text-faint">
            <Info className="h-3 w-3" />
          </span>
        )}
      </div>
      <div className={clsx("mt-1 truncate font-bold tnum text-ink", big ? "text-[28px] leading-tight sm:text-[32px]" : "text-lg sm:text-xl")}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

/** Horizontal score bar (StockWisp sentiment bar). */
export function ScoreBar({ value, max = 100, tone: t = "accent", className }: { value: number; max?: number; tone?: Tone; className?: string }) {
  const w = Math.max(0, Math.min(100, (value / max) * 100));
  const color = { accent: "bg-accent", pos: "bg-pos", neg: "bg-neg", warn: "bg-warn", info: "bg-info", neutral: "bg-muted" }[t];
  return (
    <div className={clsx("h-1.5 w-full overflow-hidden rounded-full bg-surface2", className)} role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <div className={clsx("h-full rounded-full transition-all", color)} style={{ width: `${w}%` }} />
    </div>
  );
}

/* ------------------------------------------------------------------ tabs */
export function Tabs<T extends string>({ value, onChange, items, className, size = "md" }: {
  value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode; count?: number }[]; className?: string; size?: "sm" | "md";
}) {
  return (
    <div role="tablist" className={clsx("inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-lg border border-line/70 bg-surface2/50 p-1", className)}>
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          role="tab"
          aria-selected={value === it.value}
          onClick={() => onChange(it.value)}
          className={clsx(
            "whitespace-nowrap rounded-md font-medium transition",
            size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
            value === it.value ? "bg-surface text-ink shadow-sm ring-1 ring-line" : "text-muted hover:text-ink",
          )}
        >
          {it.label}
          {it.count !== undefined && <span className="ml-1.5 rounded bg-surface2 px-1.5 text-[11px] text-faint">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ form controls */
/** Form field. Wraps a single control in a <label>; pass `group` when the children are buttons/tabs so the
 *  caption labels a role="group" instead of leaking into each button's accessible name. */
export function Field({ label, hint, error, children, className, group }: {
  label?: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string; group?: boolean;
}) {
  const id = useId();
  const extra = (
    <>
      {hint && !error && <span className="mt-1 block text-xs text-faint">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-neg">{error}</span>}
    </>
  );
  if (group)
    return (
      <div role="group" aria-labelledby={label ? id : undefined} className={clsx("block", className)}>
        {label && <span id={id} className="mb-1.5 block text-xs font-medium text-muted">{label}</span>}
        {children}
        {extra}
      </div>
    );
  return (
    <label className={clsx("block", className)}>
      {label && <span className="mb-1.5 block text-xs font-medium text-muted">{label}</span>}
      {children}
      {extra}
    </label>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={clsx("input", className)} {...rest} />;
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select className={clsx("input appearance-none pr-8", className)} {...rest}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
    </div>
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={clsx("input min-h-[90px]", className)} {...rest} />;
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <span className="inline-flex items-center gap-2.5">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx("relative h-5 w-9 shrink-0 rounded-full transition disabled:opacity-50", checked ? "bg-accent" : "bg-line")}
      >
        <span className={clsx("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all", checked ? "left-[18px]" : "left-0.5")} />
      </button>
      {label && <label htmlFor={id} className="cursor-pointer text-sm text-ink">{label}</label>}
    </span>
  );
}

export function Checkbox({ checked, onChange, label, className }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; className?: string }) {
  return (
    <label className={clsx("inline-flex cursor-pointer items-start gap-2 text-sm text-ink", className)}>
      <span
        role="checkbox"
        aria-checked={checked}
        tabIndex={0}
        onKeyDown={(e) => (e.key === " " || e.key === "Enter") && (e.preventDefault(), onChange(!checked))}
        onClick={(e) => (e.preventDefault(), onChange(!checked))}
        className={clsx("mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border transition", checked ? "border-accent bg-accent text-white" : "border-line bg-surface2")}
      >
        {checked && <Check className="h-3 w-3" strokeWidth={3} />}
      </span>
      {label && <span onClick={() => onChange(!checked)}>{label}</span>}
    </label>
  );
}

/* ------------------------------------------------------------------ feedback */
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx("h-5 w-5 animate-spin text-accent", className)} aria-label="Loading" />;
}

export function Loading({ label = "Loading…", className }: { label?: string; className?: string }) {
  return (
    <div className={clsx("flex items-center justify-center gap-2.5 py-14 text-sm text-muted", className)}>
      <Spinner className="h-4 w-4" /> {label}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("skeleton", className)} />;
}

export function EmptyState({ icon, title, children, action, className }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={clsx("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      {icon && <div className="mb-3 grid h-11 w-11 place-items-center rounded-xl bg-accent/10 text-accent">{icon}</div>}
      <div className="text-[15px] font-semibold text-ink">{title}</div>
      {children && <div className="mt-1 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const msg = error instanceof Error ? error.message : String(error ?? "Something went wrong");
  return (
    <div className={clsx("flex flex-col items-center justify-center gap-3 px-6 py-10 text-center", className)} role="alert">
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-neg/10 text-neg">
        <AlertTriangle className="h-5 w-5" />
      </div>
      <div className="max-w-md text-sm text-muted">{msg}</div>
      {onRetry && (
        <Button variant="ghost" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Notice({ tone: t = "info", title, children, className, icon }: { tone?: Tone; title?: ReactNode; children?: ReactNode; className?: string; icon?: ReactNode }) {
  const Icon = t === "neg" || t === "warn" ? AlertTriangle : Info;
  return (
    <div className={clsx("flex gap-3 rounded-xl border px-3.5 py-3 text-sm", toneCls[t], className)} role={t === "neg" ? "alert" : "note"}>
      <span className="mt-0.5 shrink-0">{icon ?? <Icon className="h-4 w-4" />}</span>
      <div className="min-w-0 text-ink/90">
        {title && <div className="font-semibold text-ink">{title}</div>}
        {children && <div className={clsx(title && "mt-0.5", "text-muted")}>{children}</div>}
      </div>
    </div>
  );
}

/** Provenance line: source · as-of · delay. Flags synthetic or stale data prominently. */
export function SourceBadge({ source, asOf, delay, synthetic, stale, className }: {
  source?: string | null; asOf?: string | null; delay?: string | null; synthetic?: boolean; stale?: boolean; className?: string;
}) {
  return (
    <div className={clsx("flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-faint", className)}>
      {synthetic && <Badge tone="warn">Synthetic demo data</Badge>}
      {stale && <Badge tone="warn">Stale</Badge>}
      {source && <span>Source: {source}</span>}
      {asOf && <span title={dateTime(asOf)}>· As of {dateTime(asOf)} ({ago(asOf)})</span>}
      {delay && <span>· {delay}</span>}
    </div>
  );
}

export function Disclaimer({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <p className={clsx("text-[11px] leading-relaxed text-faint", className)}>
      {children ?? "FinLex is an educational tool, not a SEBI-registered investment adviser. Nothing here is a recommendation to buy, sell or hold any security. Estimates and forecasts can be wrong."}
    </p>
  );
}

/* ------------------------------------------------------------------ modal */
export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    setTimeout(() => ref.current?.querySelector<HTMLElement>("input,select,textarea,button:not([data-close])")?.focus(), 30);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div ref={ref} className={clsx("relative z-10 flex max-h-[92vh] w-full flex-col rounded-t-2xl border border-line bg-surface shadow-2xl sm:rounded-2xl animate-fadein", wide ? "sm:max-w-3xl" : "sm:max-w-lg")}>
        <div className="flex items-center justify-between border-b border-line/70 px-5 py-4">
          <h3 className="text-base font-semibold">{title}</h3>
          <button data-close className="btn-quiet !p-1.5" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line/70 px-5 py-3.5">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ toast */
type ToastT = { id: number; tone: Tone; text: string };
let pushToast: ((t: Omit<ToastT, "id">) => void) | null = null;
export function toast(text: string, t: Tone = "pos") {
  pushToast?.({ text, tone: t });
}
export function Toaster() {
  const [items, setItems] = useState<ToastT[]>([]);
  useEffect(() => {
    pushToast = (t) => {
      const id = Date.now() + Math.random();
      setItems((x) => [...x, { ...t, id }]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 4200);
    };
    return () => {
      pushToast = null;
    };
  }, []);
  return createPortal(
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,380px)] flex-col gap-2" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={clsx("pointer-events-auto rounded-xl border bg-surface px-4 py-3 text-sm shadow-2xl animate-fadein", toneCls[t.tone])}>
          <span className="text-ink">{t.text}</span>
        </div>
      ))}
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ misc */
export function InstrumentAvatar({ symbol, assetClass, className }: { symbol: string; assetClass?: string; className?: string }) {
  const palette: Record<string, string> = {
    equity: "from-sky-500/80 to-blue-600/80",
    mf: "from-violet-500/80 to-indigo-600/80",
    etf: "from-teal-500/80 to-emerald-600/80",
    gold: "from-amber-400/90 to-yellow-600/90",
    silver: "from-slate-300/90 to-slate-500/90",
    fd: "from-emerald-500/80 to-green-700/80",
    index: "from-blue-500/80 to-cyan-600/80",
  };
  const letters = symbol.replace(/^MF/, "").replace(/[^A-Z0-9]/gi, "").slice(0, 2).toUpperCase() || "?";
  return (
    <span className={clsx("grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br text-[11px] font-bold text-white shadow-sm", palette[assetClass || "equity"] || palette.equity, className)} aria-hidden>
      {assetClass === "mf" ? "MF" : assetClass === "fd" ? "FD" : assetClass === "gold" ? "Au" : assetClass === "silver" ? "Ag" : letters}
    </span>
  );
}

export function KeyValue({ items, className }: { items: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={clsx("grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2", className)}>
      {items.map(([k, v], i) => (
        <div key={i} className="flex justify-between gap-3 border-b border-line/40 pb-2">
          <dt className="text-muted">{k}</dt>
          <dd className="text-right font-medium tnum text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 mt-1 flex items-center justify-between gap-3">
      <h3 className="text-sm font-semibold text-ink">{children}</h3>
      {right}
    </div>
  );
}
