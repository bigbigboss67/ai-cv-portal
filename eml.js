/**
 * Build a real .eml email file in the browser.
 *
 * `mailto:` can only carry plain text — that is the spec, not a browser limit — so
 * a designed cover letter can never be pre-filled into the body that way.
 *
 * A .eml file is a complete RFC 5322 message. It can hold an HTML body and
 * attachments, and Windows opens it in Outlook. With the X-Unsent header it opens
 * as an editable draft rather than a received message, so the flow becomes:
 * double-click, read it, press Send.
 */

/** Base64 for arbitrary bytes, chunked so a large PDF cannot blow the call stack. */
function b64(bytes) {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** MIME requires base64 wrapped at 76 characters. Outlook is strict about this. */
const wrap76 = (s) => (s.match(/.{1,76}/g) || []).join("\r\n");

/** A header value can never carry a line break into the next header. */
const oneLine = (v) => String(v || "").replace(/[\r\n]+/g, " ").trim();

/** Non-ASCII in a header must be encoded — otherwise Outlook shows mojibake. */
function encodeHeader(text) {
  if (/^[\x20-\x7E]*$/.test(text)) return text;
  const bytes = new TextEncoder().encode(text);
  return "=?UTF-8?B?" + b64(bytes) + "?=";
}

/**
 * @param {object} m
 * @param {string} m.to
 * @param {string} m.subject
 * @param {string} m.html      the designed letter — goes in the body
 * @param {Array<{name:string, bytes:Uint8Array, type?:string}>} [m.attachments]
 * @param {string} [m.receiptTo]  ask for a read receipt, sent to this address
 * @returns {Blob}
 */
export function buildEml({ to, subject, html, attachments = [], receiptTo = "" }) {
  const boundary = "----design_cv_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const CRLF = "\r\n";
  const L = [];

  L.push("To: " + oneLine(to));
  L.push("Subject: " + encodeHeader(oneLine(subject)));
  /* Asking whether the mail was opened. The reader's own mail program puts the question to
     them, and plenty say no — so a receipt coming back means something and none coming back
     means nothing at all. */
  const receipt = oneLine(receiptTo);
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(receipt)) L.push("Disposition-Notification-To: " + receipt);
  // Outlook-specific: open as a draft the user can edit and send, not as received mail.
  L.push("X-Unsent: 1");
  L.push("MIME-Version: 1.0");
  L.push('Content-Type: multipart/mixed; boundary="' + boundary + '"');
  L.push("");

  // ── body ──
  L.push("--" + boundary);
  L.push('Content-Type: text/html; charset="utf-8"');
  L.push("Content-Transfer-Encoding: base64");
  L.push("");
  L.push(wrap76(b64(new TextEncoder().encode(html))));
  L.push("");

  // ── attachments ──
  for (const a of attachments) {
    L.push("--" + boundary);
    L.push('Content-Type: ' + (a.type || "application/pdf") + '; name="' + a.name + '"');
    L.push('Content-Disposition: attachment; filename="' + a.name + '"');
    L.push("Content-Transfer-Encoding: base64");
    L.push("");
    L.push(wrap76(b64(a.bytes)));
    L.push("");
  }

  L.push("--" + boundary + "--");
  L.push("");

  return new Blob([L.join(CRLF)], { type: "message/rfc822" });
}

/** Hand the file to the browser's downloader. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke late: some browsers abort the download if the URL dies too early.
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/**
 * Wrap the letter fragment in a full HTML document. Without an explicit charset
 * and a white ground, Outlook renders it against the user's theme and mangles
 * the accented characters.
 */
export function letterDocument(innerHtml) {
  return '<!doctype html><html><head><meta charset="utf-8"></head>' +
    '<body style="margin:0;padding:0;background:#ffffff">' + innerHtml + "</body></html>";
}
