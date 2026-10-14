import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { applyEdits, emptyEdits, moveItem, outline, parseEdits, setText, toggleHidden } from "../../src/lib/cv-studio/edits.mjs";

const payload = JSON.parse(fs.readFileSync(new URL("../fixtures/cv-studio/payload.json", import.meta.url), "utf8"));

test("no edits renders the generated payload unchanged", () => {
  assert.deepEqual(applyEdits(payload, emptyEdits()).experience[0].bullets, [
    "Cut deploy time 40% by moving CI to Kubernetes",
    "Led a team of 5 engineers on the billing rewrite",
    "Organized the quarterly hackathon",
  ]);
});

test("a hidden bullet leaves the CV and the generated payload keeps it", () => {
  const out = applyEdits(payload, toggleHidden(emptyEdits(), "experience.0.bullets.2"));
  assert.deepEqual(out.experience[0].bullets, ["Cut deploy time 40% by moving CI to Kubernetes", "Led a team of 5 engineers on the billing rewrite"]);
  assert.equal(payload.experience[0].bullets.length, 3);
});

test("toggling twice brings the item back", () => {
  const edits = toggleHidden(toggleHidden(emptyEdits(), "experience.1"), "experience.1");
  assert.deepEqual(applyEdits(payload, edits).experience.map((e) => e.company), ["Northwind Labs", "Contoso Systems"]);
});

test("moving a bullet reorders it in the CV and in the outline", () => {
  const edits = moveItem(emptyEdits(), "experience.0.bullets", 3, 2, 0);
  assert.deepEqual(applyEdits(payload, edits).experience[0].bullets[0], "Organized the quarterly hackathon");
  assert.deepEqual(outline(payload, edits).find((s) => s.key === "experience").items[0].children.map((c) => c.id), [
    "experience.0.bullets.2",
    "experience.0.bullets.0",
    "experience.0.bullets.1",
  ]);
});

test("skill items split from a comma string can be hidden one by one", () => {
  const out = applyEdits(payload, toggleHidden(emptyEdits(), "skills.0.items.2"));
  assert.deepEqual(out.skills[0].items, ["Go", "TypeScript"]);
});

test("a skills category with every item hidden drops out instead of rendering empty", () => {
  const edits = toggleHidden(toggleHidden(emptyEdits(), "skills.1.items.0"), "skills.1.items.1");
  assert.deepEqual(applyEdits(payload, edits).skills.map((s) => s.category), ["Languages"]);
});

test("edited text replaces the bullet, and typing the original back clears the override", () => {
  const original = payload.experience[0].bullets[1];
  const edited = setText(emptyEdits(), "experience.0.bullets.1", "Led 5 engineers through the billing rewrite", original);
  assert.equal(applyEdits(payload, edited).experience[0].bullets[1], "Led 5 engineers through the billing rewrite");
  assert.deepEqual(setText(edited, "experience.0.bullets.1", original, original).text, {});
});

test("a summary can be hidden or rewritten", () => {
  assert.equal("summary" in applyEdits(payload, toggleHidden(emptyEdits(), "summary")), false);
  assert.equal(applyEdits(payload, setText(emptyEdits(), "summary", "Short.", payload.summary)).summary, "Short.");
});

test("page format override reaches the payload", () => {
  assert.equal(applyEdits(payload, { ...emptyEdits(), format: "a4" }).page_format, "a4");
});

test("a stored order that is not a permutation falls back to generated order", () => {
  const edits = parseEdits({ order: { "experience.0.bullets": [0, 0, 1] } });
  assert.deepEqual(applyEdits(payload, edits).experience[0].bullets[0], "Cut deploy time 40% by moving CI to Kubernetes");
});

test("parseEdits keeps valid fields and drops malformed ones", () => {
  assert.deepEqual(parseEdits({ hidden: ["a", 3, "a"], order: { x: [1, 0], y: ["z"] }, text: { t: "ok", u: 4 }, format: "tabloid" }), {
    hidden: ["a"],
    order: { x: [1, 0] },
    text: { t: "ok" },
    format: null,
  });
});

test("outline lists sections with labels the user recognizes", () => {
  const sections = outline(payload);
  assert.deepEqual(sections.map((s) => s.key), ["summary", "competencies", "experience", "education", "skills"]);
  assert.equal(sections[2].items[0].label, "Senior Platform Engineer · Northwind Labs");
  assert.equal(sections[2].items[0].detail, "2022 - Present");
  assert.equal(sections[2].items[0].childList, "experience.0.bullets");
});

test("outline shows edited text and keeps the generated text beside it", () => {
  const edits = setText(emptyEdits(), "competencies.1", "Golang", "Go");
  const item = outline(payload, edits).find((s) => s.key === "competencies").items[1];
  assert.deepEqual(item, { id: "competencies.1", label: "Golang", original: "Go" });
});
