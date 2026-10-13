// Which tracker rows a liveness sweep should check, and at which posting URL.
// Pure: the caller passes the tracker text and a report reader, so tests need
// no files and check-liveness.mjs owns all I/O.
import { resolveColumns, parseTrackerRow, extractTrackerReportNumbers } from '../tracker-parse.mjs';

export const DEFAULT_TRACKER_STATUSES = ['evaluated', 'applied'];

const REPORT_URL_RE = /\*\*URL:\*\*[ \t]*(\S+)/;

export function reportPostingUrl(reportText) {
  const m = String(reportText ?? '').match(REPORT_URL_RE);
  if (!m) return '';
  const url = m[1].replace(/[),.;]+$/, '').replace(/^<|>$/g, '');
  return /^https?:\/\//i.test(url) ? url : '';
}

/**
 * @param {string} trackerText applications.md contents
 * @param {{statuses?: string[], readReport?: (num: number) => string|null}} options
 * @returns {{targets: {num: number, company: string, role: string, status: string, url: string}[], noUrl: number[]}}
 */
export function trackerLivenessTargets(trackerText, { statuses = DEFAULT_TRACKER_STATUSES, readReport = () => null } = {}) {
  const wanted = new Set(statuses.map((s) => s.trim().toLowerCase()).filter(Boolean));
  const lines = String(trackerText ?? '').split(/\r?\n/);
  const colmap = resolveColumns(lines);
  const targets = [];
  const noUrl = [];
  const seen = new Set();
  for (const line of lines) {
    const row = parseTrackerRow(line, colmap);
    if (!row || !wanted.has(row.status.trim().toLowerCase())) continue;
    let url = /^https?:\/\//i.test(row.url) ? row.url : '';
    if (!url) {
      for (const n of extractTrackerReportNumbers(row.report, row.notes)) {
        url = reportPostingUrl(readReport(n));
        if (url) break;
      }
    }
    if (!url) { noUrl.push(row.num); continue; }
    if (seen.has(url)) continue;
    seen.add(url);
    targets.push({ num: row.num, company: row.company, role: row.role, status: row.status, url });
  }
  return { targets, noUrl };
}
