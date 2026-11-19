/**
 * GET /api/read?url=<public page>
 *
 * Same-origin page reader for the browser modules (fetch-address.js, intake-read.js).
 * It replaces the public CORS proxies (r.jina.ai, api.allorigins.win) the page used
 * to call directly, so posting and company URLs are no longer handed to third parties
 * from the user's browser.
 *
 * Not an open proxy: a signed-in Clerk session is required, on top of the own-origin
 * check and a per-user rate limit. Fetching goes through sec.safeFetchText: http(s)
 * only, every redirect re-validated, DNS pinned to the address that passed the
 * private-range check (no rebinding window), body streamed and capped.
 */
const sec = require("./_security.js");
const { UA } = require("./_boards.js");

const MAX_BYTES = 1500000; // ~1.5 MB of page text is far more than any posting needs

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
  if (!sec.isAllowedOrigin(req)) return res.status(403).json({ ok: false, error: "Forbidden origin" });

  const user = await sec.verifyClerkBearer(req);
  if (!user || !user.sub) return res.status(401).json({ ok: false, error: "Sign in to read external pages." });

  // The page's background address scan reads several pages per job on load (~80
  // requests seen in testing), so this limit is higher than the other endpoints'.
  if (!sec.checkRateLimit(`read:${user.sub}`, 150, 60000)) {
    return res.status(429).json({ ok: false, error: "Rate limit exceeded. Please wait a minute." });
  }

  try {
    const r = await sec.safeFetchText(String((req.query && req.query.url) || ""), {
      maxBytes: MAX_BYTES,
      timeoutMs: 10000,
      userAgent: UA,
      accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
    });
    if (r.status < 200 || r.status >= 300) {
      return res.status(502).json({ ok: false, error: `Upstream returned ${r.status}` });
    }
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.status(200).send(r.body);
  } catch (err) {
    if (err && err.code === "EBLOCKED") return res.status(400).json({ ok: false, error: "Blocked unsafe or private network URL." });
    if (err && err.code === "EHOPS") return res.status(508).json({ ok: false, error: "Too many redirects" });
    return res.status(502).json({ ok: false, error: String((err && err.message) || err) });
  }
};
