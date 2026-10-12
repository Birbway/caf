// The one merge that is allowed to change the user's modes/_profile.md.
// Server-only — personalization.mjs is the half the browser can import (see
// its header), and the notes markers come from profile-memory.mjs, which reads
// files.
import { NOTES_START, NOTES_END } from "./profile-memory.mjs";
import { scanHeadings, SECTIONS } from "./personalization.mjs";

/**
 * Thrown when a write cannot be proven safe: the file's section boundaries are
 * ambiguous, or the result would not have the structure we meant to produce.
 * The caller must NOT write — modes/_profile.md is the user's file, and a
 * refused save is recoverable where a wrong splice is not.
 */
export class UnsureProfileParseError extends Error {
  constructor(reason) {
    super(`modes/_profile.md was left untouched: ${reason}`);
    this.name = "UnsureProfileParseError";
    this.code = "PROFILE_PARSE_UNSURE";
  }
}


/**
 * Replace only the bodies of the given sections, by source offset: every byte
 * outside a replaced body — other sections, line endings, blank lines, the
 * notes block, hand edits — is the byte that was there. A section whose heading
 * is absent is appended — before the assistant's notes block when that lives in
 * its own section, so the notes stay last the way rememberFact() expects.
 * Throws UnsureProfileParseError rather than guess at a boundary.
 */
export function mergeSections(existingMd, rendered) {
  // Contract: bodies arrive already rendered (renderSection). Fail loudly here
  // rather than let an array or object stringify into the user's file.
  for (const [id, body] of Object.entries(rendered ?? {})) {
    if (typeof body !== "string") throw new TypeError(`mergeSections: rendered["${id}"] must be a string (call renderSection first)`);
  }
  const text = String(existingMd ?? "");
  const { heads, unsure } = scanHeadings(text);
  if (unsure) throw new UnsureProfileParseError(unsure);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const bodyOf = (id) => rendered[id].replace(/\r?\n/g, eol);

  const edits = [];
  const missing = [];
  for (const s of SECTIONS) {
    if (rendered?.[s.id] === undefined) continue;
    const found = heads.filter((h) => h.level === 2 && h.heading === s.heading);
    if (found.length > 1) throw new UnsureProfileParseError(`"${s.heading}" appears ${found.length} times`);
    if (found.length === 0) {
      missing.push(s);
      continue;
    }
    const h = found[0];
    const region = text.slice(h.bodyStart, h.end);
    if (region.includes(NOTES_START) || region.includes(NOTES_END)) {
      throw new UnsureProfileParseError(`"${s.heading}" contains the assistant's notes block`);
    }
    // Keep the blank lines around the old body; swap only what sits between them.
    const lead = /^(?:[ \t]*\r?\n)*/.exec(region)[0];
    const trail = /\s*$/.exec(region.slice(lead.length))[0];
    if (lead.length === region.length) {
      // No body yet: there is no spacing to keep, so lay out a normal one.
      const open = h.bodyStart > h.start && text[h.bodyStart - 1] === "\n" ? eol : eol + eol;
      edits.push({ start: h.bodyStart, end: h.end, text: open + bodyOf(s.id) + eol + (h.end < text.length ? eol : "") });
    } else {
      edits.push({ start: h.bodyStart + lead.length, end: h.end - trail.length, text: bodyOf(s.id) });
    }
  }

  const notes = heads.findIndex((h) => h.level === 2 && text.slice(h.bodyStart, h.end).includes(NOTES_START));
  if (missing.length) {
    const at = notes === -1 ? text.length : heads[notes].start;
    const before = text.slice(0, at);
    const gap = !before ? "" : !before.endsWith("\n") ? eol + eol : /(?:^|\n)[ \t]*\r?\n$/.test(before) ? "" : eol;
    const block = missing.map((s) => `${s.heading}${eol}${eol}${bodyOf(s.id)}${eol}`).join(eol);
    edits.push({ start: at, end: at, text: gap + block + (at < text.length ? eol : "") });
  }

  let out = text;
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);

  // Last gate: the result must parse cleanly into exactly the headings we meant
  // to leave. A body that opens a fence or a comment would otherwise swallow
  // the sections after it on the NEXT read.
  const names = heads.map((h) => h.heading);
  names.splice(notes === -1 ? names.length : notes, 0, ...missing.map((s) => s.heading));
  const after = scanHeadings(out);
  if (after.unsure || after.heads.length !== names.length || after.heads.some((h, i) => h.heading !== names[i])) {
    throw new UnsureProfileParseError("the new text would change where the file's sections begin and end");
  }
  return out;
}
