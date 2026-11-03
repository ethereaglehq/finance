import { useMutation } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowLeft, ArrowRight, Ban, Check, Clock, FileUp, Gauge, KeyRound, PlusCircle, ShieldCheck, Tag } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Card, Checkbox, Field, Input, Notice, toast } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Prefs } from "@/lib/types";

const RISK: { v: Prefs["risk_level"]; title: string; desc: string; band: string }[] = [
  { v: "conservative", title: "Conservative", desc: "Stability matters more than growth. Large swings would worry me.", band: "Equity band used in checks: 10–40%" },
  { v: "moderate", title: "Moderate", desc: "I accept some ups and downs for long-term growth.", band: "Equity band used in checks: 30–70%" },
  { v: "aggressive", title: "Aggressive", desc: "I'm comfortable with large swings over a long horizon.", band: "Equity band used in checks: 50–90%" },
];
const GOALS = ["Retirement", "Children's education", "House", "Emergency fund", "Wealth building", "Learning how markets work", "Tax saving"];

function Steps({ step }: { step: number }) {
  const labels = ["How FinLex works", "Your profile", "Add your data"];
  return (
    <ol className="mb-6 flex items-center gap-2" aria-label="Setup progress">
      {labels.map((l, i) => (
        <li key={l} className="flex flex-1 items-center gap-2">
          <span
            className={clsx(
              "grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold",
              i < step ? "bg-pos text-white" : i === step ? "bg-accent text-white" : "bg-surface2 text-faint",
            )}
            aria-current={i === step ? "step" : undefined}
          >
            {i < step ? <Check className="h-4 w-4" /> : i + 1}
          </span>
          <span className={clsx("hidden text-sm sm:block", i === step ? "font-semibold text-ink" : "text-muted")}>{l}</span>
          {i < labels.length - 1 && <span className="h-px flex-1 bg-line" />}
        </li>
      ))}
    </ol>
  );
}

function Slider({ label, value, onChange, min, max, step = 1, suffix, hint }: {
  label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number; suffix: string; hint: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-3">
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[rgb(var(--accent))]" aria-label={label} />
        <span className="w-16 shrink-0 rounded-md border border-line bg-surface2 px-2 py-1 text-center text-sm font-semibold tnum">
          {value}
          {suffix}
        </span>
      </div>
    </Field>
  );
}

