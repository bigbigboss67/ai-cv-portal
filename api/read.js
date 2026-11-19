/**
 * GET /api/read?url=<public page>
 *
 * Same-origin page reader for the browser modules (fetch-address.js, intake-read.js).
 * It replaces the public CORS proxies (r.jina.ai, api.allorigins.win) the page used
 * to call directly, so posting and company URLs are no longer handed to third parties
 * from the user's browser.
 *
 * Every hop is checked: the URL and each redirect target must resolve to a public
 * address (no loopback, private ranges or cloud metadata). Output is capped.
 */
const sec = require("./_security.js");
const { UA } = require("./_boards.js");

const MAX_BYTES = 1500000; // ~1.5 MB of page text is far more than any posting needs
const MAX_HOPS = 4;

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
  if (!sec.isAllowedOrigin(req)) return res.status(403).json({ ok: false, error: "Forbidden origin" });
  // The page's background address scan reads several pages per job on load (~80
  // requests seen in testing), so this limit is higher than the other endpoints'.
  if (!sec.checkRateLimit(`read:${sec.getClientIp(req)}`, 150, 60000)) {
    return res.status(429).json({ ok: false, error: "Rate limit exceeded. Please wait a minute." });
  }

  let target = String((req.query && req.query.url) || "").trim();
  try {
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      if (!(await sec.isSafePublicUrl(target))) {
        return res.status(400).json({ ok: false, error: "Blocked unsafe or private network URL." });
      }
      const r = await fetch(target, {
        headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,text/plain;q=0.9" },
        redirect: "manual",
        signal: AbortSignal.timeout(10000),
      });
      if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
        target = new URL(r.headers.get("location"), target).href;
        continue;
      }
      if (!r.ok) return res.status(502).json({ ok: false, error: `Upstream returned ${r.status}` });
      const text = (await r.text()).slice(0, MAX_BYTES);
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.status(200).send(text);
    }
    return res.status(508).json({ ok: false, error: "Too many redirects" });
  } catch (err) {
    return res.status(502).json({ ok: false, error: String((err && err.message) || err) });
  }
};
