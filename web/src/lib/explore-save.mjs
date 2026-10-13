/**
 * URLs `addOffersToPipeline` will actually write. The writer drops anything
 * that is not http(s) and reports a failure as `{ added: 0, error }` instead
 * of throwing. A count that does not match the http(s) list is not a list we
 * can mark as saved.
 *
 * @param {{ url?: string }[]} offers
 * @param {{ added?: number, error?: string }} result
 * @returns {string[]}
 */
export function urlsWritten(offers, result) {
  if (typeof result?.error === "string" && result.error) throw new Error(result.error);
  const urls = [];
  for (const offer of offers) {
    if (typeof offer?.url === "string" && /^https?:\/\//i.test(offer.url)) urls.push(offer.url);
  }
  if ((result?.added ?? 0) !== urls.length) return [];
  return urls;
}
