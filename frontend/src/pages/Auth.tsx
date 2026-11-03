import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Lock, ShieldCheck, Sparkles } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Logo } from "@/components/Logo";
import { Button, Checkbox, Field, Input, Notice } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { User } from "@/lib/types";

function Shell({ title, subtitle, children, footer }: { title: string; subtitle: ReactNode; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="hero-glow pointer-events-none absolute inset-0" />
      <div className="relative mx-auto grid min-h-screen max-w-6xl items-center gap-10 px-5 py-10 lg:grid-cols-2">
        <div className="hidden lg:block">
          <Link to="/"><Logo /></Link>
          <h2 className="mt-10 text-4xl font-bold leading-tight tracking-tight">
            See what you <span className="text-accent">really</span> own.
          </h2>
          <p className="mt-4 max-w-md text-muted">One private view of your stocks, mutual funds, ETFs, gold, silver and FDs — with look-through exposure, honest forecast ranges and a public track record. No tips.</p>
          <ul className="mt-8 space-y-3 text-sm text-muted">
            <li className="flex items-center gap-2.5"><ShieldCheck className="h-4 w-4 text-pos" /> No broker login, no order permissions</li>
            <li className="flex items-center gap-2.5"><Lock className="h-4 w-4 text-pos" /> Statements parsed in memory, never stored</li>
            <li className="flex items-center gap-2.5"><Sparkles className="h-4 w-4 text-pos" /> Every forecast logged — misses included</li>
          </ul>
        </div>
        <div className="mx-auto w-full max-w-md">
          <div className="mb-6 lg:hidden"><Link to="/"><Logo /></Link></div>
          <div className="card p-6 sm:p-8">
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
            <p className="mt-1.5 text-sm text-muted">{subtitle}</p>
            <div className="mt-6">{children}</div>
          </div>
          <div className="mt-5 text-center text-sm text-muted">{footer}</div>
        </div>
      </div>
    </div>
  );
}

function useDemo() {
  const qc = useQueryClient();
  const nav = useNavigate();
  return useMutation({
    mutationFn: () => api.post<{ user: User }>("/api/auth/demo"),
    onSuccess: (d) => {
      qc.clear();
      qc.setQueryData(["me"], { user: d.user });
      nav("/app");
    },
  });
}

export function Login() {
  const { setUser } = useAuth();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const demo = useDemo();
  const m = useMutation({
    mutationFn: () => api.post<{ user: User }>("/api/auth/login", { email, password }),
    onSuccess: (d) => {
      setUser(d.user);
      const next = sp.get("next");
      nav(next && next.startsWith("/app") ? next : "/app");
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate();
  };
  return (
    <Shell title="Welcome back" subtitle="Sign in to your FinLex workspace." footer={<>New here? <Link to="/register" className="font-semibold text-accent hover:underline">Create a free account</Link></>}>
      <form onSubmit={submit} className="space-y-4">
        {m.error && <Notice tone="neg">{(m.error as Error).message}</Notice>}
        <Field label="Email">
          <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button type="submit" className="w-full" loading={m.isPending}>Sign in <ArrowRight className="h-4 w-4" /></Button>
      </form>
      <div className="my-5 flex items-center gap-3 text-xs text-faint"><div className="h-px flex-1 bg-line" />or<div className="h-px flex-1 bg-line" /></div>
      <Button variant="ghost" className="w-full" loading={demo.isPending} onClick={() => demo.mutate()}>Explore the live demo</Button>
      {demo.error && <p className="mt-2 text-center text-xs text-neg">{(demo.error as Error).message}</p>}
    </Shell>
  );
}

export function Register() {
  const { setUser, user } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [accept, setAccept] = useState(false);
  const m = useMutation({
    mutationFn: () => api.post<{ user: User }>("/api/auth/register", { ...form, accept_terms: accept }),
    onSuccess: (d) => {
      setUser(d.user);
      nav("/app/onboarding");
    },
  });
  const pwOk = form.password.length >= 8 && /[a-z]/.test(form.password) && /[A-Z]/.test(form.password) && /\d/.test(form.password);
  return (
    <Shell title="Create your account" subtitle="Free during beta. No broker credentials, ever." footer={<>Already have an account? <Link to="/login" className="font-semibold text-accent hover:underline">Sign in</Link></>}>
      {user?.is_demo && <Notice className="mb-4" tone="info">You're in a demo session. Creating an account starts a fresh, empty portfolio — the demo data isn't carried over.</Notice>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          m.mutate();
        }}
        className="space-y-4"
      >
        {m.error && <Notice tone="neg">{(m.error as Error).message}</Notice>}
        <Field label="Name (optional)">
          <Input autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Email">
          <Input type="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Password" hint="8+ characters with upper- and lower-case letters and a number." error={form.password && !pwOk ? "Use upper- and lower-case letters and a number (8+ chars)." : null}>
          <Input type="password" autoComplete="new-password" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        <Checkbox
          checked={accept}
          onChange={setAccept}
          label={
            <span className="text-muted">
              I understand FinLex is educational, not a SEBI-registered adviser, and I accept the <Link to="/terms" className="text-accent hover:underline" target="_blank">Terms</Link> and{" "}
              <Link to="/privacy" className="text-accent hover:underline" target="_blank">Privacy policy</Link>.
            </span>
          }
        />
        <Button type="submit" className="w-full" loading={m.isPending} disabled={!accept || !pwOk}>
          Create account <ArrowRight className="h-4 w-4" />
        </Button>
      </form>
    </Shell>
  );
}
