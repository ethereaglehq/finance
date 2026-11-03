import clsx from "clsx";
import { useId } from "react";

export function LogoMark({ className }: { className?: string }) {
  const gid = `fl-g-${useId().replace(/:/g, "")}`;
  return (
    <svg viewBox="0 0 32 32" className={clsx("h-7 w-7", className)} aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5b9bff" />
          <stop offset="1" stopColor="#2563eb" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="8" fill={`url(#${gid})`} opacity="0.14" />
      <path d="M7 22 L13 15 L17.5 18.5 L25 9" fill="none" stroke={`url(#${gid})`} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="25" cy="9" r="2.2" fill="#5b9bff" />
    </svg>
  );
}

export function Logo({ className, beta = true }: { className?: string; beta?: boolean }) {
  return (
    <span className={clsx("inline-flex items-center gap-2", className)}>
      <LogoMark />
      <span className="text-[17px] font-bold tracking-tight text-ink">FinLex</span>
      {beta && <span className="rounded-md border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent">Beta</span>}
    </span>
  );
}
