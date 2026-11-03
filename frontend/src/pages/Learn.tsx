import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowLeft, BookOpen, Check, CheckCircle2, Clock, GraduationCap, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Badge, Button, Card, EmptyState, ErrorState, Input, PageHeader, ScoreBar, Skeleton, Tabs, toast } from "@/components/ui";
import { api } from "@/lib/api";
import type { GlossaryTerm, Lesson } from "@/lib/types";

type Tab = "lessons" | "glossary";

export default function Learn() {
  const [sp, setSp] = useSearchParams();
  const tab: Tab = sp.get("tab") === "glossary" || sp.get("term") ? "glossary" : "lessons";
  return (
    <div>
      <PageHeader
        eyebrow="Assist"
        title="Learn"
        subtitle="Short lessons and a plain-language glossary covering investing basics, risk, mutual-fund overlap and how FinLex's models are evaluated."
      />
      <Tabs<Tab>
        className="mb-5"
        value={tab}
        onChange={(v) => setSp(v === "lessons" ? {} : { tab: v }, { replace: true })}
        items={[
          { value: "lessons", label: "Lessons" },
          { value: "glossary", label: "Glossary" },
        ]}
      />
      {tab === "lessons" ? <Lessons /> : <Glossary />}
    </div>
  );
}

/* ------------------------------------------------------------------ lessons */
function Lessons() {
  const q = useQuery({ queryKey: ["lessons"], queryFn: () => api.get<Lesson[]>("/api/learn/lessons") });
  const [sp, setSp] = useSearchParams();
  const openId = sp.get("lesson");
  if (q.isLoading)
    return <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}</div>;
  if (q.error) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  const lessons = q.data!;
  const open = lessons.find((l) => l.id === openId);
  if (open) return <LessonView lesson={open} onBack={() => setSp({}, { replace: true })} />;
  const done = lessons.filter((l) => l.completed).length;
  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-accent/15 text-accent">
            <GraduationCap className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-semibold text-ink">Your progress</span>
              <span className="text-sm tnum text-muted"><b className="text-ink">{done}</b> of {lessons.length} lessons</span>
            </div>
            <ScoreBar className="mt-2" value={done} max={lessons.length || 1} tone="pos" />
          </div>
        </div>
      </Card>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {lessons.map((l) => (
          <button key={l.id} onClick={() => setSp({ lesson: l.id })} className="card group flex flex-col p-5 text-left transition hover:border-accent/40 hover:shadow-glow">
            <div className="flex items-center gap-2">
              <Badge tone={l.level === "Beginner" ? "pos" : l.level === "Advanced" ? "warn" : "accent"}>{l.level}</Badge>
              <span className="inline-flex items-center gap-1 text-xs text-faint"><Clock className="h-3 w-3" /> {l.minutes} min</span>
              {l.completed && (
                <span className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-pos">
                  <CheckCircle2 className="h-4 w-4" /> {l.score !== null ? `${Math.round(l.score * 100)}%` : "Done"}
                </span>
              )}
            </div>
            <h3 className="mt-3 text-[15px] font-semibold text-ink group-hover:text-accent">{l.title}</h3>
            <p className="mt-1.5 line-clamp-2 text-sm text-muted">{l.body[0]}</p>
            <span className="mt-auto pt-4 text-xs font-semibold text-accent">{l.completed ? "Review lesson →" : "Start lesson →"}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function LessonView({ lesson, onBack }: { lesson: Lesson; onBack: () => void }) {
  const qc = useQueryClient();
  const [answers, setAnswers] = useState<(number | null)[]>(() => lesson.quiz.map(() => null));
  const answered = answers.filter((a) => a !== null).length;
  const correct = answers.filter((a, i) => a === lesson.quiz[i].answer).length;
  const score = lesson.quiz.length ? correct / lesson.quiz.length : 1;
  const complete = useMutation({
    mutationFn: () => api.post(`/api/learn/lessons/${lesson.id}/complete`, { score }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lessons"] });
      toast(`Lesson completed · ${Math.round(score * 100)}%`);
      onBack();
    },
  });
  return (
    <div className="mx-auto max-w-3xl">
      <button onClick={onBack} className="btn-quiet mb-4 !px-2"><ArrowLeft className="h-4 w-4" /> All lessons</button>
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent">{lesson.level}</Badge>
          <span className="inline-flex items-center gap-1 text-xs text-faint"><Clock className="h-3 w-3" /> {lesson.minutes} min</span>
          {lesson.completed && <Badge tone="pos">Completed{lesson.score !== null ? ` · best ${Math.round(lesson.score * 100)}%` : ""}</Badge>}
        </div>
        <h2 className="mt-3 text-xl font-bold tracking-tight text-ink sm:text-2xl">{lesson.title}</h2>
        <div className="mt-4 space-y-3 text-[15px] leading-relaxed text-ink/90">
          {lesson.body.map((p, i) => <p key={i}>{p}</p>)}
        </div>
      </Card>
      {lesson.quiz.length > 0 && (
        <Card className="mt-5" title="Knowledge check" subtitle="Pick an answer to see whether it's right and why.">
          <ol className="space-y-5">
            {lesson.quiz.map((qz, qi) => {
              const a = answers[qi];
              return (
                <li key={qi}>
                  <div className="text-sm font-semibold text-ink">{qi + 1}. {qz.q}</div>
                  <div className="mt-2 grid gap-2" role="radiogroup" aria-label={qz.q}>
                    {qz.options.map((opt, oi) => {
                      const chosen = a === oi;
                      const isRight = oi === qz.answer;
                      return (
                        <button
                          key={oi}
                          role="radio"
                          aria-checked={chosen}
                          disabled={a !== null}
                          onClick={() => setAnswers((x) => x.map((v, k) => (k === qi ? oi : v)))}
                          className={clsx(
                            "flex items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 text-left text-sm transition",
                            a === null && "border-line hover:border-accent/50 hover:bg-surface2/60",
                            a !== null && isRight && "border-pos/50 bg-pos/10 text-ink",
                            a !== null && chosen && !isRight && "border-neg/50 bg-neg/10 text-ink",
                            a !== null && !chosen && !isRight && "border-line/60 text-faint",
                          )}
                        >
                          <span>{opt}</span>
                          {a !== null && isRight && <Check className="h-4 w-4 shrink-0 text-pos" />}
                          {a !== null && chosen && !isRight && <X className="h-4 w-4 shrink-0 text-neg" />}
                        </button>
                      );
                    })}
                  </div>
                  {a !== null && (
                    <p className={clsx("mt-2 text-sm", a === qz.answer ? "text-pos" : "text-muted")}>
                      {a === qz.answer ? "Correct. " : "Not quite. "}
                      <span className="text-muted">{qz.explain}</span>
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
          <div className="mt-6 flex flex-col gap-3 border-t border-line/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-muted">
              {answered < lesson.quiz.length ? `${answered} of ${lesson.quiz.length} answered` : <>Score <b className="tnum text-ink">{correct}/{lesson.quiz.length}</b></>}
            </div>
            <div className="flex gap-2">
              {answered > 0 && <Button variant="quiet" size="sm" onClick={() => setAnswers(lesson.quiz.map(() => null))}>Retry</Button>}
              <Button disabled={answered < lesson.quiz.length} loading={complete.isPending} onClick={() => complete.mutate()}>
                Complete lesson
              </Button>
            </div>
          </div>
          {complete.error && <p className="mt-2 text-sm text-neg">{(complete.error as Error).message}</p>}
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ glossary */
function Glossary() {
  const q = useQuery({ queryKey: ["glossary"], queryFn: () => api.get<GlossaryTerm[]>("/api/learn/glossary"), staleTime: Infinity });
  const [sp, setSp] = useSearchParams();
  const [search, setSearch] = useState(sp.get("term") ?? "");
  const [cat, setCat] = useState<string | null>(null);
  useEffect(() => {
    const t = sp.get("term");
    if (t) setSearch(t);
  }, [sp]);
  const cats = useMemo(() => [...new Set((q.data ?? []).map((g) => g.category))], [q.data]);
  const items = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data ?? [])
      .filter((g) => !cat || g.category === cat)
      .filter((g) => !s || g.term.toLowerCase().includes(s) || g.aliases.some((a) => a.includes(s)) || g.definition.toLowerCase().includes(s))
      .sort((a, b) => a.term.localeCompare(b.term));
  }, [q.data, search, cat]);
  if (q.isLoading) return <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div>;
  if (q.error) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative lg:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <Input
            className="pl-9"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              if (sp.get("term")) setSp({ tab: "glossary" }, { replace: true });
            }}
            placeholder="Search terms, e.g. XIRR, overlap, coverage"
            aria-label="Search glossary"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => setCat(null)} className={clsx("rounded-full border px-3 py-1 text-xs font-medium", !cat ? "border-accent/40 bg-accent/15 text-accent" : "border-line text-muted hover:text-ink")}>All</button>
          {cats.map((c) => (
            <button key={c} onClick={() => setCat(c === cat ? null : c)} aria-pressed={c === cat}
              className={clsx("rounded-full border px-3 py-1 text-xs font-medium", c === cat ? "border-accent/40 bg-accent/15 text-accent" : "border-line text-muted hover:text-ink")}>
              {c}
            </button>
          ))}
        </div>
      </div>
      <div className="text-xs text-faint">{items.length} term{items.length === 1 ? "" : "s"}</div>
      {items.length === 0 ? (
        <Card><EmptyState icon={<BookOpen className="h-5 w-5" />} title="No matching terms">Try a different word, or ask the question in Ask FinLex.</EmptyState></Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {items.map((g) => (
            <article key={g.term} id={`term-${g.term}`} className="card p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-[15px] font-semibold text-ink">{g.term}</h3>
                <Badge>{g.category}</Badge>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-muted">{g.definition}</p>
              {g.example && (
                <p className="mt-2.5 rounded-lg border-l-2 border-accent/50 bg-surface2/50 px-3 py-2 text-xs leading-relaxed text-muted">
                  <span className="font-semibold text-ink">Example: </span>{g.example}
                </p>
              )}
              {g.aliases.length > 0 && <div className="mt-2 text-[11px] text-faint">Also: {g.aliases.join(", ")}</div>}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
