// Tests for personalization.mjs — the section-safe logic behind
// /api/personalization and setPersonalization. Imports directly from the module
// (single source of truth) so test and production code can never drift.
//
// Run:  node --test tests/lib/personalization.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { coercePersonalization, renderSection, sectionState, SECTIONS } from "../../src/lib/personalization.mjs";
import { mergeSections, UnsureProfileParseError } from "../../src/lib/personalization-file.mjs";

// The REAL shipped template, not a synthetic one: if its headings change, this
// fails here rather than silently leaving a section unaddressable.
const TEMPLATE = readFileSync(new URL("../../../modes/_profile.template.md", import.meta.url), "utf8");

test("every SECTIONS heading exists in the shipped template, in order", () => {
  let last = -1;
  for (const s of SECTIONS) {
    const i = TEMPLATE.indexOf(`\n${s.heading}\n`);
    assert.ok(i > last, `${s.heading} should appear after the previous heading (found at ${i})`);
    last = i;
  }
});

test("a fresh template reports every section as 'template', none 'filled'", () => {
  const st = sectionState(TEMPLATE, TEMPLATE);
  assert.equal(st.length, SECTIONS.length);
  for (const s of st) assert.equal(s.state, "template", s.heading);
});

test("an empty/missing file reports every section as 'missing'", () => {
  for (const s of sectionState("", TEMPLATE)) assert.equal(s.state, "missing");
});

test("merge replaces ONLY the given section bodies and keeps every other byte", () => {
  const rendered = { exitNarrative: "I am moving from consulting to product because I want to own outcomes." };
  const merged = mergeSections(TEMPLATE, rendered);

  // The replaced section carries the new body…
  assert.ok(merged.includes("## Your Exit Narrative\n\nI am moving from consulting to product"));
  // …the template text of that section is gone…
  assert.ok(!merged.includes("Use the candidate's exit story from `config/profile.yml`"));
  // …and every other section is byte-for-byte what the template had.
  const before = sectionState(TEMPLATE, TEMPLATE);
  const after = sectionState(merged, TEMPLATE);
  for (let i = 0; i < before.length; i++) {
    const expect = after[i].id === "exitNarrative" ? "filled" : "template";
    assert.equal(after[i].state, expect, after[i].heading);
  }
});

test("merge preserves the assistant's co-web-notes block and hand-written sections", () => {
  const custom = TEMPLATE
    + "\n## My own section\n\nHand-written, must survive.\n"
    + "\n## Notes from the web assistant\n<!-- co-web-notes:start -->\n- prefers remote\n<!-- co-web-notes:end -->\n";
  const merged = mergeSections(custom, { crossCuttingAdvantage: "Builder with real-world proof." });
  assert.ok(merged.includes("## My own section\n\nHand-written, must survive."));
  assert.ok(merged.includes("<!-- co-web-notes:start -->\n- prefers remote\n<!-- co-web-notes:end -->"));
  assert.ok(merged.includes("## Your Cross-cutting Advantage\n\nBuilder with real-world proof."));
});

test("a section whose heading is absent is appended — before the notes block", () => {
  const partial = "# Profile customization\n\n## Notes from the web assistant\n<!-- co-web-notes:start -->\n- x\n<!-- co-web-notes:end -->\n";
  // Mirror the route: render first, then merge — mergeSections takes rendered bodies.
  const merged = mergeSections(partial, { locationPolicy: renderSection("locationPolicy", ["Remote-first, EU timezones", "Hybrid only within NL"]) });
  const iSec = merged.indexOf("## Your Location Policy");
  const iNotes = merged.indexOf("## Notes from the web assistant");
  assert.ok(iSec !== -1 && iNotes !== -1 && iSec < iNotes, "new section must sit before the notes block");
  assert.ok(merged.includes("- Remote-first, EU timezones\n- Hybrid only within NL"));
});

test("merging is idempotent: the same patch twice yields the same file", () => {
  const p = { compTargets: "Targeting 85–100k EUR base for senior IC roles in NL." };
  const once = mergeSections(TEMPLATE, p);
  const twice = mergeSections(once, p);
  assert.equal(once, twice);
});

test("renderSection: tables scrub pipes and newlines out of cells", () => {
  const md = renderSection("targetRoles", [{ archetype: "AI | Platform\nEngineer", axes: "evals", buys: "ships metrics" }]);
  const rows = md.split("\n");
  assert.equal(rows.length, 3, "header + separator + one row");
  assert.ok(!rows[2].includes("AI | Platform"), "pipe inside a cell would split the table");
  assert.ok(rows[2].startsWith("| **AI / Platform Engineer** |"));
});

test("coerce keeps only well-formed fields and drops junk, unknown keys and bad URLs", () => {
  const p = coercePersonalization({
    targetRoles: [{ archetype: "ML Engineer", axes: "training, eval" }, { axes: "no archetype → dropped" }, "junk"],
    adaptiveFraming: [{ role: "ML", emphasize: "models to prod" }, { role: "no emphasize → dropped" }],
    exitNarrative: "   spaced   out   ",
    portfolio: { url: "javascript:alert(1)", description: "x" },
    negotiationScripts: ["a", 3, "b"],
    unknownKey: "ignored",
    locationPolicy: [],
  });
  assert.deepEqual(Object.keys(p).sort(), ["adaptiveFraming", "exitNarrative", "negotiationScripts", "targetRoles"]);
  assert.equal(p.targetRoles.length, 1);
  assert.equal(p.adaptiveFraming.length, 1);
  assert.equal(p.exitNarrative, "spaced out");
  assert.deepEqual(p.negotiationScripts, ["a", "b"]);
  assert.equal(p.portfolio, undefined, "non-http url is not a portfolio");
});

