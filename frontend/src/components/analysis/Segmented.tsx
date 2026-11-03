/* Segmented control with per-item disabled state + reason (shared Tabs has no disabled support). */
import clsx from "clsx";
import type { ReactNode } from "react";

export function Segmented<T extends string | number>({ value, onChange, items, label, size = "md", className }: {
  value: T;
  onChange: (v: T) => void;
  items: { value: T; label: ReactNode; disabled?: boolean; hint?: string }[];
  label: string;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={clsx("inline-flex max-w-full flex-wrap items-center gap-1 rounded-lg border border-line/70 bg-surface2/50 p-1", className)}>
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={String(it.value)}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={it.disabled}
            title={it.hint}
            onClick={() => !it.disabled && onChange(it.value)}
            className={clsx(
              "whitespace-nowrap rounded-md font-medium transition disabled:cursor-not-allowed disabled:opacity-45",
              size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
              active ? "bg-surface text-ink shadow-sm ring-1 ring-line" : "text-muted enabled:hover:text-ink",
            )}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

export function shortFund(name: string): string {
  return name
    .replace(/\s*-\s*(Direct|Regular)\s+Plan.*$/i, "")
    .replace(/\s+Fund$/i, "")
    .replace(/\(erstwhile[^)]*\)/i, "")
    .trim();
}

/** Non-<label> wrapper for button groups (a <label> would leak its text into the first button's accessible name). */
export function ControlGroup({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="mb-1.5 text-xs font-medium text-muted" aria-hidden>
        {label}
      </div>
      {children}
    </div>
  );
}
