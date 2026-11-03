/* INR & number formatting (Indian digit grouping), dates in IST. */

const inrFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const inr2Fmt = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function inr(v: number | null | undefined, opts: { decimals?: boolean; sign?: boolean } = {}): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const s = (opts.decimals ? inr2Fmt : inrFmt).format(Math.abs(v));
  const sign = v < 0 ? "−" : opts.sign && v > 0 ? "+" : "";
  return `${sign}₹${s}`;
}

/** Compact INR: ₹4.2K, ₹12.5L (lakh), ₹1.3Cr (crore). */
export function inrCompact(v: number | null | undefined, sign = false): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const a = Math.abs(v);
  const s = v < 0 ? "−" : sign && v > 0 ? "+" : "";
  if (a >= 1e7) return `${s}₹${(a / 1e7).toFixed(a >= 1e8 ? 1 : 2)}Cr`;
  if (a >= 1e5) return `${s}₹${(a / 1e5).toFixed(a >= 1e6 ? 1 : 2)}L`;
  if (a >= 1e3) return `${s}₹${(a / 1e3).toFixed(1)}K`;
  return `${s}₹${a.toFixed(0)}`;
}

export function num(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
}

export function qty(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: v % 1 === 0 ? 0 : 3 }).format(v);
}

export function pct(v: number | null | undefined, digits = 2, signed = false): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const s = signed && v > 0 ? "+" : v < 0 ? "−" : "";
  return `${s}${Math.abs(v).toFixed(digits)}%`;
}

export function ratioPct(v: number | null | undefined, digits = 0): string {
  return v === null || v === undefined ? "—" : `${(v * 100).toFixed(digits)}%`;
}

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
const dtFmt = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });

export function date(v: string | null | undefined): string {
  if (!v) return "—";
  const d = v.length === 10 ? new Date(`${v}T00:00:00+05:30`) : new Date(v);
  return Number.isNaN(d.getTime()) ? v : dateFmt.format(d);
}

export function dateTime(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : `${dtFmt.format(d)} IST`;
}

export function ago(v: string | null | undefined): string {
  if (!v) return "—";
  const ms = Date.now() - new Date(v).getTime();
  if (Number.isNaN(ms)) return "—";
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function shortDate(v: string): string {
  const d = new Date(`${v}T00:00:00+05:30`);
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" }).format(d);
}

export function monthYear(v: string): string {
  const d = new Date(`${v.length === 7 ? v + "-01" : v}T00:00:00+05:30`);
  return new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit", timeZone: "Asia/Kolkata" }).format(d);
}

export function tone(v: number | null | undefined): "pos" | "neg" | "flat" {
  if (v === null || v === undefined || Math.abs(v) < 1e-9) return "flat";
  return v > 0 ? "pos" : "neg";
}

export function priceFmt(v: number | null | undefined, unit?: string): string {
  if (v === null || v === undefined) return "—";
  if (unit === "points") return num(v, 2);
  return inr(v, { decimals: v < 100000 });
}
