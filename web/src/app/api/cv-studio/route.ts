import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { careerOpsRoot, findReportFile, pdfPathStatusForReport, rootScript } from "@/lib/career-ops";
import { resolveCvTemplate } from "@/lib/core/cv-template.mjs";
import { readJsonObject } from "@/lib/json-body";
import { applyEdits, outline, parseEdits } from "@/lib/cv-studio/edits.mjs";
import type { CvPayload, StudioEdits } from "@/lib/cv-studio/edits.mjs";
import { addVersion, openStudio, readState, reportKey, reserveVersion, writeState } from "@/lib/cv-studio/store.mjs";
import { buildHtml, renderPdf } from "@/lib/cv-studio/render.mjs";
import { studioCoverage } from "@/lib/cv-studio/coverage.mjs";
import { factVerdict, isRewritableBullet, parseAsk, rewriteBullet } from "@/lib/cv-studio/rewrite.mjs";
import { cliSubstitutionNotice, cliUnavailableError, resolveCliOrFallback } from "@/lib/clis";
import { scopeFrom } from "@/lib/claude-invocation.mjs";
import { fencingReport } from "@/lib/cli-fencing.mjs";
import { spawnHeadlessCli } from "@/lib/spawn-cli.mjs";
import { CAPS } from "@/lib/worker-capabilities.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 240;

const NO_TOOLS = scopeFrom("");
const REWRITE_TIMEOUT_MS = 180_000;

async function open(n: string) {
  const report = reportKey(n);
  if (!report) return { report: null, studio: null };
  const root = careerOpsRoot();
  const indexed = await pdfPathStatusForReport(report);
  const studio = openStudio(root, report, indexed.status === "found" ? indexed.path : null);
  return { report, studio };
}

