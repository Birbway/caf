/**
 * linkedin-url.mjs — read a LinkedIn job-posting URL.
 *
 * The `linkedin` rung of liveness-api.mjs kept this parser inside its
 * ATS_PROVIDERS entry, where nothing else could import it, so a second consumer
 * had to copy the regexes by hand. It lives here so there is one body to import
 * and to test parity against.
 *
 * No imports and no Node-only APIs (only the global `URL`), so a browser bundle
 * can load it as well as the CLI.
 */

/**
 * The numeric LinkedIn job id carried by this URL, or null when it is not one
 * posting. Matched as digits only, so nothing user-supplied is ever spliced
 * into a hostname.
 *
 * Three recognized shapes:
 *   linkedin.com/jobs/view/{id}
 *   linkedin.com/jobs/view/{title-slug}-{id}
 *   any page carrying the posting in ?currentJobId= (search and collection views)
 *
 * The host test is anchored at a label boundary, so regional subdomains
 * (uk.linkedin.com) match and "linkedin.com.evil.example" never does.
 * `u.hostname` is already lowercased by the URL parser. The protocol is not
 * checked here: callers decide that (resolveAtsApi refuses anything but https).
 *
 * @param {URL} u
 * @returns {string|null}
 */
export function linkedInJobId(u) {
  if (!/(^|\.)linkedin\.com$/.test(u.hostname)) return null;
  const path = u.pathname.match(/^\/jobs\/view\/(?:.*-)?(\d+)\/?$/);
  if (path) return path[1];
  const current = u.searchParams.get('currentJobId');
  return current && /^\d+$/.test(current) ? current : null;
}

/**
 * The public guest endpoint for a posting id: the rendered posting as HTML, with
 * no auth and no browser. Pass only an id returned by `linkedInJobId`, so the
 * host stays a fixed literal and nothing user-supplied reaches it.
 *
 * @param {string} id
 * @returns {string}
 */
export function linkedInGuestUrl(id) {
  return `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`;
}
