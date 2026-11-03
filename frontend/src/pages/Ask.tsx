import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Bot, Check, Database, Send, ShieldAlert, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Markdown } from "@/components/assist/Markdown";
import { Badge, Button, Card, ErrorState, Notice, PageHeader, Skeleton, Textarea, toast } from "@/components/ui";
import { api } from "@/lib/api";
import { ago } from "@/lib/format";
import type { ChatMsg, User } from "@/lib/types";

const SUGGESTIONS = [
  "How much of my portfolio is exposed to banking stocks?",
  "Which of my mutual funds share the most holdings?",
  "Why did my portfolio value change this week?",
  "What is FinLex's forecast range for gold next month?",
  "Explain the latest quarterly result in simple language",
  "What does forecast interval coverage mean?",
  "Should I buy Reliance?",
];

const TOOL_LABELS: Record<string, string> = {
  portfolio_summary: "Portfolio",
  exposure: "Exposure",
  fund_overlap: "Fund overlap",
  value_change: "Value history",
  market_brief: "Market brief",
  compare: "Compare",
  forecast: "Forecast",
  track_record: "Track record",
  glossary: "Glossary",
  expert_review: "Rule review",
  filing: "Filing",
};

interface Answer {
  answer: string;
  engine: string;
  citations: { tool: string; detail: string; as_of: string | null }[];
  guardrail: string | null;
}

export default function Ask() {
  const qc = useQueryClient();
  const hist = useQuery({ queryKey: ["ask-history"], queryFn: () => api.get<ChatMsg[]>("/api/ask/history") });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.get<{ user: User; llm_configured: boolean }>("/api/settings") });
  const [pending, setPending] = useState<ChatMsg[]>([]);
  const [text, setText] = useState("");
  const scroller = useRef<HTMLDivElement>(null);

  const send = useMutation({
    mutationFn: (message: string) => api.post<Answer>("/api/ask", { message }),
    onMutate: (message) => setPending([{ role: "user", content: message }]),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["ask-history"] });
      setPending([]);
    },
    onError: (_e, message) => {
      setPending([]);
      setText(message);
    },
  });
  const clear = useMutation({
    mutationFn: () => api.del("/api/ask/history"),
    onSuccess: () => {
      qc.setQueryData(["ask-history"], []);
      toast("Conversation cleared");
    },
  });

  const messages = [...(hist.data ?? []), ...pending];
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, send.isPending]);

  const submit = (msg?: string) => {
    const m = (msg ?? text).trim();
    if (!m || send.isPending) return;
    setText("");
    send.mutate(m);
  };

  const llm = settings.data?.llm_configured;
  const consent = settings.data?.user.consent_llm;

  return (
    <div>
      <PageHeader
        eyebrow="Assist"
        title="Ask FinLex"
        subtitle="Questions about your own portfolio and FinLex's analysis, answered from your data with citations. It never gives buy, sell or hold calls."
        actions={
          messages.length > 0 && (
            <Button variant="ghost" size="sm" loading={clear.isPending} onClick={() => window.confirm("Clear the whole conversation? This can't be undone.") && clear.mutate()}>
              <Trash2 className="h-4 w-4" /> Clear history
            </Button>
          )
        }
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="card flex h-[72vh] min-h-[460px] flex-col overflow-hidden lg:h-[calc(100vh-15rem)]">
          <div ref={scroller} className="flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-6" aria-live="polite">
            {hist.isLoading ? (
              <div className="space-y-4">
                <Skeleton className="ml-auto h-10 w-2/3" />
                <Skeleton className="h-24 w-3/4" />
              </div>
            ) : hist.error ? (
              <ErrorState error={hist.error} onRetry={() => hist.refetch()} />
            ) : messages.length === 0 ? (
              <Welcome onPick={submit} />
            ) : (
              messages.map((m, i) => <Message key={m.id ?? `p${i}`} m={m} />)
            )}
            {send.isPending && <Typing />}
            {send.error && <Notice tone="neg" title="Couldn't get an answer">{(send.error as Error).message}</Notice>}
          </div>
          {messages.length > 0 && (
            <div className="flex gap-2 overflow-x-auto border-t border-line/50 px-4 py-2.5 sm:px-6 lg:hidden">
              {SUGGESTIONS.slice(0, 5).map((s) => (
                <button key={s} onClick={() => submit(s)} disabled={send.isPending} className="shrink-0 rounded-full border border-line px-3 py-1 text-xs text-muted transition hover:border-accent/40 hover:text-ink disabled:opacity-50">
                  {s}
                </button>
              ))}
            </div>
          )}
          <form
            className="flex items-end gap-2 border-t border-line/60 bg-surface2/30 p-3 sm:p-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={1}
              maxLength={2000}
              placeholder="Ask about your portfolio…"
              className="!min-h-[44px] max-h-40 resize-none"
              aria-label="Message"
              autoFocus
            />
            <Button type="submit" className="h-11 shrink-0" disabled={!text.trim()} loading={send.isPending} aria-label="Send">
              {!send.isPending && <Send className="h-4 w-4" />}
            </Button>
          </form>
          <div className="px-4 pb-2 text-[10px] text-faint sm:px-6">Enter to send · Shift+Enter for a new line</div>
        </section>

        <aside className="space-y-4">
          <Card title="How Ask FinLex works">
            <ul className="space-y-2.5 text-sm">
              {[
                [true, "Answers from your holdings, look-through exposure, prices and FinLex's computed results"],
                [true, "Cites the data it used and its as-of date"],
                [true, "Explains terms, forecast ranges and their track record"],
                [false, "Buy / sell / hold calls, picks or price targets"],
                [false, "Guaranteed-return claims or invented figures"],
              ].map(([ok, t]) => (
                <li key={String(t)} className="flex gap-2.5">
                  {ok ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-pos" /> : <X className="mt-0.5 h-4 w-4 shrink-0 text-neg" />}
                  <span className="text-muted">{t as string}</span>
                </li>
              ))}
            </ul>
          </Card>
          {settings.data &&
            (llm ? (
              consent ? (
                <Notice tone="accent" title="AI processing is on" icon={<Sparkles className="h-4 w-4" />}>
                  Answers may use Claude with only the figures needed for your question. You can switch this off in <Link to="/app/settings?tab=privacy" className="text-accent hover:underline">Settings</Link>.
                </Notice>
              ) : (
                <Notice tone="info" title="Using the local engine" icon={<Database className="h-4 w-4" />}>
                  Richer AI answers are available, but only with your consent to send relevant figures to the AI provider. <Link to="/app/settings?tab=privacy" className="font-semibold text-accent hover:underline">Enable in Settings</Link>.
                </Notice>
              )
            ) : (
              <Notice tone="info" title="Private by default" icon={<Database className="h-4 w-4" />}>
                Answers come from FinLex's local engine on this server — nothing is sent to an outside AI service.
              </Notice>
            ))}
          {messages.length > 0 && <Card title="Try asking">
            <div className="flex flex-col gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => submit(s)} disabled={send.isPending} className="rounded-lg border border-line/70 px-3 py-2 text-left text-xs text-muted transition hover:border-accent/40 hover:bg-surface2/60 hover:text-ink disabled:opacity-50">
                  {s}
                </button>
              ))}
            </div>
          </Card>}
        </aside>
      </div>
    </div>
  );
}

