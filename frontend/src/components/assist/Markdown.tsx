/* Tiny, safe markdown subset renderer: paragraphs, "- " bullets, **bold**, *italic*, line breaks.
   Builds React nodes only (no dangerouslySetInnerHTML), so model/tool output can never inject HTML. */
import { Fragment, type ReactNode } from "react";

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) out.push(<strong key={`${keyBase}-b${i++}`} className="font-semibold text-ink">{tok.slice(2, -2)}</strong>);
    else out.push(<em key={`${keyBase}-i${i++}`}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = text.replace(/\r\n/g, "\n").split(/\n{2,}/);
  return (
    <div className={className}>
      {blocks.map((block, bi) => {
        const lines = block.split("\n").filter((l) => l.trim() !== "");
        if (!lines.length) return null;
        const isList = lines.every((l) => /^\s*[-•]\s+/.test(l));
        if (isList)
          return (
            <ul key={bi} className="my-2 space-y-1 pl-1">
              {lines.map((l, li) => (
                <li key={li} className="flex gap-2">
                  <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-faint" aria-hidden />
                  <span className="min-w-0">{inline(l.replace(/^\s*[-•]\s+/, ""), `${bi}-${li}`)}</span>
                </li>
              ))}
            </ul>
          );
        // mixed block: render list lines as bullets, others as text lines
        return (
          <p key={bi} className="my-2 first:mt-0 last:mb-0">
            {lines.map((l, li) => {
              const bullet = /^\s*[-•]\s+/.test(l);
              return (
                <Fragment key={li}>
                  {li > 0 && <br />}
                  {bullet ? (
                    <span className="inline-flex gap-2">
                      <span aria-hidden>•</span>
                      <span>{inline(l.replace(/^\s*[-•]\s+/, ""), `${bi}-${li}`)}</span>
                    </span>
                  ) : (
                    inline(l, `${bi}-${li}`)
                  )}
                </Fragment>
              );
            })}
          </p>
        );
      })}
    </div>
  );
}
