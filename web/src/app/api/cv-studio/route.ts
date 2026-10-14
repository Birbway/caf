import { spawn } from "node:child_process";
import path from "node:path";
import { careerOpsRoot, pdfPathStatusForReport, rootScript } from "@/lib/career-ops";
import { resolveCvTemplate } from "@/lib/core/cv-template.mjs";
import { readJsonObject } from "@/lib/json-body";
import { applyEdits, outline, parseEdits } from "@/lib/cv-studio/edits.mjs";
import { addVersion, nextVersionId, openStudio, reportKey, versionDir, writeState } from "@/lib/cv-studio/store.mjs";
import { buildHtml, renderPdf } from "@/lib/cv-studio/render.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function open(n: string) {
  const report = reportKey(n);
  if (!report) return { report: null, studio: null };
  const root = careerOpsRoot();
  const indexed = await pdfPathStatusForReport(report);
  const studio = openStudio(root, report, indexed.status === "found" ? indexed.path : null);
  return { report, studio };
}

// The tailored CV for one report as an editable outline, with its saved versions.
export async function GET(req: Request) {
  const { report, studio } = await open(new URL(req.url).searchParams.get("n") ?? "");
  if (!report || !studio) return Response.json({ available: false, reason: "invalid" }, { status: 400 });
  if (!studio.ok) return Response.json({ available: false, reason: studio.reason });
  const active = studio.state.versions.find((v) => v.id === studio.state.active) ?? null;
  return Response.json({
    available: true,
    payload: studio.payload,
    outline: outline(studio.payload),
    versions: studio.state.versions,
    active: active?.id ?? null,
  });
}

// action "preview" returns the HTML for a set of edits. action "save" renders
// the PDF, records it as the report's tailored CV, and adds a version.
export async function POST(req: Request) {
  const body = await readJsonObject<{ n?: unknown; action?: unknown; edits?: unknown }>(req);
  if (!body || (body.action !== "preview" && body.action !== "save")) return Response.json({ error: "bad request" }, { status: 400 });
  const { report, studio } = await open(String(body.n ?? ""));
  if (!report || !studio) return Response.json({ error: "invalid report number" }, { status: 400 });
  if (!studio.ok) return Response.json({ error: studio.reason }, { status: 404 });

  const root = careerOpsRoot();
  const edits = parseEdits(body.edits);
  const payload = applyEdits(studio.payload, edits);
  const template = await resolveCvTemplate(root);
  const io = { spawnFn: spawn, execPath: process.execPath, root, scripts: { buildHtml: rootScript("build-cv-html"), generatePdf: rootScript("generate-pdf") } };

  if (body.action === "preview") {
    const built = await buildHtml({ ...io, payload, template });
    if (!built.ok) return Response.json({ error: built.error }, { status: 422 });
    return Response.json({ html: built.html });
  }

  const dir = versionDir(root, report, nextVersionId(studio.state));
  const pdfName = path.basename(studio.state.source).replace(/\.json$/i, ".pdf");
  const built = await buildHtml({ ...io, payload, template, htmlPath: path.join(dir, pdfName.replace(/\.pdf$/, ".html")) });
  if (!built.ok) return Response.json({ error: built.error }, { status: 422 });
  const pdfPath = path.join(dir, pdfName);
  const format = edits.format ?? (payload.page_format === "a4" ? "a4" : "letter");
  const rendered = await renderPdf({ ...io, htmlPath: built.htmlPath, pdfPath, format, report });
  if (!rendered.ok) return Response.json({ error: rendered.stderr || "PDF rendering failed" }, { status: 422 });
  const { state, version } = addVersion(studio.state, edits, path.relative(root, pdfPath).split(path.sep).join("/"));
  writeState(root, report, state);
  return Response.json({ version, active: state.active, warnings: rendered.stderr ? rendered.stderr.split("\n").filter(Boolean) : [] });
}
