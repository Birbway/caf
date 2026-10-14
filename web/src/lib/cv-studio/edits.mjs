/**
 * CV Studio edits. A tailored CV payload (the JSON build-cv-html.mjs renders)
 * stays exactly as the pdf mode wrote it. Every customization is an edit layered
 * on top, so a hidden bullet can come back and "restore the generated CV" is an
 * empty edit set.
 *
 * An item id is its path into the generated payload ("experience.0.bullets.2").
 * The generated payload never changes, so index paths stay stable across edits.
 */

/** @typedef {"a4" | "letter"} PageFormat */
/** @typedef {Record<string, any>} CvPayload - The JSON build-cv-html.mjs renders (modes/pdf.md, JSON Input Schema). */
/**
 * @typedef {Object} StudioEdits
 * @property {string[]} hidden - Item ids left out of the CV.
 * @property {Record<string, number[]>} order - List path to a permutation of its generated indexes.
 * @property {Record<string, string>} text - Item id to replacement text.
 * @property {PageFormat | null} format
 */

/**
 * @typedef {Object} OutlineItem
 * @property {string} id
 * @property {string} label - Text as the CV shows it, edits applied.
 * @property {string} [original] - Generated text, set on items the user can rewrite.
 * @property {string} [detail]
 * @property {string} [childList] - List path of `children`, for reordering them.
 * @property {OutlineItem[]} [children]
 */
/** @typedef {{ key: string, title: string, list: string | null, items: OutlineItem[] }} OutlineSection */

/** @returns {StudioEdits} */
export function emptyEdits() {
  return { hidden: [], order: {}, text: {}, format: null };
}

/**
 * Each list a user can toggle and reorder, keyed by payload section. `label`
 * names an entry in the outline. `children` names its nested list.
 */
const LISTS = {
  competencies: { label: (s) => s },
  experience: { label: (e) => [e.role, e.company].filter(Boolean).join(" · "), detail: (e) => e.dates ?? e.period, children: "bullets" },
  projects: { label: (e) => e.name, detail: (e) => e.description, children: "bullets" },
  education: { label: (e) => e.title, detail: (e) => [e.org, e.year].filter(Boolean).join(" · ") },
  certifications: { label: (e) => e.title, detail: (e) => [e.org, e.year].filter(Boolean).join(" · ") },
  awards: { label: (e) => e.title, detail: (e) => [e.org, e.year].filter(Boolean).join(" · ") },
  skills: { label: (e) => e.category || "Skills", children: "items" },
};

const SECTION_TITLES = {
  summary: "Summary",
  competencies: "Core competencies",
  experience: "Experience",
  projects: "Projects",
  education: "Education",
  certifications: "Certifications",
  awards: "Awards",
  skills: "Skills",
};

