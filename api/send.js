/**
 * POST /api/send
 *
 * Sends an application email directly with the generated ATS CV PDF attached
 * using Resend (process.env.RESEND_API_KEY). Sets Reply-To to the candidate's
 * email (rassemkadiri@live.de) so all company replies arrive in their inbox.
 *
 * If RESEND_API_KEY is not configured, returns 501 { ok: false, unconfigured: true }
 * so the frontend falls back seamlessly to .eml + .pdf download.
 */
module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
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
  if (!to || !subject || (!html && !text)) {
    return res.status(400).json({ ok: false, error: "Missing required fields: to, subject, html/text" });
  }

  const fromAddress = (process.env.RESEND_FROM || "").trim() || "Executive Career Portal <onboarding@resend.dev>";
  const payload = {
    from: fromAddress,
    to: [String(to).trim()],
    reply_to: String(replyTo || "rassemkadiri@live.de").trim(),
    subject: String(subject).trim(),
    html: html ? String(html) : undefined,
    text: text ? String(text) : undefined,
  };

  if (pdfBase64 && pdfFilename) {
    payload.attachments = [
      {
        filename: String(pdfFilename),
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
