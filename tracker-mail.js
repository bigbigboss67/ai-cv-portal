/**
 * Replies to applications: read a mail, find the application it answers, say what it
 * means, and move that application on.
 *
 * Pure functions over plain data. The portal hands in its application records and gets
 * new ones back, so the Node tests cover every rule. Mail arrives as a dropped .eml or
 * .txt, or as pasted text — nothing here touches the network.
 */

export const STAGE_TEXT = {
  none: "Not started", draft: "Draft ready", prepared: "Prepared — not sent", applied: "Applied",
  ack: "Acknowledged", info: "Info requested", interview: "Interview", offer: "Offer",
  rejected: "Rejected", silent: "No response", bounced: "Address bounced", withdrawn: "Withdrawn",
};

export const CLS_LABEL = {
  bounce: "Bounced", auto_reply: "Auto-reply", read: "Opened", ack: "Received", info: "Info request",
  interview: "Interview", rejection: "Rejection", offer: "Offer", other: "Reply", sent: "Sent copy",
};

const fnv = (s) => {
  let h = 0x811c9dc5;
  for (const c of String(s)) h = Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0;
  return h.toString(36);
};

/* ---------- reading a mail ---------- */

/** Bytes as a string of char codes 0-255, so each MIME part can be decoded in its own charset. */
function binary(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return s;
}

/** Bytes (as char codes) to text in the given charset. Plain ASCII, or text already decoded, passes through. */
function decodeText(s, charset) {
  s = String(s || "");
  if (!/[\x80-\xff]/.test(s) || /[^\x00-\xff]/.test(s)) return s;
  const bytes = Uint8Array.from(s, (c) => c.charCodeAt(0));
  try {
    return new TextDecoder(String(charset || "utf-8").trim().toLowerCase()).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

const qp = (s) => String(s).replace(/=\r?\n/g, "").replace(/=([0-9a-f]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16)));

function b64(s) {
  try {
    return atob(String(s).replace(/[^A-Za-z0-9+/=]/g, ""));
  } catch {
    return "";
  }
}

/** RFC 2047 encoded words ("=?UTF-8?B?...?=") in a header value. */
function decodeWords(v) {
  return String(v || "")
    .replace(/(=\?[^?\s]+\?[bq]\?[^?\s]*\?=)\s+(?==\?)/gi, "$1")
    .replace(/=\?([^?\s]+)\?([bq])\?([^?\s]*)\?=/gi, (m, cs, enc, txt) =>
      decodeText(enc.toLowerCase() === "b" ? b64(txt) : qp(txt.replace(/_/g, " ")), cs.replace(/\*.*$/, "")));
}

function splitEntity(s) {
  if (/^\r?\n/.test(s)) return { headers: {}, body: s.replace(/^\r?\n/, "") };
  const m = /\r?\n\r?\n/.exec(s);
  const head = m ? s.slice(0, m.index) : s;
  const headers = {};
  for (const line of head.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) {
      const k = line.slice(0, i).trim().toLowerCase();
      if (!(k in headers)) headers[k] = line.slice(i + 1).trim();
    }
  }
  return { headers, body: m ? s.slice(m.index + m[0].length) : "" };
}

function ctype(v) {
  const s = String(v || "text/plain");
  const params = {};
  s.replace(/;\s*([\w*-]+)\s*=\s*(?:"([^"]*)"|([^;\s]*))/g, (m, k, q, bare) => {
    params[k.toLowerCase()] = q !== undefined ? q : bare;
    return m;
  });
  return { type: s.split(";")[0].trim().toLowerCase(), params };
}

/** Every readable text part, depth first. Attachments and forwarded messages are skipped. */
function collect(entity, out, depth) {
  const { headers, body } = entity;
  const ct = ctype(headers["content-type"]);
  if (ct.type.startsWith("multipart/")) {
    if (!ct.params.boundary || depth > 8) return out;
    for (const p of body.split("--" + ct.params.boundary).slice(1)) {
      if (/^--/.test(p)) break;
      collect(splitEntity(p.replace(/^[ \t]*\r?\n/, "")), out, depth + 1);
    }
    return out;
  }
  if (/^attachment/i.test(headers["content-disposition"] || "")) return out;
  // The recipient's mail program confirming the message was displayed.
  if (ct.type === "message/disposition-notification") { out.receipt = true; return out; }
  if (!/^(text\/plain|text\/html|message\/delivery-status)$/.test(ct.type)) return out;
  const cte = String(headers["content-transfer-encoding"] || "").trim().toLowerCase();
  const raw = cte === "base64" ? b64(body) : cte === "quoted-printable" ? qp(body) : body;
  const text = decodeText(raw, ct.params.charset);
  // Only a report that says the delivery failed is a bounce — not "delayed", not a read receipt.
  if (ct.type === "message/delivery-status" && (/^\s*action:\s*failed/im.test(text) || /^\s*status:\s*5\./im.test(text))) out.failed = true;
  (ct.type === "text/html" ? out.html : out.plain).push(text);
  return out;
}

