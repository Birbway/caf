const MAX_URL_LEN = 2048;

export function postingUrl(raw) {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s || s.length > MAX_URL_LEN) return null;
  if (/[\0\r\n]/.test(s)) return null;
  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (!u.hostname) return null;
  if (u.username || u.password) return null;
  return s;
}

export function unscoredInboxHref(url, evaluated) {
  if (evaluated) return null;
  return postingUrl(url);
}
