import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addVersion, openStudio, readState, writeState } from "../../src/lib/cv-studio/store.mjs";
import { applyEdits, emptyEdits, toggleHidden } from "../../src/lib/cv-studio/edits.mjs";
import { buildHtml } from "../../src/lib/cv-studio/render.mjs";

const fixture = new URL("../fixtures/cv-studio/payload.json", import.meta.url);
const core = fileURLToPath(new URL("../../..", import.meta.url));
// web CI installs only web/ dependencies, and build-cv-html.mjs needs the core ones.
const coreInstalled = fs.existsSync(path.join(core, "node_modules", "js-yaml"));

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cv-studio-test-"));
  fs.mkdirSync(path.join(root, "output"));
  fs.copyFileSync(fixture, path.join(root, "output", "cv-jordan-northwind-2026-10-14.json"));
  return root;
}

test("opening a report reads the payload beside its indexed PDF", () => {
  const root = workspace();
  const opened = openStudio(root, "7", path.join(root, "output", "cv-jordan-northwind-2026-10-14.pdf"));
  assert.equal(opened.ok, true);
  assert.equal(opened.payload.candidate.name, "Jordan Rivera");
  assert.deepEqual(opened.state, { source: "output/cv-jordan-northwind-2026-10-14.json", versions: [], active: null });
});

test("a report with no indexed PDF or no payload says which", () => {
  const root = workspace();
  assert.deepEqual(openStudio(root, "7", null), { ok: false, reason: "no-pdf" });
  assert.deepEqual(openStudio(root, "7", path.join(root, "output", "other.pdf")), { ok: false, reason: "no-payload" });
});

test("a payload outside output/ is refused", () => {
  const root = workspace();
  fs.copyFileSync(fixture, path.join(root, "secret.json"));
  assert.deepEqual(openStudio(root, "7", path.join(root, "secret.pdf")), { ok: false, reason: "no-payload" });
});

test("saved versions persist and the pinned source survives a re-pointed index", () => {
  const root = workspace();
  const opened = openStudio(root, "7", path.join(root, "output", "cv-jordan-northwind-2026-10-14.pdf"));
  const first = addVersion(opened.state, toggleHidden(emptyEdits(), "experience.1"), "output/studio/7/v1/cv.pdf", new Date("2026-10-14T12:00:00Z"));
  const second = addVersion(first.state, emptyEdits(), "output/studio/7/v2/cv.pdf", new Date("2026-10-14T12:05:00Z"));
  writeState(root, "7", second.state);
  const reopened = openStudio(root, "7", path.join(root, "output", "studio", "7", "v2", "cv.pdf"));
  assert.equal(reopened.ok, true);
  assert.equal(reopened.state.source, "output/cv-jordan-northwind-2026-10-14.json");
  assert.deepEqual(readState(root, "7").versions.map((v) => [v.id, v.savedAt, v.edits.hidden]), [
    [1, "2026-10-14T12:00:00.000Z", ["experience.1"]],
    [2, "2026-10-14T12:05:00.000Z", []],
  ]);
  assert.equal(readState(root, "7").active, 2);
});

test("the core builder renders a hidden bullet out of the HTML", { skip: !coreInstalled && "core dependencies are not installed" }, async () => {
  const root = workspace();
  const payload = JSON.parse(fs.readFileSync(fixture, "utf8"));
  const built = await buildHtml({
    spawnFn: spawn,
    execPath: process.execPath,
    root: core,
    scripts: { buildHtml: path.join(core, "build-cv-html.mjs"), generatePdf: path.join(core, "generate-pdf.mjs") },
    payload: applyEdits(payload, toggleHidden(emptyEdits(), "experience.0.bullets.2")),
    template: "templates/cv-template.html",
  });
  assert.equal(built.ok, true, built.error);
  assert.match(built.html, /Cut deploy time 40% by moving CI to Kubernetes/);
  assert.doesNotMatch(built.html, /quarterly hackathon/);
  fs.rmSync(root, { recursive: true, force: true });
});
