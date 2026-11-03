import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Logo } from "@/components/Logo";

function Doc({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-line/60">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-5">
          <Link to="/"><Logo /></Link>
          <Link to="/app" className="btn-ghost !py-1.5 text-sm">Open app</Link>
        </div>
      </header>
      <article className="mx-auto max-w-3xl px-5 py-10">
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-faint">Last updated {updated}</p>
        <div className="mt-8 space-y-6 text-[15px] leading-relaxed text-muted [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-ink [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1.5">{children}</div>
      </article>
    </div>
  );
}

export function Privacy() {
  return (
    <Doc title="Privacy policy" updated="3 November 2026">
      <section>
        <h2>What FinLex stores</h2>
        <ul>
          <li>Your account email, display name and a salted bcrypt hash of your password.</li>
          <li>The holdings, transactions, accounts, alerts and preferences you enter or import.</li>
          <li>Ask FinLex conversation history (you can clear it at any time).</li>
          <li>An audit log of security-relevant actions (sign-in, imports, exports, consent changes).</li>
        </ul>
      </section>
      <section>
        <h2>What FinLex never asks for</h2>
        <p>No broker passwords, OTPs, trading PINs or order-placement permissions. FinLex cannot trade on your behalf.</p>
      </section>
      <section>
        <h2>Statements</h2>
        <p>CAMS/KFintech/NSDL/CDSL statement PDFs and their passwords are processed in memory to extract holdings for your review and are never written to disk. After you confirm an import, the parsed preview rows are deleted too.</p>
      </section>
      <section>
        <h2>AI processing (optional)</h2>
        <p>If the operator has configured an AI provider (Anthropic Claude), Ask FinLex can send the specific figures needed to answer your question to that provider — only after you switch on consent in Settings. Without consent, a local engine answers from the same data and nothing leaves the server.</p>
      </section>
      <section>
        <h2>Your controls</h2>
        <ul>
          <li>Export everything as JSON from Settings → Data.</li>
          <li>Delete your account permanently; holdings, transactions, alerts, chat and audit records are removed immediately.</li>
          <li>Sign out of all sessions at once.</li>
        </ul>
      </section>
      <section>
        <h2>Demo sessions</h2>
        <p>Demo accounts contain synthetic holdings only and are deleted automatically after 24 hours.</p>
      </section>
    </Doc>
  );
}

export function Terms() {
  return (
    <Doc title="Terms of use" updated="3 November 2026">
      <section>
        <h2>Educational use only</h2>
        <p>FinLex is an analytical and educational tool. It is not a SEBI-registered investment adviser or research analyst and does not provide buy, sell or hold recommendations, price targets or personalised investment advice. Consult a SEBI-registered adviser for advice.</p>
      </section>
      <section>
        <h2>Data and accuracy</h2>
        <p>Market data is delayed and sourced from third parties as labelled on each screen. Mutual-fund look-through uses periodic disclosures and estimates. Forecasts are experimental statistical ranges that will sometimes be wrong; their historical performance, including misses, is published on the Track Record page.</p>
      </section>
      <section>
        <h2>Your responsibilities</h2>
        <p>Keep your credentials secure and verify important figures against official statements before making decisions. Don't upload documents you don't have the right to process.</p>
      </section>
      <section>
        <h2>Regulatory note</h2>
        <p>These terms and the product's functionality should be reviewed by qualified Indian securities-regulatory counsel before any public launch. A disclaimer alone does not establish regulatory compliance.</p>
      </section>
    </Doc>
  );
}
