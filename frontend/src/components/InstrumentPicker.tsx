/* Searchable instrument combobox backed by /api/instruments (and optional universe-only mode). */
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, qs } from "@/lib/api";
import type { InstrumentRef } from "@/lib/types";
import { InstrumentAvatar } from "./ui";

const CLASS_LABEL: Record<string, string> = { index: "Index", equity: "Stock", mf: "Mutual fund", etf: "ETF", gold: "Gold", silver: "Silver" };

export function InstrumentPicker({ onSelect, assetClass, universe, placeholder = "Search NIFTY, RELIANCE, gold, a fund…", exclude = [], autoFocus, className }: {
  onSelect: (i: InstrumentRef) => void;
  assetClass?: string;
  universe?: boolean;
  placeholder?: string;
  exclude?: number[];
  autoFocus?: boolean;
  className?: string;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [debounced, setDebounced] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 180);
    return () => clearTimeout(t);
  }, [q]);
  const res = useQuery({
    queryKey: ["instruments", debounced, assetClass, universe],
    queryFn: () => api.get<InstrumentRef[]>(`/api/instruments${qs({ q: debounced, asset_class: assetClass, universe, limit: 30 })}`),
    enabled: open,
    staleTime: 60_000,
  });
  const items = useMemo(() => (res.data ?? []).filter((i) => !exclude.includes(i.id)), [res.data, exclude]);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const choose = (i: InstrumentRef) => {
    onSelect(i);
    setQ("");
    setOpen(false);
  };
  return (
    <div ref={box} className={clsx("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
      <input
        className="input pl-9"
        value={q}
        autoFocus={autoFocus}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setHi(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") (e.preventDefault(), setHi((h) => Math.min(h + 1, items.length - 1)));
          if (e.key === "ArrowUp") (e.preventDefault(), setHi((h) => Math.max(h - 1, 0)));
          if (e.key === "Enter" && items[hi]) (e.preventDefault(), choose(items[hi]));
          if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && (
        <ul role="listbox" className="absolute z-30 mt-1.5 max-h-80 w-full overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-2xl">
          {res.isLoading && <li className="px-3 py-2 text-sm text-muted">Searching…</li>}
          {!res.isLoading && items.length === 0 && <li className="px-3 py-2 text-sm text-muted">No matches</li>}
          {items.map((i, k) => (
            <li
              key={i.id}
              role="option"
              aria-selected={k === hi}
              onMouseEnter={() => setHi(k)}
              onMouseDown={(e) => (e.preventDefault(), choose(i))}
              className={clsx("flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2", k === hi && "bg-surface2")}
            >
              <InstrumentAvatar symbol={i.symbol} assetClass={i.asset_class} className="!h-7 !w-7 !text-[10px]" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-ink">{i.name}</div>
                <div className="truncate text-xs text-faint">
                  {i.asset_class === "mf" ? `AMFI ${i.amfi_code}` : i.symbol} · {CLASS_LABEL[i.asset_class] ?? i.asset_class}
                  {i.category && i.asset_class !== "equity" ? ` · ${i.category}` : i.sector ? ` · ${i.sector}` : ""}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
