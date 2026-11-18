/**
 * POST /api/send
 *
 * Sends an application email directly with the generated ATS CV PDF attached
 * using Resend (process.env.RESEND_API_KEY).
 *
 * Security:
 *  - Requires a valid Clerk Bearer JWT (verified via JWKS)
 *  - Enforces allowed origin & per-user rate limit (10 sends/min)
 *  - Derives Reply-To from the authenticated user or explicit validated replyTo (no hardcoded personal email)
 */
const sec = require("./_security.js");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  if (!sec.isAllowedOrigin(req)) {
    return res.status(403).json({ ok: false, error: "Forbidden origin" });
  }

  const user = await sec.verifyClerkBearer(req);
  if (!user || !user.sub) {
    return res.status(401).json({
      ok: false,
      error: "Authentication required. Please sign in to send applications directly.",
    });
  }

  const rlKey = `send:${user.sub}:${sec.getClientIp(req)}`;
  if (!sec.checkRateLimit(rlKey, 10, 60000)) {
    return res.status(429).json({ ok: false, error: "Rate limit exceeded. Please wait a minute." });
  }

  const apiKey = (process.env.RESEND_API_KEY || "").trim();
  if (!apiKey) {
    return res.status(501).json({
      ok: false,
      unconfigured: true,
      error: "RESEND_API_KEY is not set in Vercel environment variables.",
    });
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ ok: false, error: "Invalid JSON body" });
    }
  }

  const { to, replyTo, subject, html, text, pdfBase64, pdfFilename } = body || {};
  const cleanTo = String(to || "").trim();
  const cleanReplyTo = String(replyTo || user.email || "").trim();

  if (!EMAIL_RE.test(cleanTo) || !subject || (!html && !text)) {
    return res.status(400).json({
      ok: false,
      error: "Missing or invalid required fields: to, subject, html/text",
    });
  }

  const fromAddress = (process.env.RESEND_FROM || "").trim() || "Executive Career Portal <onboarding@resend.dev>";
  const payload = {
    from: fromAddress,
    to: [cleanTo],
    subject: String(subject).trim().slice(0, 300),
    html: html ? String(html) : undefined,
    text: text ? String(text) : undefined,
  };
  if (EMAIL_RE.test(cleanReplyTo)) {
    payload.reply_to = cleanReplyTo;
  }

  if (pdfBase64 && pdfFilename) {
    payload.attachments = [
      {
        filename: String(pdfFilename).replace(/[\\/:*?"<>|]+/g, "-"),
        content: String(pdfBase64),
      },
    ];
  }

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(r.status).json({
        ok: false,
        error: data.message || data.error || `Resend HTTP ${r.status}`,
      });
    }
    return res.status(200).json({ ok: true, id: data.id || null });
  } catch (err) {
    return res.status(502).json({ ok: false, error: err.message || "Email relay failed" });
  }
};