/** Skill items arrive as a comma-separated string or an array. Edits address each item. */
function childList(entry, key) {
  const value = entry?.[key];
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return value.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

/** The permutation for a list, or identity when the stored one does not fit. */
function orderOf(edits, listPath, length) {
  const stored = edits.order[listPath];
  if (Array.isArray(stored) && stored.length === length && new Set(stored).size === length && stored.every((i) => Number.isInteger(i) && i >= 0 && i < length)) {
    return stored;
  }
  return Array.from({ length }, (_, i) => i);
}

/**
 * The outline the Studio lists, in the user's order, hidden items included so
 * they can be switched back on.
 * @param {CvPayload} payload
 * @param {StudioEdits} edits
 * @returns {OutlineSection[]}
 */
export function outline(payload, edits = emptyEdits()) {
  const titles = { ...SECTION_TITLES, ...(payload.sections ?? {}) };
  const sections = [];
  if (typeof payload.summary === "string" && payload.summary.trim()) {
    sections.push({ key: "summary", title: titles.summary, list: null, items: [{ id: "summary", label: edits.text.summary ?? payload.summary, original: payload.summary }] });
  }
  for (const [key, spec] of Object.entries(LISTS)) {
    const entries = Array.isArray(payload[key]) ? payload[key] : [];
    if (!entries.length) continue;
    const items = orderOf(edits, key, entries.length).map((i) => {
      const id = `${key}.${i}`;
      const entry = entries[i];
      /** @type {OutlineItem} */
      const item = typeof entry === "string"
        ? { id, label: edits.text[id] ?? entry, original: entry }
        : { id, label: String(spec.label(entry) ?? ""), detail: spec.detail?.(entry) || undefined };
      if (spec.children) {
        const kids = childList(entry, spec.children);
        const listPath = `${id}.${spec.children}`;
        item.childList = listPath;
        item.children = orderOf(edits, listPath, kids.length).map((k) => {
          const kidId = `${listPath}.${k}`;
          return { id: kidId, label: edits.text[kidId] ?? kids[k], original: kids[k] };
        });
      }
      return item;
    });
    sections.push({ key, title: titles[key], list: key, items });
  }
  return sections;
}

/**
 * The payload build-cv-html.mjs renders for these edits. Pure. The generated
 * payload is never mutated.
 * @param {CvPayload} payload
 * @param {StudioEdits} edits
 * @returns {CvPayload}
 */
export function applyEdits(payload, edits) {
  const hidden = new Set(edits.hidden);
  const out = structuredClone(payload);
  if (hidden.has("summary")) delete out.summary;
  else if (edits.text.summary !== undefined && out.summary !== undefined) out.summary = edits.text.summary;
  if (edits.format) out.page_format = edits.format;
  for (const [key, spec] of Object.entries(LISTS)) {
    const entries = Array.isArray(payload[key]) ? payload[key] : null;
    if (!entries) continue;
    out[key] = orderOf(edits, key, entries.length)
      .filter((i) => !hidden.has(`${key}.${i}`))
      .map((i) => {
        const id = `${key}.${i}`;
        const entry = structuredClone(entries[i]);
        if (typeof entry === "string") return edits.text[id] ?? entry;
        if (!spec.children) return entry;
        const kids = childList(entries[i], spec.children);
        if (!kids.length) return entry;
        const listPath = `${id}.${spec.children}`;
        const kept = orderOf(edits, listPath, kids.length)
          .filter((k) => !hidden.has(`${listPath}.${k}`))
          .map((k) => edits.text[`${listPath}.${k}`] ?? kids[k]);
        entry[spec.children] = kept;
        return entry;
      })
      .filter((entry) => spec.children !== "items" || entry.items.length > 0);
  }
  return out;
}

/** Toggle one item in or out of the CV. */
export function toggleHidden(edits, id) {
  const hidden = edits.hidden.includes(id) ? edits.hidden.filter((h) => h !== id) : [...edits.hidden, id];
  return { ...edits, hidden };
}

/**
 * Move the item at visible position `from` to position `to` within one list.
 * @param {StudioEdits} edits
 * @param {string} listPath
 * @param {number} length - Generated length of the list.
 */
export function moveItem(edits, listPath, length, from, to) {
  const next = [...orderOf(edits, listPath, length)];
  if (from < 0 || from >= length || to < 0 || to >= length || from === to) return edits;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return { ...edits, order: { ...edits.order, [listPath]: next } };
}

/** Replace one item's text. Setting it back to the generated text drops the override. */
export function setText(edits, id, value, generated) {
  const text = { ...edits.text };
  if (value === generated) delete text[id];
  else text[id] = value;
  return { ...edits, text };
}

/**
 * Parse edits that crossed a trust boundary (a request body, a file on disk).
 * Drops anything malformed instead of failing the whole set.
 * @param {unknown} raw
 * @returns {StudioEdits}
 */
export function parseEdits(raw) {
  const r = raw && typeof raw === "object" ? /** @type {Record<string, unknown>} */ (raw) : {};
  const hidden = Array.isArray(r.hidden) ? [...new Set(r.hidden.filter((h) => typeof h === "string"))] : [];
  const order = {};
  if (r.order && typeof r.order === "object") {
    for (const [k, v] of Object.entries(r.order)) if (Array.isArray(v) && v.every(Number.isInteger)) order[k] = v;
  }
  const text = {};
  if (r.text && typeof r.text === "object") {
    for (const [k, v] of Object.entries(r.text)) if (typeof v === "string") text[k] = v;
  }
  const format = r.format === "a4" || r.format === "letter" ? r.format : null;
  return { hidden, order, text, format };
}

/** How many changes an edit set makes, for the version list. */
export function changeCount(edits) {
  return edits.hidden.length + Object.keys(edits.order).length + Object.keys(edits.text).length + (edits.format ? 1 : 0);
}