function Welcome({ onPick }: { onPick: (s: string) => void }) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center py-8 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-accent/15 text-accent">
        <Bot className="h-6 w-6" />
      </div>
      <h2 className="mt-4 text-lg font-semibold text-ink">What would you like to understand?</h2>
      <p className="mt-1 text-sm text-muted">I answer from your own data and FinLex's calculations, and say when something is an estimate.</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {SUGGESTIONS.map((s) => (
          <button key={s} onClick={() => onPick(s)} className="rounded-full border border-line px-3 py-1.5 text-xs text-muted transition hover:border-accent/40 hover:text-ink">
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function Typing() {
  return (
    <div className="flex items-center gap-3">
      <Avatar />
      <div className="flex items-center gap-1 rounded-2xl rounded-tl-sm border border-line/70 bg-surface2/60 px-4 py-3" aria-label="FinLex is thinking">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted" style={{ animationDelay: `${i * 0.15}s` }} />
        ))}
      </div>
    </div>
  );
}

function Avatar() {
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-accent to-indigo-600 text-white">
      <Bot className="h-4 w-4" />
    </span>
  );
}

function Message({ m }: { m: ChatMsg }) {
  if (m.role === "user")
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-tr-sm bg-accent px-4 py-2.5 text-sm text-accentfg sm:max-w-[75%]">{m.content}</div>
      </div>
    );
  const meta = m.meta ?? {};
  const declined = !!meta.guardrail;
  return (
    <div className="flex items-start gap-3">
      <Avatar />
      <div className="min-w-0 max-w-[92%] sm:max-w-[80%]">
        {declined && (
          <div className="mb-1.5 inline-flex items-center gap-1.5 rounded-md border border-warn/30 bg-warn/10 px-2 py-0.5 text-[11px] font-semibold text-warn">
            <ShieldAlert className="h-3.5 w-3.5" /> Declined: personalised advice request
          </div>
        )}
        <div className={clsx("rounded-2xl rounded-tl-sm border px-4 py-3 text-sm leading-relaxed text-ink/90", declined ? "border-warn/25 bg-warn/[0.05]" : "border-line/70 bg-surface2/50")}>
          <Markdown text={m.content} />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {meta.engine && <Badge tone={meta.engine === "claude" ? "accent" : "neutral"}>{meta.engine === "claude" ? "Claude" : "Local engine"}</Badge>}
          {(meta.citations ?? []).map((c, i) => (
            <span key={i} title={c.as_of ? `As of ${c.as_of}` : undefined} className="inline-flex max-w-full items-center gap-1 truncate rounded-md border border-line/70 bg-surface px-1.5 py-0.5 text-[11px] text-muted">
              <Database className="h-3 w-3 shrink-0 text-faint" />
              <span className="font-semibold text-ink/80">{TOOL_LABELS[c.tool] ?? c.tool}</span>
              <span className="truncate">· {c.detail}</span>
              {c.as_of && <span className="shrink-0 text-faint">· {c.as_of.length > 10 ? ago(c.as_of) : c.as_of}</span>}
            </span>
          ))}
          {m.created_at && <span className="text-[10px] text-faint">{ago(m.created_at)}</span>}
        </div>
      </div>
    </div>
  );
}
