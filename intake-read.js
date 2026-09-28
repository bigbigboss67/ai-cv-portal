/**
 * Any listing format → plain text.
 *
 * Files go through docparse.js — the same PDF, Word and OCR readers the Profile
 * tab uses, already pinned and hardened against hanging OCR loads. Links go
 * through the page readers fetch-address.js already uses. Pasted text passes
 * straight through. Nothing here leaves the browser except a link, which is
 * handed to the page reader.
 */
import { parseDocument } from "./docparse.js";
import { READERS } from "./fetch-address.js";

export const MAX_PDF_PAGES = 10;
export const MAX_EDGE = 2400;

export class ReadError extends Error {
  /** @param {'blocked'|'unreadable'|'offline'|'unsupported'} code */
  constructor(code, message) { super(message); this.code = code; }
}

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };
export const isLinkedInHost = (u) => { const h = hostOf(u); return h === "linkedin.com" || h.endsWith(".linkedin.com"); };
export const isShortLink = (u) => hostOf(u) === "lnkd.in";

/** The destination printed on a short-link interstitial page. */
export function redirectTarget(text) {
  const urls = (String(text || "").match(/https?:\/\/[^\s<>"')\]]+/g) || []).map((u) => u.replace(/[.,;:]+$/, ""));
  return urls.find((u) => {
    const h = hostOf(u);
    return h && !/(^|\.)(lnkd\.in|linkedin\.com|licdn\.com|r\.jina\.ai|allorigins\.win)$/.test(h);
  }) || "";
}

/** A login wall or bot check instead of the listing. */
export const looksBlocked = (text) =>
  String(text || "").length < 4000 && /\b(?:sign in|log in to (?:see|view)|join now to see|authwall|enable javascript|access denied|captcha)\b/i.test(String(text));

/** docparse joins PDF pages with a blank line; keep the first `max`. */
export function truncatePages(text, pages, max = MAX_PDF_PAGES) {
  if (!pages || pages <= max) return { text, truncated: false };
  return { text: String(text).split("\n\n").slice(0, max).join("\n\n"), truncated: true };
}

async function viaReaders(url, step) {
  let last = "";
  for (const r of READERS) {
    step(`reading ${hostOf(url)} via ${r.name}`);
    try {
      const res = await fetch(r.build(url), { redirect: "follow" });
      if (!res.ok) { last = `${r.name} returned ${res.status}`; continue; }
      const t = await res.text();
      if (t && t.trim().length >= 40) return t;
      last = `${r.name} returned an empty page`;
    } catch (err) {
      last = `${r.name}: ${(err && err.message) || err}`;
    }
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new ReadError("offline", "You are offline. Reading a link needs a connection.");
  }
  throw new ReadError("blocked", `That page could not be read (${last}). Take a screenshot of it, or copy the text and paste it here.`);
}

const LINKEDIN_MSG = "LinkedIn does not let other sites read its pages. Take a screenshot of the post, or copy its text and paste it here.";

async function readUrl(raw, step) {
  let u;
  try { u = new URL(raw); } catch { throw new ReadError("unreadable", "That is not a valid link."); }
  if (!/^https?:$/.test(u.protocol)) throw new ReadError("unreadable", "Only http and https links can be read.");
  if (isLinkedInHost(u.href)) throw new ReadError("blocked", LINKEDIN_MSG);
  let url = u.href;
  let text = await viaReaders(url, step);
  if (isShortLink(url)) {
    const target = redirectTarget(text);
    if (!target) throw new ReadError("blocked", "The short link did not lead to a readable page. Open it, then paste the page's address or its text here.");
    if (isLinkedInHost(target)) throw new ReadError("blocked", LINKEDIN_MSG);
    step(`following the link to ${hostOf(target)}`);
    url = target;
    text = await viaReaders(url, step);
  }
  if (looksBlocked(text)) throw new ReadError("blocked", "That page needs a login before it shows the listing. Take a screenshot or paste the text instead.");
  return { text, source: { kind: "url", url }, confidence: null, warnings: [] };
}

/** Large photos are shrunk before OCR; a phone screenshot is left as it is. */
export async function downscale(file, max = MAX_EDGE) {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return file;
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { return file; }
  const edge = Math.max(bmp.width, bmp.height);
  if (edge <= max) { if (bmp.close) bmp.close(); return file; }
  const scale = max / edge;
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  if (bmp.close) bmp.close();
  const blob = await new Promise((res) => c.toBlob(res, "image/png"));
  return blob ? new File([blob], file.name.replace(/\.[^.]+$/, "") + ".png", { type: "image/png" }) : file;
}

/** docparse's result for a file → the reader's result. Pure, so Node tests cover it. */
export function fromParsed(r, { name, isImage }) {
  const warnings = [];
  // Only a text-layer PDF has one blank-line-separated chunk per page. docparse's
  // scanned-PDF path already stops after 3 pages and says so in its own note.
  const cut = truncatePages(r.text || "", r.kind === "pdf" ? r.pages : 0);
  if (cut.truncated) warnings.push(`Only the first ${MAX_PDF_PAGES} of ${r.pages} pages were read.`);
  if (r.note) warnings.push(r.note);
  const kind = isImage ? "image" : /pdf/.test(r.kind) ? "pdf" : r.kind === "word" ? "docx" : "text";
  return {
    text: cut.text,
    source: { kind, name, pages: r.pages, truncated: cut.truncated },
    // OCR that reports no confidence is unknown, not 0% — docparse's scanned-PDF path reports none.
    confidence: r.ocr && Number.isFinite(r.confidence) ? Math.max(0, Math.min(1, r.confidence / 100)) : null,
    warnings,
  };
}

async function readFile(file, step) {
  const ext = (String(file.name).match(/\.([a-z0-9]+)$/i) || ["", ""])[1].toLowerCase();
  const type = String(file.type || "");
  const isImage = /^(png|jpe?g|gif|webp|bmp|tiff?)$/.test(ext) || type.startsWith("image/");
  if (!isImage && !/^(pdf|docx|txt|md)$/.test(ext) && type !== "application/pdf" && !type.startsWith("text/")) {
    throw new ReadError("unsupported", "Listings can be read from a screenshot or photo, a PDF, a Word (.docx) file or a text file.");
  }
  const src = isImage ? await downscale(file) : file;
  const r = await parseDocument(src, step);
  if (r.error) {
    const offline = /did not finish|could not load|failed to fetch|network/i.test(r.error);
    throw new ReadError(offline ? "offline" : "unreadable", offline ? `Reading images and PDFs needs a connection once. ${r.error}` : r.error);
  }
  return fromParsed(r, { name: file.name, isImage });
}

/**
 * @param {File | {url: string} | {text: string}} input
 * @param {{onStep?: (msg: string) => void}} [opt]
 * @returns {Promise<{text: string, source: object, confidence: number|null, warnings: string[]}>}
 */
export async function readListing(input, { onStep } = {}) {
  const step = (m) => { if (onStep) onStep(m); };
  if (input && typeof input.text === "string") {
    const text = input.text.trim();
    if (!text) throw new ReadError("unreadable", "The text box is empty.");
    return { text, source: { kind: "text" }, confidence: null, warnings: [] };
  }
  if (input && typeof input.url === "string") return readUrl(input.url.trim(), step);
  if (typeof File !== "undefined" && input instanceof File) return readFile(input, step);
  throw new ReadError("unsupported", "Nothing to read — drop a file, paste a link or paste the text.");
}