function htmlText(h) {
  return String(h)
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d))
    .replace(/&#x([0-9a-f]+);/gi, (m, x) => String.fromCodePoint(parseInt(x, 16)))
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

const EMAIL = /[\w.+'-]+@[\w-]+(?:\.[\w-]+)+/;

function address(v) {
  const s = String(v || "");
  const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]*)>/);
  if (m) return { name: m[1].trim(), address: m[2].trim().toLowerCase() };
  const a = (s.match(EMAIL) || [""])[0].toLowerCase();
  return { name: a ? "" : s.trim(), address: a };
}

const addresses = (v) => (String(v || "").match(new RegExp(EMAIL.source, "g")) || []).map((a) => a.toLowerCase());
const messageIds = (v) => (String(v || "").match(/<[^<>\s]+>/g) || []).map((x) => x.toLowerCase());

function isoDate(v) {
  const t = Date.parse(String(v || "").replace(/\s*\([^)]*\)\s*$/, "").trim());
  return Number.isFinite(t) ? new Date(t).toISOString() : "";
}

/**
 * A raw RFC 5322 message (the bytes of a dropped .eml, or its text) as the fields the
 * matcher and classifier read. The text is the plain part when there is one, else the
 * HTML part as text. `isReport` is a delivery report that says the delivery failed.
 */
export function parseEml(raw) {
  let s = raw instanceof ArrayBuffer ? binary(new Uint8Array(raw))
    : ArrayBuffer.isView(raw) ? binary(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength))
    : String(raw || "");
  if (s.charCodeAt(0) === 0xef && s.charCodeAt(1) === 0xbb && s.charCodeAt(2) === 0xbf) s = s.slice(3);   // UTF-8 BOM
  const top = splitEntity(s);
  const h = top.headers;
  const hv = (k) => decodeWords(decodeText(h[k] || "", "utf-8")).replace(/\s+/g, " ").trim();
  const out = collect(top, { plain: [], html: [], failed: false, receipt: false }, 0);
  const text = (out.plain.length ? out.plain.join("\n") : htmlText(out.html.join("\n"))).replace(/\r\n?/g, "\n").trim();
  return {
    msgId: messageIds(h["message-id"])[0] || "",
    inReplyTo: messageIds(h["in-reply-to"]),
    references: messageIds(h["references"]),
    from: address(hv("from")),
    to: addresses(hv("to") + " " + hv("cc")),
    date: isoDate(h["date"]),
    subject: hv("subject"),
    text,
    autoSubmitted: /auto-(replied|generated|notified)/i.test(h["auto-submitted"] || "")
      || !!(h["x-autoreply"] || h["x-autorespond"]) || /auto_reply/i.test(h["precedence"] || ""),
    isReport: out.failed,
    isReceipt: out.receipt,
  };
}

const PASTE_HEAD = /^[ \t]*(from|von|de|sent|gesendet|date|datum|envoyé|to|an|à|cc|subject|betreff|objet)[ \t]*:[ \t]*(.*)$/i;
const PASTE_KEY = { from: "from", von: "from", de: "from", sent: "date", gesendet: "date", date: "date", datum: "date",
  "envoyé": "date", to: "to", an: "to", "à": "to", cc: "to", subject: "subject", betreff: "subject", objet: "subject" };

/**
 * Pasted mail, or an Outlook "Text Only" save: the From / Sent / To / Subject lines at the
 * top (English, German or French), then the body. Without them it is all body.
 */
export function parsePasted(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const h = {};
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  for (; i < lines.length; i++) {
    const m = lines[i].match(PASTE_HEAD);
    if (!m) break;
    const k = PASTE_KEY[m[1].toLowerCase()];
    if (!(k in h)) h[k] = m[2].trim();
    else if (k === "to") h.to += " " + m[2];
  }
  return {
    msgId: "", inReplyTo: [], references: [], from: address(h.from || ""), to: addresses(h.to), date: isoDate(h.date),
    subject: String(h.subject || "").trim(), text: lines.slice(i).join("\n").trim(),
    autoSubmitted: false, isReport: false,
  };
}

/* Where the quoted original starts: a client's "On ... wrote:" line, an Outlook header
   block or divider. Everything from there on is the candidate's own mail coming back. */
