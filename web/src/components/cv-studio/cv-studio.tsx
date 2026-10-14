"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, Eye, EyeOff, Loader2, Pencil, RotateCcw } from "lucide-react";
import { changeCount, emptyEdits, moveItem, outline, setText, toggleHidden } from "@/lib/cv-studio/edits.mjs";
import type { CvPayload, OutlineItem, StudioEdits } from "@/lib/cv-studio/edits.mjs";
import { coverageModel } from "@/lib/keyword-coverage.mjs";
import type { CoverageModel } from "@/lib/keyword-coverage.mjs";
import { CoverageView } from "@/components/keyword-coverage";

type Version = { id: number; savedAt: string; edits: StudioEdits; pdf: string };
type Loaded =
  | { state: "loading" }
  | { state: "unavailable"; reason: string }
  | { state: "ready"; payload: CvPayload; versions: Version[]; active: number | null };

const UNAVAILABLE: Record<string, string> = {
  "no-pdf": "This report has no tailored CV yet. Generate one from the report page, then come back here.",
  "no-payload": "This CV was generated before CV Studio existed, or by the web pdf run, so its editable source was not saved. Regenerate it with the pdf mode to customize it here.",
  invalid: "That is not a report number.",
};

function savedLabel(v: Version) {
  const when = new Date(v.savedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const n = changeCount(v.edits);
  return `${when} · ${n === 0 ? "as generated" : `${n} change${n === 1 ? "" : "s"}`}`;
}

export function CvStudio({ n }: { n: string }) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [edits, setEdits] = useState<StudioEdits>(emptyEdits());
  const [html, setHtml] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<{ model: CoverageModel; dropped: string[] } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    fetch(`/api/cv-studio?n=${encodeURIComponent(n)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!d.available) return setLoaded({ state: "unavailable", reason: d.reason });
        setLoaded({ state: "ready", payload: d.payload, versions: d.versions, active: d.active });
        const active = d.versions.find((v: Version) => v.id === d.active);
        if (active) setEdits(active.edits);
      })
      .catch(() => setLoaded({ state: "unavailable", reason: "failed" }));
  }, [n]);

  const ready = loaded.state === "ready";
  useEffect(() => {
    if (!ready) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      fetch("/api/cv-studio", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ n, action: "preview", edits }),
        signal: ctrl.signal,
      })
        .then((r) => r.json())
        .then((d) => {
          if (d.html) {
            setHtml(d.html);
            setCoverage({ model: coverageModel(d.coverage), dropped: Array.isArray(d.coverage?.dropped) ? d.coverage.dropped : [] });
            setPreviewError(null);
          } else setPreviewError(d.error ?? "Preview failed.");
        })
        .catch((e) => {
          if (e.name !== "AbortError") setPreviewError("Preview failed.");
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [n, edits, ready]);

  const sections = useMemo(() => (loaded.state === "ready" ? outline(loaded.payload, edits) : []), [loaded, edits]);

  if (loaded.state === "loading")
    return (
      <p className="mt-10 inline-flex items-center gap-2 text-sm text-muted">
        <Loader2 className="size-4 animate-spin" /> Opening your tailored CV
      </p>
    );
  if (loaded.state === "unavailable")
    return <p className="mt-8 max-w-xl rounded-xl border border-border bg-surface p-4 text-sm text-muted">{UNAVAILABLE[loaded.reason] ?? "CV Studio could not open this CV."}</p>;

  const { payload, versions, active } = loaded;
  const hidden = new Set(edits.hidden);
  const format = edits.format ?? (payload.page_format === "a4" ? "a4" : "letter");
  const dirty = JSON.stringify(edits) !== JSON.stringify(versions.find((v) => v.id === active)?.edits ?? emptyEdits());

  async function save() {
    setSaving(true);
    setSaveResult(null);
    try {
      const r = await fetch("/api/cv-studio", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ n, action: "save", edits }) });
      const d = await r.json();
      if (!r.ok) return setSaveResult({ ok: false, message: d.error ?? "Saving failed." });
      setLoaded((prev) => (prev.state === "ready" ? { ...prev, versions: [...prev.versions, d.version], active: d.active } : prev));
      setSaveResult({ ok: true, message: `Saved as v${d.version.id}. Applying to this job now attaches it.` });
    } catch {
      setSaveResult({ ok: false, message: "Saving failed." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <aside className="space-y-5" aria-label="Customize CV">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={save}
            disabled={saving || !dirty}
            className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-1.5 text-sm font-medium text-brand-foreground transition-opacity disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Save and use when applying
          </button>
          <button
            onClick={() => setEdits(emptyEdits())}
            disabled={changeCount(edits) === 0}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm text-muted transition-colors hover:text-brand disabled:opacity-50"
          >
            <RotateCcw className="size-4" /> Restore generated
          </button>
        </div>
        {saveResult && (
          <p role={saveResult.ok ? "status" : "alert"} className={saveResult.ok ? "text-sm text-emerald-700 dark:text-emerald-400" : "text-sm text-red-600"}>
            {saveResult.message}
          </p>
        )}

        {coverage && (
          <CoverageView model={coverage.model} caption="this JD vs this version">
            {coverage.dropped.length > 0 && (
              <p role="status" className="mt-3 text-sm text-foreground">
                Your edits removed {coverage.dropped.join(", ")}. Bring back a line that mentions {coverage.dropped.length === 1 ? "it" : "them"}, or reword one you kept.
              </p>
            )}
          </CoverageView>
        )}

        <fieldset className="flex items-center gap-2 text-sm">
          <legend className="sr-only">Page size</legend>
          <span className="text-muted">Page size</span>
          {(["letter", "a4"] as const).map((f) => (
            <button
              key={f}
              aria-pressed={format === f}
              onClick={() => setEdits({ ...edits, format: f === (payload.page_format === "a4" ? "a4" : "letter") ? null : f })}
              className={`rounded-full border px-3 py-0.5 ${format === f ? "border-brand bg-brand-soft text-brand" : "border-border text-muted"}`}
            >
              {f === "a4" ? "A4" : "Letter"}
            </button>
          ))}
        </fieldset>

        {sections.map((section) => (
          <section key={section.key} aria-label={section.title} className="rounded-xl border border-border bg-surface p-3">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-faint">{section.title}</h2>
            <ul className="space-y-1">
              {section.items.map((item, index) => (
                <Row
                  key={item.id}
                  item={item}
                  hidden={hidden}
                  index={index}
                  count={section.items.length}
                  listPath={section.list}
                  edits={edits}
                  setEdits={setEdits}
                />
              ))}
            </ul>
          </section>
        ))}

        {versions.length > 0 && (
          <section aria-label="Saved versions" className="rounded-xl border border-border p-3">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-faint">Saved versions</h2>
            <ul className="space-y-1 text-sm">
              {[...versions].reverse().map((v) => (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <span className="font-medium">v{v.id}</span> <span className="text-muted">{savedLabel(v)}</span>
                    {v.id === active && <span className="ml-2 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-400">used when applying</span>}
                  </span>
                  <span className="flex gap-2 text-xs">
                    <a className="text-muted hover:text-brand" href={`/api/cv-studio/pdf?n=${encodeURIComponent(n)}&v=${v.id}`} target="_blank" rel="noreferrer">PDF</a>
                    <button className="text-muted hover:text-brand" onClick={() => setEdits(v.edits)}>Load</button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </aside>

      <section aria-label="Preview" className="min-h-[70vh] self-start overflow-hidden lg:sticky lg:top-4 rounded-xl border border-border bg-neutral-100 dark:bg-neutral-900">
        {previewError && <p role="alert" className="p-3 text-sm text-red-600">{previewError}</p>}
        {html ? (
          <iframe title="CV preview" srcDoc={html} sandbox="" className="h-[80vh] w-full bg-white" />
        ) : (
          <p className="inline-flex items-center gap-2 p-4 text-sm text-muted">
            <Loader2 className="size-4 animate-spin" /> Rendering preview
          </p>
        )}
      </section>
    </div>
  );
}

function Row({
  item,
  hidden,
  index,
  count,
  listPath,
  edits,
  setEdits,
  depth = 0,
}: {
  item: OutlineItem;
  hidden: Set<string>;
  index: number;
  count: number;
  listPath: string | null;
  edits: StudioEdits;
  setEdits: (e: StudioEdits) => void;
  depth?: number;
}) {
  const [editing, setEditing] = useState(false);
  const off = hidden.has(item.id);
  const original = item.original;

  return (
    <li className={depth ? "ml-5" : ""}>
      <div className={`group flex items-start gap-1.5 rounded-lg px-1.5 py-1 hover:bg-surface-hover ${off ? "opacity-50" : ""}`}>
        <button
          aria-label={off ? `Include ${item.label}` : `Leave out ${item.label}`}
          aria-pressed={!off}
          onClick={() => setEdits(toggleHidden(edits, item.id))}
          className="mt-0.5 text-faint hover:text-brand"
        >
          {off ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
        <div className="min-w-0 flex-1">
          {editing ? (
            <textarea
              autoFocus
              defaultValue={item.label}
              aria-label={`Edit ${item.label}`}
              onBlur={(e) => {
                if (original !== undefined) setEdits(setText(edits, item.id, e.target.value.trim(), original));
                setEditing(false);
              }}
              className="w-full rounded border border-border bg-background p-1 text-sm"
              rows={3}
            />
          ) : (
            <p className={`text-sm ${off ? "line-through" : ""} ${depth ? "" : "font-medium"}`}>
              {item.label}
              {edits.text[item.id] !== undefined && <span className="ml-1.5 text-xs text-brand">edited</span>}
            </p>
          )}
          {item.detail && <p className="text-xs text-faint">{item.detail}</p>}
        </div>
        <span className="flex shrink-0 gap-0.5 opacity-60 group-hover:opacity-100">
          {original !== undefined && !editing && (
            <button aria-label={`Edit ${item.label}`} onClick={() => setEditing(true)} className="p-0.5 text-faint hover:text-brand">
              <Pencil className="size-3.5" />
            </button>
          )}
          {listPath && (
            <>
              <button aria-label={`Move ${item.label} up`} disabled={index === 0} onClick={() => setEdits(moveItem(edits, listPath, count, index, index - 1))} className="p-0.5 text-faint hover:text-brand disabled:opacity-30">
                <ArrowUp className="size-3.5" />
              </button>
              <button aria-label={`Move ${item.label} down`} disabled={index === count - 1} onClick={() => setEdits(moveItem(edits, listPath, count, index, index + 1))} className="p-0.5 text-faint hover:text-brand disabled:opacity-30">
                <ArrowDown className="size-3.5" />
              </button>
            </>
          )}
        </span>
      </div>
      {item.children && item.childList !== undefined && (
        <ul className="space-y-0.5">
          {item.children.map((child, k) => (
            <Row key={child.id} item={child} hidden={hidden} index={k} count={item.children!.length} listPath={item.childList ?? null} edits={edits} setEdits={setEdits} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}
