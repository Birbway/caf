/**
 * Where a report's CV Studio lives on disk.
 *
 *   output/studio/<report>.json      state: the generated payload it edits, saved versions, the active one
 *   output/studio/<report>/v<id>/    each saved version's HTML and PDF
 *
 * The generated payload is the JSON the pdf mode saves beside the tailored PDF
 * (same name, .json). The state file pins that path on first open, so a later
 * save that re-points data/pdf-index.tsv at a Studio PDF does not lose the base.
 */
import fs from "node:fs";
import path from "node:path";
import { parseEdits } from "./edits.mjs";

/** @typedef {import("./edits.mjs").StudioEdits} StudioEdits */
/** @typedef {{ id: number, savedAt: string, edits: StudioEdits, pdf: string }} StudioVersion */
/** @typedef {{ source: string, versions: StudioVersion[], active: number | null }} StudioState */

/** A report number as the Studio keys it ("007" and "7" are one report). */
export function reportKey(n) {
  return /^\d+$/.test(String(n)) ? String(Number(n)) : null;
}

export function statePath(root, report) {
  return path.join(root, "output", "studio", `${report}.json`);
}

export function versionDir(root, report, id) {
  return path.join(root, "output", "studio", report, `v${id}`);
}

/** True when `abs` sits inside root/output after resolving symlinks. */
function insideOutput(root, abs) {
  const outputDir = path.resolve(root, "output");
  try {
    const real = fs.realpathSync(abs);
    return real.startsWith(fs.realpathSync(outputDir) + path.sep);
  } catch {
    return false;
  }
}

/** The payload path the pdf mode writes for a tailored PDF. */
export function payloadPathForPdf(pdfPath) {
  return pdfPath.replace(/\.pdf$/i, ".json");
}

/**
 * @param {string} root
 * @param {string} report
 * @returns {StudioState | null}
 */
export function readState(root, report) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(statePath(root, report), "utf8"));
  } catch {
    return null;
  }
  if (!raw || typeof raw.source !== "string") return null;
  const versions = Array.isArray(raw.versions)
    ? raw.versions
        .filter((v) => v && Number.isInteger(v.id) && typeof v.pdf === "string")
        .map((v) => ({ id: v.id, savedAt: String(v.savedAt ?? ""), edits: parseEdits(v.edits), pdf: v.pdf }))
    : [];
  const active = versions.some((v) => v.id === raw.active) ? raw.active : null;
  return { source: raw.source, versions, active };
}

/** Write the state atomically so a crash mid-write never leaves half a file. */
export function writeState(root, report, state) {
  const file = statePath(root, report);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

/**
 * Open a report's Studio: the generated payload plus its saved state.
 * `indexedPdf` is the absolute path data/pdf-index.tsv records for the report,
 * or null when it has none.
 * @returns {{ ok: true, payload: import("./edits.mjs").CvPayload, state: StudioState } | { ok: false, reason: "no-pdf" | "no-payload" }}
 */
export function openStudio(root, report, indexedPdf) {
  const saved = readState(root, report);
  const source = saved ? path.resolve(root, saved.source) : indexedPdf ? payloadPathForPdf(indexedPdf) : null;
  if (!source) return { ok: false, reason: "no-pdf" };
  if (!insideOutput(root, source)) return { ok: false, reason: "no-payload" };
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(source, "utf8"));
  } catch {
    return { ok: false, reason: "no-payload" };
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { ok: false, reason: "no-payload" };
  const state = saved ?? { source: path.relative(root, source).split(path.sep).join("/"), versions: [], active: null };
  return { ok: true, payload, state };
}

/**
 * Claim the next free version id for a save by creating its directory.
 * mkdir fails on a directory that exists, so two saves that start from the
 * same state get different ids.
 * @returns {{ id: number, dir: string }}
 */
export function reserveVersion(root, report, state) {
  fs.mkdirSync(path.join(root, "output", "studio", report), { recursive: true });
  for (let id = state.versions.reduce((max, v) => Math.max(max, v.id), 0) + 1; ; id++) {
    const dir = versionDir(root, report, id);
    try {
      fs.mkdirSync(dir);
      return { id, dir };
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
    }
  }
}

/** Append a version and make it the active one. Returns the new state and version. */
export function addVersion(state, id, edits, pdf, now = new Date()) {
  const version = { id, savedAt: now.toISOString(), edits, pdf };
  return { state: { ...state, versions: [...state.versions, version].sort((x, y) => x.id - y.id), active: id }, version };
}