const QUOTE_START = [
  /^[ \t]*On\b[^\n]{0,300}(?:\n[^\n]{0,200})?\bwrote:[ \t]*$/im,
  /^[ \t]*Am\b[^\n]{0,300}(?:\n[^\n]{0,200})?\bschrieb[^\n]{0,200}:[ \t]*$/im,
  /^[ \t]*Le\b[^\n]{0,300}(?:\n[^\n]{0,200})?\ba écrit[ \t]*:[ \t]*$/im,
  /^[ \t]*-{2,}[ \t]*(?:Original Message|Ursprüngliche Nachricht|Message d'origine)[ \t]*-{2,}/im,
  /^[ \t]*_{10,}[ \t]*$/m,
  /^[ \t]*(?:From|Von|De):[ \t].*\n[ \t]*(?:Sent|Gesendet|Date|Datum|Envoyé)[ \t]*:/im,
];

/** The reply without the quoted original and without ">" lines. */
export function stripQuoted(text) {
  const s = String(text || "").replace(/\r\n?/g, "\n");
  let cut = s.length;
  for (const rx of QUOTE_START) {
    const m = rx.exec(s);
    if (m && m.index < cut) cut = m.index;
  }
  return s.slice(0, cut).split("\n").filter((l) => !/^[ \t]*>/.test(l)).join("\n").trim();
}

/* ---------- what a reply means ---------- */

const RX = {
  bounce: /undeliverable|undelivered|delivery status notification|delivery has failed|delivery failed|returned mail|mail delivery (?:failed|subsystem)|could not be delivered|address not found|unzustellbar|nicht zugestellt|non remis|échec de (?:la )?remise/i,
  delay: /\bdelay(?:ed)?\b|\bverzögert\b|\bretardée?\b|\bnot been delivered yet\b/i,
  receiptSubject: /^\s*(?:read|gelesen|lu|lido|le[ií]do|letto)\s*:/i,
  ooo: /\bout of (?:the )?office\b|\bon (?:annual |sick |parental |maternity |business )?leave\b|\baway from (?:the office|my desk)\b|\blimited access to (?:my )?e-?mail\b|\bi will (?:be )?(?:back|returning)\b|\bback in the office\b|\babwesen(?:d|heit)\b|\bnicht im büro\b|\bim urlaub\b|\babsent du bureau\b/i,
  oooSubject: /^\s*(?:automatic reply|auto(?:matic)?[- ]?reply|out of office|automatische antwort|abwesenheitsnotiz|réponse automatique|abwesend)\b/i,
  offer: /\b(?:pleased|delighted|happy|glad) to offer you (?!(?:an?|the|this|your) (?:interview|place|meeting|call|slot|chance|invitation|opportunity to (?:interview|meet|speak)))|\b(?:pleased|delighted|happy|glad) to extend (?:to you )?(?:an?|the|our) (?:formal |written )?offer\b|\boffer letter\b|\bjob offer\b|\b(?:employment|formal|written) offer\b|\boffer of employment\b|\bvertragsangebot\b|\bfreuen uns,? ihnen (?:die|diese|eine) (?:stelle|position)[^.]{0,40}anzubieten|\bproposition d'embauche\b|عرض عمل|عرض وظيفي/i,
  rejectStrong: /\bregret to inform\b|\b(?:not|won['’]?t|will not) (?:be )?(?:moving|taking) (?:you |your application |your candidacy |this )?(?:forward|further)\b|\bdecided (?:not to (?:proceed|progress|move forward|pursue)|to (?:move forward|proceed|continue|go ahead|pursue) with (?:other|another|a different))\b|\bdecision not to\b|\bnot been (?:successful|selected|shortlisted)\b|\b(?:has|have) been unsuccessful\b|\b(?:was|were) (?:not successful|unsuccessful)\b|\b(?:other|another) candidates?\b[^.]{0,80}\b(?:closely|better|more)\b|\bmore closely match(?:es|ed)?\b|\bwill not be (?:progressing|proceeding|considered|moving)\b|\bnot (?:be )?invit(?:e|ing) you\b|\bnot (?:proceed|progress|move forward) with your (?:application|candidacy)\b|\b(?:unable|not able) to (?:offer you|proceed|move forward|progress|take your application)\b|\bposition has (?:now )?been filled\b|\bno longer (?:available|being considered)\b|\babsag(?:e|en)\b|\bnicht (?:weiter )?berücksichtig|\bander(?:e|en|er) (?:bewerber|kandidat)|\bnicht in die engere (?:wahl|auswahl)\b|\bnicht zu einem (?:vorstellungsgespräch|gespräch|interview)|\bstelle (?:ist |wurde )?(?:bereits |schon |inzwischen )?(?:anderweitig )?(?:besetzt|vergeben)|\bbereits (?:besetzt|vergeben)\b|\bnous ne pouvons pas donner suite\b|\bpas été retenue?\b/i,
  rejectWeak: /\bunfortunately\b|\bwe regret\b|\bleider\b|\bmalheureusement\b|نأسف|للأسف|نعتذر/i,
  interview: /\binvit(?:e|ing) you (?:to|for) (?:an? |a first |a short |a brief )?(?:interview|meeting|call|conversation|discussion|chat)\b|\b(?:schedule|arrange|set up|book|organi[sz]e) (?:an? |a first |a short )?(?:interview|call|meeting|video call|teams call|zoom call|chat)\b|\boffer you (?:an? )?(?:interview|meeting|call|video call)\b|\binterview (?:invitation|invite|slot|on|with|at)\b|\byour availability\b|\bavailable for (?:an? )?(?:interview|call|chat|meeting)\b|\bassessment cent(?:re|er)\b|\b(?:move|reschedule|postpone|rearrange|change) (?:the |our |your )?(?:interview|meeting|call|appointment)\b|vorstellungsgespräch|\bkennenlern(?:gespräch|en)\b|\beinladung (?:zu[mr]?|für) (?:ein |einem )?(?:gespräch|interview)|\bterminvorschl|\btermin\b[^.]{0,40}\bverschieben\b|\bentretien\b|مقابلة/i,
  info: /\b(?:could|can|would) you (?:please )?(?:send|share|provide|confirm) (?:us )?(?:your|a copy|copies|the following|details|whether)\b|\bplease (?:send|share|provide) (?:us )?(?:your|a copy|copies|the following|details)\b|\bsalary expectations?\b|\bexpected salary\b|\bnotice period\b|\bcurrent (?:salary|package|ctc)\b|\b(?:earliest|possible) (?:start|joining) date\b|\bvisa status\b|\bgehaltsvorstellung|\bkündigungsfrist|\beintrittstermin|\bbitte (?:senden|schicken|teilen) sie\b|\bpourriez-vous\b/i,
  ack: /\b(?:we|we['’]ve|we have) (?:have )?(?:successfully )?received your (?:application|cv|resume|résumé)\b|\bthank(?:s| you) for (?:your )?(?:applying|application|interest)\b|\byour application (?:has been|was|is) (?:received|submitted|successfully submitted)\b|\bapplication (?:received|submitted)\b|\bwe(?: will|['’]ll| shall) (?:review|be in touch|get back|contact you|carefully review)\b|\beingang ihrer bewerbung|\bihre bewerbung (?:ist )?(?:bei uns )?eingegangen|\bvielen dank für ihre bewerbung|\bnous avons (?:bien )?reçu votre candidature|تم استلام|شكرا لتقديم|شكراً لتقديم/i,
};

/* What stops a phrase from counting, read in the same sentence:
   - before an interview phrase: a negation ("we will not be inviting you"), a condition
     ("if shortlisted we will invite you"), or the past ("thank you for the interview");
   - after it: a condition ("invite you for an interview if your profile matches");
   - before a rejection phrase: the stock line of an acknowledgement ("if you do not hear
     from us within 21 days, please accept that your application has not been successful");
   - before an offer phrase: a fraud warning ("we never ask for payment for an offer letter"). */
const NEGATED = /(?:\b(?:not|no|never|unable|cannot|nicht|kein\w*|pas)\b|n['’]t\b)[^.!?\n]{0,40}$/i;
/* Conditions on the candidate being picked, not on the date suiting them: "if you are
   available, we would like to invite you" is still an invitation. */
const CONDITIONAL = /\bif (?:shortlisted|selected|successful|suitable|(?:your|you are|you're) (?:shortlisted|selected|successful|suitable|profile|cv|application|experience|background|skills|qualifications))|\bshould (?:your|you be) (?:application|profile|cv|shortlisted|selected|successful)|\bonly shortlisted\b|\bin case (?:you are|your)\b|\bgegebenenfalls\b|\bggf\b|\bfalls (?:sie|ihre?)\b|\bsofern\b|\bsollten sie (?:in die engere|ausgewählt)/i;
const MAYBE = /\b(?:may|might) (?:invite|contact|arrange|schedule|reach out)\b/;   // lower case: "May" the month is not a condition
const CONDITIONAL_AFTER = /^[^.!?\n]{0,50}?\b(?:if|when|once) (?:your|you are|you're) (?:shortlisted|selected|profile|cv|experience|application|background|skills|qualifications)|^[^.!?\n]{0,50}?\bif (?:shortlisted|selected|successful|suitable)\b|^[^.!?\n]{0,50}?\b(?:falls|sofern|wenn) (?:ihr|ihre) (?:profil|qualifikation|erfahrung)/i;
const PAST = /\b(?:thank(?:s| you) for|after|following|since|attending|attended)\b[^.!?\n]{0,30}$/i;
const REJECT_COND = /\bif you (?:do not|don't|have not|haven't|did not|didn't) (?:hear|receive)|\bplease (?:assume|accept|consider)\b|\bin (?:the )?(?:event|case) (?:that )?(?:you|we) (?:do not|don't)|\bshould you not\b|\bsollten sie (?:innerhalb|bis|nichts)|\bfalls sie (?:nichts|keine)|\bsans (?:réponse|nouvelles)/i;
const OFFER_WARN = /\b(?:never|fraud|fraudulent|scam|payment|fee|fees|pay)\b/i;

/* The words around a match, starting and ending on whole words. */
function snippet(s, i, len) {
  let a = Math.max(0, i - 40), b = Math.min(s.length, i + len + 60);
  if (a > 0) {
    const sp = s.slice(a, i).search(/\s/);
    if (sp >= 0) a += sp + 1;
  }
  if (b < s.length) {
    const sp = s.slice(i + len, b).search(/\s\S*$/);
    if (sp >= 0) b = i + len + sp;
  }
  return ((a > 0 ? "…" : "") + s.slice(a, b) + (b < s.length ? "…" : "")).replace(/\s+/g, " ").trim();
}

/* The part of the sentence before position i. */
function sentenceBefore(s, i) {
  const t = s.slice(Math.max(0, i - 200), i);
  return t.slice(Math.max(t.lastIndexOf("."), t.lastIndexOf("!"), t.lastIndexOf("?"), t.lastIndexOf("\n")) + 1);
}

/* The first match that `skip(before, after)` does not rule out, as evidence. */
function firstMatch(rx, hay, skip) {
  const g = new RegExp(rx.source, "gi");
  let m;
  while ((m = g.exec(hay))) {
    if (!skip || !skip(sentenceBefore(hay, m.index), hay.slice(m.index + m[0].length, m.index + m[0].length + 80))) {
      return snippet(hay, m.index, m[0].length);
    }
    if (!m[0].length) g.lastIndex++;
  }
  return "";
}

/**
 * What a reply means: bounce, auto_reply, offer, interview, rejection, info, ack or other,
 * with a confidence and the words that decided it. Read without the quoted original.
 * Below 0.6 it is only ever a suggestion: an interview next to an acknowledgement or an
 * apology, and a rejection that rests on one "unfortunately".
 */
export function classify(msg) {
  const subj = String(msg.subject || "");
  const body = stripQuoted(msg.text);
  const hay = subj + "\n" + body;
  const delayed = RX.delay.test(subj) || RX.delay.test(body.slice(0, 400));
  if (msg.isReport || (RX.bounce.test(subj) && !delayed)) {
    return { cls: "bounce", conf: 0.95, evidence: firstMatch(RX.bounce, hay) || "delivery report" };
  }
  // A read receipt says the mail was opened, nothing about what they think of it. The
  // report part is proof; a bare "Read:" subject is only a guess, so it waits for you.
  if (msg.isReceipt || RX.receiptSubject.test(subj)) {
    return { cls: "read", conf: msg.isReceipt ? 0.9 : 0.45,
      evidence: msg.isReceipt ? "the recipient's mail program confirmed the message was opened" : "the subject looks like a read receipt" };
  }
  const oooFlag = !!msg.autoSubmitted || RX.oooSubject.test(subj);
  const ooo = firstMatch(RX.ooo, hay);
  if (oooFlag && ooo) return { cls: "auto_reply", conf: 0.85, evidence: ooo };
  const ack = firstMatch(RX.ack, hay);
  const weak = firstMatch(RX.rejectWeak, hay);
  const offer = firstMatch(RX.offer, hay, (before) => OFFER_WARN.test(before));
  const rej = firstMatch(RX.rejectStrong, hay, (before) => REJECT_COND.test(before));
  const intv = firstMatch(RX.interview, hay, (before, after) =>
    NEGATED.test(before) || CONDITIONAL.test(before) || MAYBE.test(before) || PAST.test(before) || CONDITIONAL_AFTER.test(after));
  if (offer && !rej) return { cls: "offer", conf: 0.8, evidence: offer };
  if (rej && intv) return { cls: "interview", conf: 0.45, evidence: intv };
  if (rej) return { cls: "rejection", conf: 0.85, evidence: rej };
  if (intv) return { cls: "interview", conf: ack || weak ? 0.45 : 0.85, evidence: intv };
  const info = firstMatch(RX.info, hay);
  if (info) return { cls: "info", conf: 0.75, evidence: info };
  if (ooo) return { cls: "auto_reply", conf: 0.7, evidence: ooo };
  if (weak) return { cls: "rejection", conf: 0.45, evidence: weak };
  if (ack) return { cls: "ack", conf: 0.8, evidence: ack };
  if (oooFlag) return { cls: "auto_reply", conf: 0.6, evidence: subj };
  return { cls: "other", conf: 0.3, evidence: "" };
}

/* ---------- which application it answers ---------- */

const FREE_MAIL = /(^|\.)(gmail|googlemail|outlook|hotmail|live|msn|yahoo|ymail|icloud|me|aol|gmx|web|t-online|proton|protonmail|mail|zoho|yandex)\.[a-z.]{2,}$/;
const RECRUITING = /(^|\.)(greenhouse\.io|greenhouse-mail\.io|lever\.co|myworkday\.com|myworkdayjobs\.com|workday\.com|smartrecruiters\.com|successfactors\.(com|eu)|taleo\.net|icims\.com|bamboohr\.com|recruitee\.com|workable\.com|jobvite\.com|teamtailor\.com|personio\.(de|com)|softgarden\.(de|io)|bayt\.com|naukrigulf\.com|linkedin\.com|oraclecloud\.com)$/;
const domainOf = (a) => (String(a || "").toLowerCase().split("@")[1] || "").trim();
const sameOrg = (a, b) => !!a && !!b && (a === b || a.endsWith("." + b) || b.endsWith("." + a));
const PREFIX = /^\s*(?:(?:re|aw|fw|fwd|wg|antw|antwort|sv|tr|rif)\s*(?:\[\d+\])?\s*:|\[[^\]]{1,24}\]|(?:automatic reply|automatische antwort|réponse automatique|abwesend)\s*:)\s*/i;

/** A subject without RE:/AW:/FW: and tags, lower case, dashes and spaces folded. */
export function normSubject(s) {
  let t = String(s || "");
  for (let i = 0; i < 6; i++) {
    const n = t.replace(PREFIX, "");
    if (n === t) break;
    t = n;
  }
  return t.toLowerCase().replace(/[\s—–-]+/g, " ").trim();
}

const CO_NOISE = /\b(l ?l ?c|fz ?llc|fze|fzco|dmcc|gmbh|ag|kg|se|ltd|limited|plc|inc|co|company|group|holding|holdings|international|the|and|of|uae|dubai|middle east|mena)\b/g;
/* Words that name no one firm: "Emirates Group" or "Gulf Properties" alone prove nothing. */
const GENERIC_CO = new Set(["emirates", "emirati", "gulf", "arabian", "arabia", "arab", "national", "global", "united", "general",
  "properties", "property", "services", "solutions", "trading", "investments", "investment", "capital", "partners",
  "consulting", "consultants", "development", "developments", "real", "estate", "bank", "hotels", "hotel", "resorts",
  "retail", "energy", "media", "technology", "technologies", "industries", "industrial", "logistics", "construction"]);
const coKey = (co) => String(co || "").toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, " ").replace(CO_NOISE, " ").replace(/\s+/g, " ").trim();
const escRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wholeWords = (phrase, text) => new RegExp(`(?:^|[^\\p{L}\\p{N}])${escRx(phrase)}(?:$|[^\\p{L}\\p{N}])`, "u").test(text);

/* The firm named in the text as whole words, or as a label of the sender's domain. */
function companyHit(co, low, dom) {
  const ck = coKey(co);
  const own = ck.split(" ").filter((w) => w.length >= 3 && !GENERIC_CO.has(w));
  if (!own.length) return false;
  if (wholeWords(ck, low) || (own.length >= 2 || own[0].length >= 5 ? wholeWords(own.join(" "), low) : false)) return true;
  const labels = String(dom || "").split(/[.-]/);
  return labels.includes(ck.replace(/ /g, "")) || labels.includes(own.join("")) || own.some((w) => w.length >= 5 && labels.includes(w));
}

const ROLE_STOP = new Set(["senior", "junior", "head", "lead", "manager", "director", "officer", "assistant", "associate",
  "executive", "specialist", "application", "speculative", "bewerbung", "initiativbewerbung", "with", "and", "for", "the"]);
const roleWords = (r) => String(r || "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4 && !ROLE_STOP.has(w));
const wasSent = (a) => !!a && !!a.stage && a.stage !== "none" && a.stage !== "draft";

/**
 * Every application the mail could answer, best first: [{id, score, reasons}].
 * ref 100, thread 90, unique subject 70 (shared 20), sender domain 40, recruiting system
 * plus company 30, company 25, role words 20. Mail dated more than a day before an
 * application is never its reply. `outbound` compares the recipients instead of the sender.
 */
export function matchApps(msg, apps, { outbound = false } = {}) {
  const list = Object.values(apps || {}).filter(wasSent);
  const full = `${msg.subject || ""}\n${msg.text || ""}`;
  const low = `${full}\n${(msg.from && msg.from.name) || ""}`.toLowerCase();
  const fromDom = domainOf(msg.from && msg.from.address);
  const toDoms = (msg.to || []).map(domainOf);
  const thread = [...(msg.inReplyTo || []), ...(msg.references || [])];
  const subjects = {};
  for (const a of list) {
    const k = normSubject(a.subject);
    if (k) subjects[k] = (subjects[k] || 0) + 1;
  }
  const ns = normSubject(msg.subject);
  const at = Date.parse(msg.date || "");
  const out = [];
  for (const a of list) {
    const since = Date.parse(a.preparedAt || a.sentAt || "");
    if (Number.isFinite(at) && Number.isFinite(since) && at < since - 86400000) continue;
    let score = 0;
    const reasons = [];
    const add = (n, why) => { score += n; reasons.push(why); };
    if (a.ref && new RegExp(`\\b${a.ref}\\b`).test(full)) add(100, "ref");
    if ((a.msgIds || []).some((id) => thread.includes(id))) add(90, "thread");
    const as = normSubject(a.subject);
    if (as && ns && (ns === as || ns.endsWith(" " + as))) add(subjects[as] === 1 ? 70 : 20, subjects[as] === 1 ? "subject" : "shared subject");
    const appDom = domainOf(a.to);
    const theirs = outbound ? toDoms.find((d) => sameOrg(d, appDom)) || "" : fromDom;
    const coHit = companyHit(a.job && a.job.co, low, theirs);
    // A recruiting system's domain is shared by every firm that uses it.
    if (appDom && theirs && !FREE_MAIL.test(appDom) && !RECRUITING.test(appDom) && sameOrg(theirs, appDom)) add(40, "domain");
    else if (!outbound && coHit && RECRUITING.test(fromDom)) add(30, "recruiting system");
    if (coHit) add(25, "company");
    const words = roleWords(a.job && a.job.r);
    if (words.length && words.filter((w) => low.includes(w)).length / words.length >= 0.6) add(20, "role");
    if (score > 0) out.push({ id: a.id, score, reasons });
  }
  return out.sort((x, y) => y.score - x.score);
}

/* ---------- moving the application on ---------- */

const RANK = { none: 0, draft: 1, prepared: 2, applied: 3, silent: 3, bounced: 3, ack: 4, info: 5, interview: 6, offer: 7 };
const FORWARD = { ack: "ack", info: "info", interview: "interview", offer: "offer" };

/**
 * The stage a reply moves an application to, or null. Forward only; a rejection from
 * anywhere; a bounce only before any answer; an out-of-office or unclassified reply only
 * proves the mail went out. A withdrawn application never moves.
 */
export function nextStage(cur, cls) {
  const s = cur || "none";
  if (s === "withdrawn") return null;
  if (cls === "rejection") return s === "rejected" ? null : "rejected";
  if (s === "rejected") return null;
  if (cls === "bounce") return s === "prepared" || s === "applied" ? "bounced" : null;
  // Being opened proves the mail went out; it does not reopen an application already given
  // up as unanswered, which would leave it in the follow-up list for good.
  if (cls === "read") return s === "prepared" ? "applied" : null;
  const to = FORWARD[cls];
  if (to) return RANK[to] > (RANK[s] ?? 0) ? to : null;
  return s === "prepared" || s === "silent" ? "applied" : null;
}

/* Record the item on its application. Every event carries the item id, and `undo` keeps
   what each field was and what the item set it to, so Undo takes back exactly this item —
   and leaves alone anything changed since, by hand or by a later reply. */
function applyItem(state, item, appId, msgId) {
  const a0 = (state.apps || {})[appId];
  if (!a0) return state;
  const a = { ...a0, events: [...(a0.events || [])], msgIds: [...(a0.msgIds || [])] };
  const day = String(item.date || "").slice(0, 10);
  const auto = item.status === "auto";
  const u = { appId, stage: a0.stage, to: null, sentAt: a0.sentAt || "", sentTo: null,
    lastInboundAt: a0.lastInboundAt || "", lastTo: null, openedAt: a0.openedAt || "", openedTo: null, msgId: "" };
  const setStage = (to, why) => {
    a.events.push({ at: day, kind: "stage", text: "Stage: " + STAGE_TEXT[to] + why, item: item.id, auto });
    a.stage = to;
    u.to = to;
  };
  if (item.dir === "out") {
    if (msgId && !a.msgIds.includes(msgId)) { a.msgIds.push(msgId); u.msgId = msgId; }
    const first = ["none", "draft", "prepared", "bounced"].includes(a0.stage);
    // A follow-up or your own answer later in the thread does not move the date you applied;
    // an earlier copy corrects it, whatever order the copies arrive in.
    if (day && (first || !a.sentAt || day < a.sentAt) && a.sentAt !== day) { a.sentAt = day; u.sentTo = day; }
    a.events.push({ at: day, kind: "sent", text: "Sent" + (item.subject ? " — " + item.subject : ""), item: item.id, auto });
    if (first) setStage("applied", "");
  } else {
    // A receipt says the mail was opened, not answered: it must not reset the quiet-days clock.
    // Mail can be read in any order — a mailbox hands over the newest first — so the last
    // answer stays the latest one and Opened stays the first time it was opened.
    const receipt = item.cls === "read";
    if (day && !receipt && day > (a.lastInboundAt || "")) { a.lastInboundAt = day; u.lastTo = day; }
    if (day && receipt && (!a.openedAt || day < a.openedAt)) { a.openedAt = day; u.openedTo = day; }
    if (a.stage === "prepared" && !a.sentAt) { a.sentAt = String(a.preparedAt || day).slice(0, 10); u.sentTo = a.sentAt; }
    a.events.push({ at: day, kind: "reply", cls: item.cls, item: item.id, auto,
      text: `${CLS_LABEL[item.cls] || "Reply"}${item.from ? " from " + item.from : ""}${item.evidence ? ": “" + item.evidence + "”" : ""}` });
    const to = nextStage(a.stage, item.cls);
    if (to) setStage(to, auto ? " — from the reply" : "");
  }
  item.undo = u;
  return { ...state, apps: { ...state.apps, [appId]: a } };
}

/* The mail's identity: its Message-ID, and a content key, so the same mail dropped as an
   .eml and later pasted is still recognised. */
function mailKeys(msg) {
  const from = (msg.from && msg.from.address) || "";
  const body = stripQuoted(msg.text).replace(/\s+/g, " ").trim().slice(0, 300);
  return [msg.msgId, body ? "c:" + fnv(`${from}|${normSubject(msg.subject)}|${body}`) : ""].filter(Boolean);
}

/**
 * Read one mail into the state {apps, inbox, seen}. Applied at once when both the match
 * (60 or more, 20 ahead of the next) and the meaning are clear; otherwise kept as a
 * suggestion (35 or more) or as unmatched. Mail from one of `me` is a sent copy: it marks
 * its application sent with the mail's own date. A mail already read is a duplicate —
 * unless it was left unmatched or set aside, when it is read again.
 */
export function ingest(state, msg, { me = [], now = new Date().toISOString(), autoMin = 60, suggestMin = 35 } = {}) {
  const seen = state.seen || [];
  let inbox = state.inbox || [];
  const keys = mailKeys(msg);
  if (!keys.length) keys.push("h:" + fnv(`${msg.subject || ""}|${now}`));
  /* A mail with an id of its own is only itself — two applications with the same wording
     are two mails. One without an id (pasted, or saved as text) is known by what it says,
     so the same mail dropped as a file and later pasted is still read once. */
  const lookup = msg.msgId ? [msg.msgId] : keys;
  if (lookup.some((k) => seen.includes(k))) {
    const prior = inbox.find((x) => (x.keys || [x.key]).some((k) => lookup.includes(k)));
    if (!prior || (prior.status !== "unmatched" && prior.status !== "ignored")) {
      return { state, item: { status: "duplicate", key: keys[0], subject: msg.subject || "" } };
    }
    inbox = inbox.filter((x) => x !== prior);
  }
  const fromAddr = (msg.from && msg.from.address) || "";
  const outbound = !!fromAddr && me.map((x) => String(x || "").toLowerCase()).includes(fromAddr);
  const cands = matchApps(msg, state.apps, { outbound });
  const c = outbound ? { cls: "sent", conf: 1, evidence: "" } : classify(msg);
  const [top, second] = cands;
  const clear = c.conf >= 0.6 || c.cls === "other";
  const auto = !!top && top.score >= autoMin && (!second || top.score - second.score >= 20) && clear;
  const item = {
    id: "m-" + fnv(keys[0]), key: keys[0], keys, dir: outbound ? "out" : "in",
    from: (msg.from && (msg.from.name || msg.from.address)) || "", fromAddr,
    date: msg.date || now, subject: msg.subject || "", excerpt: stripQuoted(msg.text).slice(0, 600),
    cls: c.cls, conf: c.conf, evidence: c.evidence, cands: cands.slice(0, 3),
    appId: top && top.score >= suggestMin ? top.id : null,
    status: auto ? "auto" : top && top.score >= suggestMin ? "suggested" : "unmatched",
    undo: null,
  };
  let next = { apps: state.apps || {}, inbox, seen };
  if (auto) next = applyItem(next, item, top.id, msg.msgId);
  const newSeen = [...seen, ...keys.filter((k) => !seen.includes(k))].slice(-2000);
  return { state: { apps: next.apps, inbox: [item, ...next.inbox].slice(0, 300), seen: newSeen }, item };
}

/** Take back what an applied item did; it stays in the list as a suggestion. */
export function undoItem(state, itemId) {
  const inbox = state.inbox || [];
  const it = inbox.find((x) => x.id === itemId);
  if (!it || !it.undo) return state;
  const u = it.undo, a0 = (state.apps || {})[u.appId], apps = { ...state.apps };
  if (a0) {
    const a = { ...a0, events: (a0.events || []).filter((e) => e.item !== itemId),
      msgIds: (a0.msgIds || []).filter((m) => !u.msgId || m !== u.msgId) };
    if (u.to !== null && a.stage === u.to) a.stage = u.stage;
    if (u.sentTo !== null && a.sentAt === u.sentTo) a.sentAt = u.sentAt;
    if (u.lastTo !== null && a.lastInboundAt === u.lastTo) a.lastInboundAt = u.lastInboundAt;
    // Another receipt may still be applied to this application; Opened then keeps its date.
    if (u.openedTo != null && a.openedAt === u.openedTo) {
      a.openedAt = inbox.filter((x) => x.id !== itemId && x.cls === "read" && x.undo && x.undo.appId === u.appId)
        .map((x) => String(x.date || "").slice(0, 10)).filter(Boolean).sort()[0] || u.openedAt;
    }
    apps[u.appId] = a;
  }
  // A later item that started from what this one set now starts from what it replaced.
  const relink = (v) => {
    const w = { ...v };
    if (u.to !== null && w.stage === u.to) w.stage = u.stage;
    if (u.sentTo !== null && w.sentAt === u.sentTo) w.sentAt = u.sentAt;
    if (u.lastTo !== null && w.lastInboundAt === u.lastTo) w.lastInboundAt = u.lastInboundAt;
    if (u.openedTo != null && w.openedAt === u.openedTo) w.openedAt = u.openedAt;
    return w;
  };
  const back = { ...it, undo: null, status: it.appId ? "suggested" : "unmatched" };
  return { ...state, apps, inbox: inbox.map((x) => (x.id === itemId ? back : x.undo && x.undo.appId === u.appId ? { ...x, undo: relink(x.undo) } : x)) };
}

/** Apply an item to the application you chose — a suggestion confirmed, or a re-assignment. */
export function confirmItem(state, itemId, appId) {
  let st = state;
  let it = (st.inbox || []).find((x) => x.id === itemId);
  if (!it || !(st.apps || {})[appId]) return state;
  if (it.undo) {
    st = undoItem(st, itemId);
    it = st.inbox.find((x) => x.id === itemId);
  }
  const item = { ...it, appId, status: "confirmed" };
  st = applyItem(st, item, appId, it.key && it.key.startsWith("<") ? it.key : "");
  return { ...st, inbox: st.inbox.map((x) => (x.id === itemId ? item : x)) };
}

/** Set an item aside, undoing it first if it had been applied. */
export function ignoreItem(state, itemId) {
  const it = (state.inbox || []).find((x) => x.id === itemId);
  if (!it) return state;
  const st = it.undo ? undoItem(state, itemId) : state;
  return { ...st, inbox: st.inbox.map((x) => (x.id === itemId ? { ...x, status: "ignored", undo: null } : x)) };
}
