/**
 * JD keyword coverage for the CV the user is editing, from the core's
 * keyword-match.mjs. The result has the /api/keyword-match shape, so the
 * report page's coverage panel renders it unchanged.
 *
 * `dropped` names keywords the generated CV carried that the user's edits
 * removed. It is the one thing a hide or a rewrite can cost without the user
 * seeing it in the preview.
 */

/** @typedef {{ extractKeywords: (report: string) => string[], analyzeCoverage: (k: string[], text: string) => any, htmlToText: (html: string) => string }} KeywordMatch */

/**
 * @param {KeywordMatch} km
 * @param {string | null} reportText
 * @param {string} html - The edited CV.
 * @param {string} generatedHtml - The CV as the pdf mode generated it.
 */
export function studioCoverage(km, reportText, html, generatedHtml) {
  if (reportText === null) return { available: false, reason: "no-report", result: null, dropped: [] };
  const keywords = km.extractKeywords(reportText);
  if (!keywords.length) return { available: false, reason: "no-keywords", result: null, dropped: [] };
  const result = km.analyzeCoverage(keywords, km.htmlToText(html));
  const generated = km.analyzeCoverage(keywords, km.htmlToText(generatedHtml));
  const missing = new Set(result.missing);
  return { available: true, reason: null, result, dropped: generated.present.filter((k) => missing.has(k)) };
}
