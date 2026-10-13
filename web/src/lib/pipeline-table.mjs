/**
 * pipeline-table.mjs — line parsing of `data/pipeline.md` for the web read path.
 *
 * Split out of career-ops.ts for the same reason tracker-table.mjs exists: the
 * web reader of a user data file is exactly the kind of code that needs a
 * regression test running the REAL parser, and `node --test` (see
 * web/package.json) can only import plain .mjs — career-ops.ts pulls in `@/`
 * path aliases and Next-only modules.
 *
 * Everything here is pure: text in, rows out. No fs, no Next.
 */

/**
 * Split a career-ops data file into lines, tolerating CRLF.
 *
 * `data/` is gitignored (see .gitignore), so the repo-wide `eol=lf` policy in
 * .gitattributes does NOT reach the user's own pipeline.md / scan-history.tsv:
 * an editor, a sync client or any non-LF writer on Windows can leave CRLF
 * there. A plain `split("\n")` then leaves a trailing "\r" on every line, which
 * silently defeats any `$`-anchored row regex (JS `.` never matches \r) — the
 * file parses to zero rows and the UI just looks empty. Split on the line
 * break, not on "\n".
 *
 * @param {string} text
 * @returns {string[]}
 */
export function splitLines(text) {
  return text.split(/\r?\n/);
}

const LABELED_SEGMENT = /^(posted|trust|note|rank):\s(.*)$/i;

/** @param {string} md - content of data/pipeline.md.
 *  @returns {{url: string, company: string, role: string, location?: string, compensation?: string, done: boolean, postedAt?: string}[]}
 */
export function parseInbox(md) {
  const jobs = [];
  for (const line of splitLines(md)) {
    const m = line.match(/^\s*-\s*\[([ xX])\]\s*(.+)$/);
    if (!m) continue;
    const all = m[2].split("|").map((s) => s.trim());
    const labels = new Map();
    const parts = [];
    for (const [i, seg] of all.entries()) {
      // the URL cell can contain a colon-y value but is always position 0
      const lm = i >= 3 ? seg.match(LABELED_SEGMENT) : null;
      if (lm) labels.set(lm[1].toLowerCase(), lm[2].trim());
      else parts.push(seg);
    }
    if (parts.length < 3 || !parts[0]) continue; // need at least url | company | role
    const posted = labels.get("posted");
    jobs.push({
      done: m[1].toLowerCase() === "x",
      url: parts[0],
      company: parts[1],
      role: parts[2],
      location: parts[3] || undefined, // optional 4th column (#1015)
      compensation: parts[4] || undefined, // optional 5th column (#1017); 6th+ ignored
      // the row's own posting date (scan.mjs `posted:` label) — a more direct
      // freshness signal than the scan-history join, which stays as fallback
      postedAt: posted && /^\d{4}-\d{2}-\d{2}$/.test(posted) ? posted : undefined,
    });
  }
  return jobs;
}
