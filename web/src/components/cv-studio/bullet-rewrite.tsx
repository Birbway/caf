"use client";

import { useState } from "react";
import { Check, Loader2, Sparkles, X } from "lucide-react";
import { wordDiff } from "@/lib/cv-studio/rewrite.mjs";
import type { RewriteAsk } from "@/lib/cv-studio/rewrite.mjs";
import type { StudioEdits } from "@/lib/cv-studio/edits.mjs";
import { CostBadge } from "@/components/cost/cost-badge";

export type RewriteContext = { n: string; cliId: string; keywords: string[]; edits: StudioEdits };

type Phase =
  | { state: "idle" }
  | { state: "asking" }
  | { state: "suggested"; text: string; notices: string[] }
  | { state: "failed"; message: string; notices: string[] };

const chip = "rounded-full border border-border px-2.5 py-0.5 text-xs text-muted transition-colors hover:border-brand hover:text-brand disabled:opacity-50";

export function BulletRewrite({ id, current, ctx, onAccept, onClose }: { id: string; current: string; ctx: RewriteContext; onAccept: (text: string) => void; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>({ state: "idle" });
  const [instruction, setInstruction] = useState("");

  async function ask(rewriteAsk: RewriteAsk) {
    setPhase({ state: "asking" });
    try {
      const r = await fetch("/api/cv-studio", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ n: ctx.n, action: "rewrite", edits: ctx.edits, id, ask: rewriteAsk, cliId: ctx.cliId }),
      });
      const d = await r.json();
      const notices = Array.isArray(d.notices) ? d.notices : [];
      if (d.ok) setPhase({ state: "suggested", text: d.text, notices });
      else setPhase({ state: "failed", message: d.message ?? d.error ?? "The rewrite failed.", notices });
    } catch {
      setPhase({ state: "failed", message: "The rewrite failed.", notices: [] });
    }
  }

  const busy = phase.state === "asking";
  return (
    <div role="group" aria-label="Rewrite with AI" className="mt-1.5 space-y-2 rounded-lg border border-border bg-background p-2 text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <button className={chip} disabled={busy} onClick={() => ask({ kind: "quantify" })}>More quantified</button>
        <button className={chip} disabled={busy} onClick={() => ask({ kind: "shorten" })}>Shorter</button>
        {ctx.keywords.length > 0 && (
          <select
            aria-label="Emphasize a JD keyword"
            disabled={busy}
            value=""
            onChange={(e) => e.target.value && ask({ kind: "emphasize", keyword: e.target.value })}
            className={`${chip} bg-transparent`}
          >
            <option value="">Emphasize…</option>
            {ctx.keywords.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        )}
        <CostBadge kind="spend" size="xs" className="ml-auto" />
        <button aria-label="Close rewrite" onClick={onClose} className="p-0.5 text-faint hover:text-brand">
          <X className="size-3.5" />
        </button>
      </div>
      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (instruction.trim()) ask({ kind: "custom", text: instruction.trim() });
        }}
      >
        <input
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          maxLength={300}
          placeholder="Or say how to change it"
          aria-label="Rewrite instruction"
          className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-xs"
        />
        <button type="submit" disabled={busy || !instruction.trim()} className={chip}>Rewrite</button>
      </form>

      {busy && (
        <p className="inline-flex items-center gap-1.5 text-xs text-muted">
          <Loader2 className="size-3.5 animate-spin" /> Asking your AI for a new wording
        </p>
      )}
      {phase.state === "suggested" && (
        <div aria-label="Suggested rewrite" className="space-y-2">
          <p className="leading-relaxed">
            {wordDiff(current, phase.text).map((part, k) =>
              part.op === "same" ? (
                <span key={k}>{part.text}</span>
              ) : part.op === "del" ? (
                <del key={k} className="bg-red-500/10 text-red-700 dark:text-red-400">{part.text}</del>
              ) : (
                <ins key={k} className="bg-emerald-500/10 text-emerald-800 no-underline dark:text-emerald-300">{part.text}</ins>
              ),
            )}
          </p>
          <div className="flex gap-1.5">
            <button onClick={() => onAccept(phase.text)} className="inline-flex items-center gap-1 rounded-full bg-brand px-3 py-0.5 text-xs font-medium text-brand-foreground">
              <Check className="size-3.5" /> Accept
            </button>
            <button onClick={() => setPhase({ state: "idle" })} className={chip}>Reject</button>
          </div>
        </div>
      )}
      {phase.state === "failed" && <p role="alert" className="text-xs text-red-600">{phase.message}</p>}
      {(phase.state === "suggested" || phase.state === "failed") &&
        phase.notices.map((notice) => (
          <p key={notice} className="text-xs text-faint">{notice}</p>
        ))}
    </div>
  );
}

export function RewriteButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button aria-label={`Rewrite ${label} with AI`} onClick={onClick} className="p-0.5 text-faint hover:text-brand">
      <Sparkles className="size-3.5" />
    </button>
  );
}