test("a prose section body can never open its own heading", () => {
  // mergeSections splits the file on `## `, so a body starting with one would
  // silently begin a NEW section instead of filling this one.
  assert.equal(renderSection("exitNarrative", "## My story"), "My story");
  assert.equal(renderSection("compTargets", "  ### 120k base"), "120k base");
  assert.equal(renderSection("crossCuttingAdvantage", "Plain prose"), "Plain prose");
  assert.equal(renderSection("exitNarrative", "#hashtag stays"), "#hashtag stays");
});

test("coerce of nothing usable is an empty object (→ 'nothing to write')", () => {
  assert.deepEqual(coercePersonalization({}), {});
  assert.deepEqual(coercePersonalization(null), {});
  assert.deepEqual(coercePersonalization({ exitNarrative: "" }), {});
});

// ── byte preservation ───────────────────────────────────────────────────
// The file is the user's. Everything outside the replaced body must come back
// as the SAME BYTES, not as an equivalent document.

/** Assert `merged` is `before` with exactly one span swapped for `body`. */
function assertOnlyBodySwapped(before, merged, body) {
  const at = merged.indexOf(body);
  assert.ok(at !== -1, "the new body is in the file");
  const tail = merged.slice(at + body.length);
  assert.equal(merged.slice(0, at), before.slice(0, at), "bytes before the body are untouched");
  assert.ok(before.endsWith(tail), "bytes after the body are untouched");
}

test("merge keeps CRLF line endings, odd spacing and trailing whitespace byte-for-byte", () => {
  const before = [
    "# Mine  ", "", "", "", "intro with trailing spaces   ", "",
    "## Your Exit Narrative", "", "", "old story", "second line", "", "", "",
    "## My own section", "- a", "", "", "- b\t", "",
    "## Your Comp Targets", "old comp", "",
  ].join("\r\n") + "\r\n\r\n\r\n";
  const merged = mergeSections(before, { exitNarrative: "new story" });
  assertOnlyBodySwapped(before, merged, "new story");
  assert.equal(merged, before.replace("old story\r\nsecond line", "new story"));
  assert.ok(!/[^\r]\n/.test(merged), "no bare LF was introduced into a CRLF file");
});

test("merge on the real template changes nothing but the one body", () => {
  const body = "I am moving from consulting to product.";
  const merged = mergeSections(TEMPLATE, { exitNarrative: body });
  assertOnlyBodySwapped(TEMPLATE, merged, body);
  // The neighbours, guidance comments included, are the template's own bytes.
  const from = TEMPLATE.indexOf("## Your Cross-cutting Advantage");
  assert.equal(merged.slice(merged.indexOf("## Your Cross-cutting Advantage")), TEMPLATE.slice(from));
});

test("a file with no final newline keeps having none", () => {
  const before = "## Your Location Policy\n\n- old";
  assert.equal(mergeSections(before, { locationPolicy: "- Remote" }), "## Your Location Policy\n\n- Remote");
});

test("appending a missing section leaves every existing byte in place", () => {
  const before = "# Profile\r\n\r\nhand-written   \r\n";
  const merged = mergeSections(before, { compTargets: "100k" });
  assert.ok(merged.startsWith(before));
  assert.equal(merged.slice(before.length), "\r\n## Your Comp Targets\r\n\r\n100k\r\n");
});

test("a `## ` line inside a code fence is not a section boundary", () => {
  const before = "## Your Exit Narrative\n\nold\n\n## Mine\n\n```md\n## Your Comp Targets\n```\n\nafter the fence\n";
  const merged = mergeSections(before, { exitNarrative: "new" });
  assert.equal(merged, before.replace("old", "new"));
});

// ── refusing on an unsure parse ─────────────────────────────────────────
// Each of these throws BEFORE anything is returned to write.

test("merge refuses when a target heading appears twice", () => {
  const twice = "## Your Comp Targets\n\na\n\n## Your Comp Targets\n\nb\n";
  assert.throws(() => mergeSections(twice, { compTargets: "c" }), UnsureProfileParseError);
});

test("merge refuses when a heading sits inside an HTML comment", () => {
  const commented = "## Your Exit Narrative\n\nstory\n\n<!--\n## Your Comp Targets\n\nparked\n-->\n";
  assert.throws(() => mergeSections(commented, { exitNarrative: "x" }), UnsureProfileParseError);
});

test("merge refuses on a comment or a code fence that never closes", () => {
  assert.throws(() => mergeSections("## Your Exit Narrative\n\nstory <!-- todo\n", { exitNarrative: "x" }), UnsureProfileParseError);
  assert.throws(() => mergeSections("## Your Exit Narrative\n\n```\ncode\n", { exitNarrative: "x" }), UnsureProfileParseError);
});

test("merge refuses to replace a section that holds the assistant's notes block", () => {
  const inside = "## Your Location Policy\n\n- NL\n<!-- co-web-notes:start -->\n- prefers remote\n<!-- co-web-notes:end -->\n";
  assert.throws(() => mergeSections(inside, { locationPolicy: "- EU" }), UnsureProfileParseError);
});

test("merge refuses a body that would swallow the sections after it", () => {
  const before = "## Your Exit Narrative\n\nold\n\n## Your Comp Targets\n\n100k\n";
  assert.throws(() => mergeSections(before, { exitNarrative: "see <!-- my notes" }), UnsureProfileParseError);
  assert.throws(() => mergeSections(before, { exitNarrative: "```" }), UnsureProfileParseError);
});
