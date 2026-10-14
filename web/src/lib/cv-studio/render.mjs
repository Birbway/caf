/**
 * Render a Studio payload with the core's own scripts, so the preview and the
 * saved PDF are the exact markup the pdf mode produces. build-cv-html.mjs owns
 * the HTML. generate-pdf.mjs owns the PDF and the data/pdf-index.tsv row the
 * apply flow reads.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** @typedef {{ buildHtml: string, generatePdf: string }} StudioScripts - Absolute paths to the core scripts. */

function run(spawnFn, execPath, args, cwd) {
  return new Promise((resolve) => {
    const child = spawnFn(execPath, args, { cwd });
    let stderr = "";
    child.stderr?.on("data", (d) => { stderr += d.toString(); });
    child.on("close", (code) => resolve({ ok: code === 0, stderr: stderr.trim() }));
    child.on("error", (e) => resolve({ ok: false, stderr: e.message }));
  });
}

/**
 * @param {{ spawnFn: Function, execPath: string, root: string, scripts: StudioScripts, payload: object, template: string, htmlPath?: string }} args
 * @returns {Promise<{ ok: true, html: string, htmlPath: string } | { ok: false, error: string }>}
 */
export async function buildHtml({ spawnFn, execPath, root, scripts, payload, template, htmlPath }) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "cv-studio-"));
  try {
    const input = path.join(scratch, "payload.json");
    const out = htmlPath ?? path.join(scratch, "cv.html");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(input, JSON.stringify(payload));
    const built = await run(spawnFn, execPath, [scripts.buildHtml, input, out, path.resolve(root, template)], root);
    if (!built.ok) return { ok: false, error: built.stderr || "build-cv-html.mjs failed" };
    return { ok: true, html: fs.readFileSync(out, "utf8"), htmlPath: out };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * @param {{ spawnFn: Function, execPath: string, root: string, scripts: StudioScripts, htmlPath: string, pdfPath: string, format: "a4" | "letter", report: string }} args
 * @returns {Promise<{ ok: boolean, stderr: string }>}
 */
export function renderPdf({ spawnFn, execPath, root, scripts, htmlPath, pdfPath, format, report }) {
  return run(spawnFn, execPath, [scripts.generatePdf, htmlPath, pdfPath, `--format=${format}`, `--report=${report}`, "--allow-reorder"], root);
}