async function coverageFor(report: string, html: string, generatedHtml: string) {
  const file = findReportFile(report);
  try {
    const km = await import(/* webpackIgnore: true */ pathToFileURL(rootScript("keyword-match")).href);
    return studioCoverage(km, file ? fs.readFileSync(file, "utf8") : null, html, generatedHtml);
  } catch {
    return { available: false, reason: "no-script", result: null, dropped: [] };
  }
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

function readIfPresent(file: string) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function runAgent(binPath: string, cliId: string, args: string[], root: string): Promise<string> {
  return new Promise((resolve) => {
    let out = "";
    let child;
    try {
      child = spawnHeadlessCli(binPath, args, { cwd: root, env: process.env }, { cliId, capabilities: CAPS.localReadOnly });
    } catch {
      return resolve("");
    }
    const killer = setTimeout(() => child.kill("SIGTERM"), REWRITE_TIMEOUT_MS);
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.on("error", () => resolve(out));
    child.on("close", () => {
      clearTimeout(killer);
      resolve(out);
    });
  });
}

async function rewrite(root: string, report: string, payload: CvPayload, edits: StudioEdits, body: { id?: unknown; ask?: unknown; cliId?: unknown }) {
  const item = outline(payload, edits).flatMap((s) => s.items.flatMap((i) => [i, ...(i.children ?? [])])).find((i) => i.id === body.id);
  if (!item || item.original === undefined || !isRewritableBullet(item.label)) return Response.json({ error: "That line cannot be rewritten." }, { status: 400 });
  const reportFile = findReportFile(report);
  const jd = reportFile ? readIfPresent(reportFile) : "";
  const ask = parseAsk(body.ask, jd);
  if (!ask) return Response.json({ error: "Pick a preset, a keyword from this job description, or write an instruction." }, { status: 400 });
  const requested = typeof body.cliId === "string" ? body.cliId : "";
  const resolved = resolveCliOrFallback(requested);
  if (!resolved) return Response.json(cliUnavailableError(requested), { status: 404 });
  const { spec, binPath } = resolved;
  const sources = [path.join(root, "cv.md"), path.join(root, "article-digest.md")];
  const facts = sources.map(readIfPresent).join("\n").slice(0, 24_000);
  const { verifyFacts } = await import(/* webpackIgnore: true */ pathToFileURL(rootScript("verify-cv-facts")).href);
  const outcome = await rewriteBullet({
    bullet: item.label,
    ask,
    jd,
    facts,
    tag: crypto.randomBytes(6).toString("hex"),
    run: (prompt: string) =>
      runAgent(
        binPath,
        spec.id,
        spec.id === "claude"
          ? ["-p", prompt, "--output-format", "text", "--strict-mcp-config", "--allowedTools", NO_TOOLS.allowed, "--disallowedTools", NO_TOOLS.disallowed]
          : spec.args(prompt),
        root,
      ),
    check: (text: string) => factVerdict(verifyFacts(text, { sourcePaths: sources, configPath: path.join(root, "config", "cv-facts.json") })),
  });
  const notices = [fencingReport({ cliId: spec.id, cliName: spec.name, capabilities: CAPS.localReadOnly }).notice, cliSubstitutionNotice(resolved)].filter(Boolean);
  return Response.json({ ...outcome, cli: spec.name, notices }, { status: outcome.ok ? 200 : 422 });
}

// action "preview" returns the HTML for a set of edits. action "save" renders
// the PDF, records it as the report's tailored CV, and adds a version.
// action "rewrite" asks the user's agent CLI for a new wording of one bullet.
export async function POST(req: Request) {
  const body = await readJsonObject<{ n?: unknown; action?: unknown; edits?: unknown; id?: unknown; ask?: unknown; cliId?: unknown }>(req);
  if (!body || (body.action !== "preview" && body.action !== "save" && body.action !== "rewrite")) return Response.json({ error: "bad request" }, { status: 400 });
  const { report, studio } = await open(String(body.n ?? ""));
  if (!report || !studio) return Response.json({ error: "invalid report number" }, { status: 400 });
  if (!studio.ok) return Response.json({ error: studio.reason }, { status: 404 });

  const root = careerOpsRoot();
  const edits = parseEdits(body.edits);
  if (body.action === "rewrite") return rewrite(root, report, studio.payload, edits, body);
  const payload = applyEdits(studio.payload, edits);
  const template = await resolveCvTemplate(root);
  const io = { spawnFn: spawn, execPath: process.execPath, root, scripts: { buildHtml: rootScript("build-cv-html"), generatePdf: rootScript("generate-pdf") } };

  if (body.action === "preview") {
    const [built, generated] = await Promise.all([buildHtml({ ...io, payload, template }), buildHtml({ ...io, payload: studio.payload, template })]);
    if (!built.ok) return Response.json({ error: built.error }, { status: 422 });
    return Response.json({ html: built.html, coverage: await coverageFor(report, built.html, generated.ok ? generated.html : built.html) });
  }

  const { id, dir } = reserveVersion(root, report, studio.state);
  const pdfName = path.basename(studio.state.source).replace(/\.json$/i, ".pdf");
  const built = await buildHtml({ ...io, payload, template, htmlPath: path.join(dir, pdfName.replace(/\.pdf$/, ".html")) });
  if (!built.ok) return Response.json({ error: built.error }, { status: 422 });
  const pdfPath = path.join(dir, pdfName);
  const format = edits.format ?? (payload.page_format === "a4" ? "a4" : "letter");
  const rendered = await renderPdf({ ...io, htmlPath: built.htmlPath, pdfPath, format, report });
  if (!rendered.ok) return Response.json({ error: rendered.stderr || "PDF rendering failed" }, { status: 422 });
  const { state, version } = addVersion(readState(root, report) ?? studio.state, id, edits, path.relative(root, pdfPath).split(path.sep).join("/"));
  writeState(root, report, state);
  return Response.json({ version, active: state.active, warnings: rendered.stderr ? rendered.stderr.split("\n").filter(Boolean) : [] });
}