export default function Onboarding() {
  const { user, refresh } = useAuth();
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [ack, setAck] = useState(false);
  const [p, setP] = useState({ risk_level: "moderate" as Prefs["risk_level"], horizon_years: 5, company_threshold_pct: 10, sector_threshold_pct: 30, goals: [] as string[] });

  useEffect(() => {
    if (user?.preferences)
      setP({
        risk_level: user.preferences.risk_level,
        horizon_years: user.preferences.horizon_years,
        company_threshold_pct: user.preferences.company_threshold_pct,
        sector_threshold_pct: user.preferences.sector_threshold_pct,
        goals: user.preferences.goals ?? [],
      });
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveProfile = useMutation({
    mutationFn: () => api.patch("/api/settings", p),
    onSuccess: () => setStep(2),
    onError: (e) => toast((e as Error).message, "neg"),
  });
  const finish = useMutation({
    mutationFn: () => api.patch("/api/settings", { onboarded: true }),
    onSuccess: async () => {
      await refresh();
    },
  });
  const go = async (to: string) => {
    await finish.mutateAsync().catch(() => undefined);
    if (to === "/app") toast("You're all set");
    nav(to);
  };

  return (
    <div className="mx-auto max-w-3xl py-2">
      <div className="mb-6">
        <div className="label mb-1.5">Welcome{user?.name ? `, ${user.name.split(" ")[0]}` : ""}</div>
        <h1 className="text-2xl font-bold tracking-tight">Set up FinLex in two minutes</h1>
      </div>
      <Steps step={step} />

      {step === 0 && (
        <Card>
          <h2 className="text-lg font-semibold">What FinLex is — and isn't</h2>
          <p className="mt-1 text-sm text-muted">FinLex helps you understand what you own. It is built around a few promises:</p>
          <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {[
              [Ban, "No tips, ever", "No buy/sell/hold calls, price targets or 'picks'. FinLex isn't a SEBI-registered adviser."],
              [KeyRound, "No broker login", "You enter or import holdings. FinLex can't see your broker account or place orders."],
              [Clock, "Delayed, labelled data", "Prices are delayed (~15 min for NSE, end-of-day NAVs) and every screen shows its source and time."],
              [Tag, "Estimates are labelled", "Fund look-through, physical gold values and forecasts are estimates — shown with their limits and track record."],
            ].map(([Icon, t, d]) => {
              const I = Icon as typeof Ban;
              return (
                <li key={t as string} className="flex gap-3 rounded-xl border border-line/70 bg-surface2/40 p-3.5">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent/12 text-accent">
                    <I className="h-4 w-4" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold">{t as string}</span>
                    <span className="block text-sm text-muted">{d as string}</span>
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="mt-6 rounded-xl border border-line/70 p-3.5">
            <Checkbox checked={ack} onChange={setAck} label="I understand FinLex is an educational tool and decisions remain mine." />
          </div>
          <div className="mt-6 flex justify-end">
            <Button disabled={!ack} onClick={() => setStep(1)}>
              Continue <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </Card>
      )}

      {step === 1 && (
        <Card>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Gauge className="h-5 w-5 text-accent" /> Your profile
          </h2>
          <p className="mt-1 text-sm text-muted">Used only to phrase FinLex's rule-based observations and concentration alerts. You can change it any time in Settings.</p>
          <fieldset className="mt-5">
            <legend className="mb-2 text-xs font-medium text-muted">How do you feel about ups and downs?</legend>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3" role="radiogroup">
              {RISK.map((r) => (
                <button
                  key={r.v}
                  type="button"
                  role="radio"
                  aria-checked={p.risk_level === r.v}
                  onClick={() => setP({ ...p, risk_level: r.v })}
                  className={clsx(
                    "rounded-xl border p-4 text-left transition",
                    p.risk_level === r.v ? "border-accent/60 bg-accent/[0.08] ring-1 ring-accent/30" : "border-line hover:bg-surface2",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{r.title}</span>
                    {p.risk_level === r.v && <Check className="h-4 w-4 text-accent" />}
                  </div>
                  <p className="mt-1 text-sm text-muted">{r.desc}</p>
                  <p className="mt-2 text-[11px] text-faint">{r.band}</p>
                </button>
              ))}
            </div>
          </fieldset>
          <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
            <Field label="Investment horizon (years)" hint="Roughly when you might need most of this money.">
              <Input type="number" min={0} max={60} value={p.horizon_years} onChange={(e) => setP({ ...p, horizon_years: Math.max(0, Math.min(60, Number(e.target.value))) })} />
            </Field>
            <div />
            <Slider
              label="Flag a single company above"
              value={p.company_threshold_pct}
              onChange={(v) => setP({ ...p, company_threshold_pct: v })}
              min={2}
              max={40}
              suffix="%"
              hint="Look-through exposure across your stocks and funds."
            />
            <Slider
              label="Flag a single sector above"
              value={p.sector_threshold_pct}
              onChange={(v) => setP({ ...p, sector_threshold_pct: v })}
              min={10}
              max={80}
              suffix="%"
              hint="e.g. Financial Services, IT, Energy."
            />
          </div>
          <fieldset className="mt-6">
            <legend className="mb-2 text-xs font-medium text-muted">Goals (optional)</legend>
            <div className="flex flex-wrap gap-2">
              {GOALS.map((g) => {
                const on = p.goals.includes(g);
                return (
                  <button
                    key={g}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setP({ ...p, goals: on ? p.goals.filter((x) => x !== g) : [...p.goals, g] })}
                    className={clsx(
                      "rounded-full border px-3 py-1 text-sm transition",
                      on ? "border-accent/50 bg-accent/12 text-accent" : "border-line text-muted hover:text-ink",
                    )}
                  >
                    {on && <Check className="mr-1 inline h-3.5 w-3.5" />}
                    {g}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div className="mt-6 flex justify-between">
            <Button variant="ghost" onClick={() => setStep(0)}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            <Button loading={saveProfile.isPending} onClick={() => saveProfile.mutate()}>
              Save & continue <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <h2 className="text-lg font-semibold">Add your data</h2>
          <p className="mt-1 text-sm text-muted">Start however suits you — you can mix manual entries and imports.</p>
          <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
            <button type="button" onClick={() => go("/app/portfolio?add=1")} className="card group flex flex-col p-5 text-left transition hover:border-accent/40 hover:shadow-glow">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent/12 text-accent">
                <PlusCircle className="h-5 w-5" />
              </span>
              <span className="mt-4 font-semibold">Enter holdings manually</span>
              <span className="mt-1 text-sm text-muted">Stocks, mutual funds, ETFs, physical gold & silver, fixed deposits.</span>
            </button>
            <button type="button" onClick={() => go("/app/import")} className="card group flex flex-col p-5 text-left transition hover:border-accent/40 hover:shadow-glow">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent/12 text-accent">
                <FileUp className="h-5 w-5" />
              </span>
              <span className="mt-4 font-semibold">Import a CSV or statement</span>
              <span className="mt-1 text-sm text-muted">CAMS / KFintech / NSDL / CDSL PDF or FinLex CSV template. Reviewed before saving.</span>
            </button>
          </div>
          <Notice tone="pos" className="mt-5" icon={<ShieldCheck className="h-4 w-4" />} title="Your data stays yours">
            Export or delete everything any time from Settings. Statements are parsed in memory and never stored.
          </Notice>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <Button variant="ghost" onClick={() => setStep(1)}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            <div className="flex items-center gap-3">
              <Link to="/app/compare" onClick={() => finish.mutate()} className="text-sm text-muted hover:text-ink">
                Explore markets first
              </Link>
              <Button variant="ghost" loading={finish.isPending} onClick={() => go("/app")}>
                Skip for now
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
