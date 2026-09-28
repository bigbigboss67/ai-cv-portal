/**
 * Recruiter lens C: the scorecard out of 10 and the "don't send below 85" warning.
 *
 * Seven parts, in the owner's order: ATS compatibility, Keyword strength,
 * Achievement quality, Formatting clarity, Summary impact, Skills relevance, Length.
 *
 * Pure: no DOM, no clock, no network, no randomness. It never runs the review. It
 * reads the object reviewCV() already returned, so the parts and the 0–100 cannot
 * disagree:
 *  - every check id belongs to exactly one part (DIMENSION_OF, written out in full
 *    with no prefix fallback, so a new check fails the coverage test until someone
 *    places it);
 *  - a part's loss is the sum of its checks' own `penalty`, the number reviewCV()
 *    computed with its severity weights, so nothing is re-weighted here;
 *  - a live must-fix item of a GATES check caps its part at 5.9, as the review caps
 *    the whole score at 59.
 * Keyword strength has no review check. It comes only from one posting (feature D's
 * keywordReport) and never changes the 0–100, the verdict or the send warning.
 *
 * Output text is a fixed label from this file, a check title or the verdict copied
 * from the review, the posting's title or one of its terms, an id, or a number. No
 * line of the CV is ever read or quoted, so no personal data can pass through.
 */
import { CHECKS, BAND, MARKETS } from "./cv-review.js";

const S = (v) => (v == null ? "" : String(v));
const esc = (s) => S(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const freeze = (o) => { for (const v of Object.values(o)) if (v && typeof v === "object") freeze(v); return Object.freeze(o); };

/* ------------------------------------------------------------------ tables */

export const DIMENSIONS = freeze([
  { id: "ats", label: "ATS compatibility", about: "What a tracking system files and screens on: the header and role fields, readable dates, clean characters, and personal data it must never see." },
  { id: "keywords", label: "Keyword strength", about: "How many of one posting's must-have keywords this job's CV carries in the posting's own words. Scored per job; not part of the 0–100." },
  { id: "achievements", label: "Achievement quality", about: "Bullets that say what you did, in your own words, with a figure behind the claim." },
  { id: "format", label: "Formatting clarity", about: "One document language, one date style, a timeline that reads without questions, clean lines." },
  { id: "summary", label: "Summary impact", about: "The headline and the summary: the first six seconds, backed by your roles." },
  { id: "skills", label: "Skills relevance", about: "Skills your bullets show, languages with their level, and your qualification." },
  { id: "length", label: "Length", about: "Pages, bullets per role, bullet length and older roles." },
]);
/* The six parts the review scores; Keyword strength is the seventh and has no check. */
const REVIEW_DIMS = DIMENSIONS.map((d) => d.id).filter((id) => id !== "keywords");

/* Every check of cv-review.js CHECKS, in catalogue order, to exactly one part. */
export const DIMENSION_OF = freeze({
  /* Header: the fields an ATS files, and the personal data a screen must never see. */
  "HDR-01": "ats", "HDR-02": "ats", "HDR-03": "ats", "HDR-04": "ats", "HDR-05": "ats", "HDR-06": "ats",
  "HDR-07": "ats", "HDR-08": "ats", "HDR-09": "ats", "HDR-10": "ats", "HDR-11": "ats", "HDR-12": "ats",
  /* Headline and summary: the first six seconds (SUM-01's own rule). */
  "HL-01": "summary", "HL-02": "summary", "HL-03": "summary", "HL-04": "summary", "HL-05": "summary",
  "SUM-01": "summary", "SUM-02": "summary", "SUM-03": "summary", "SUM-04": "summary", "SUM-05": "summary",
  "SUM-06": "summary", "SUM-07": "summary", "SUM-08": "summary", "SUM-09": "summary", "SUM-10": "summary",
  /* Experience: missing or misparsed role fields are ATS failures; dates, order,
     overlaps and gaps are about reading the timeline; older roles are length. */
  "EXP-01": "ats", "EXP-02": "ats", "EXP-03": "ats", "EXP-04": "ats",
  "EXP-05": "format", "EXP-06": "format", "EXP-07": "format", "EXP-08": "format", "EXP-09": "format",
  "EXP-10": "ats", "EXP-11": "length", "EXP-12": "format",
  /* Bullets: count, length and padding are length; wording is achievement; a
     broken line is format; a role lost among the bullets is an ATS failure. */
  "BUL-01": "length", "BUL-02": "length", "BUL-03": "achievements", "BUL-04": "achievements",
  "BUL-05": "achievements", "BUL-06": "length", "BUL-07": "format", "BUL-08": "ats", "BUL-09": "achievements",
  "ACH-01": "achievements",
  /* Figures: MET-02 is question-only (no penalty); MET-03 is a skill with no line behind it. */
  "MET-01": "achievements", "MET-02": "achievements", "MET-03": "skills",
  /* Skills and languages. */
  "SKL-01": "skills", "SKL-02": "skills", "SKL-03": "skills", "SKL-04": "skills", "SKL-05": "skills",
  "LNG-01": "skills", "LNG-02": "skills", "LNG-03": "skills", "LNG-04": "skills",
  /* Education: the qualification and its year are skills; broken or mixed-language lines are format. */
  "EDU-01": "skills", "EDU-02": "format", "EDU-03": "format", "EDU-04": "skills",
  /* References: referee contact and name are data a screen must not see; the closing line is format. */
  "REF-01": "ats", "REF-02": "format", "REF-03": "ats",
  /* Document language: DOC-02 is the summary's language; DOC-04 is question-only. */
  "DOC-01": "format", "DOC-02": "summary", "DOC-03": "format", "DOC-04": "format", "DOC-05": "format",
  /* Market: spelling and date style are format; MKT-03 is the question-only screening facts; MKT-04 is pages. */
  "MKT-01": "format", "MKT-02": "format", "MKT-03": "ats", "MKT-04": "length",
  /* Characters and separators that garble parsing. */
  "ATS-01": "ats", "ATS-02": "ats",
});

/* The review's "Ready to send" line, and the cap a live must-fix gate puts on a score. */
export const READY = 85;
const CAP = 59;

/* Every CV save or send action the warning sits in front of, and its class: one
   "anyway" on a save does not silence a later real send at the same score. */
export const ACTION_CLASS = freeze({
  cvPdfBtn: "save", cvDesignBtn: "save", cvbPdf: "save", cvbDesign: "save",
  mailBtn: "send", applyBtn: "send", msSend: "send", msDraft: "send",
});
export const SEND_ACTIONS = freeze(Object.keys(ACTION_CLASS));

/* Every fixed string the module can print. */
export const LABELS = freeze({
  title: "Scorecard · out of 10",
  gatedCap: "a must-fix item caps it",
  sum: "The points lost in the six parts add up to",
  sumCapped: "capped at 59 by must-fix items",
  sumStop: "the score stops at 0",
  notInScore: "Keyword strength is scored per job and is not part of the 0–100.",
  costs: "What costs points, by part",
  kw: {
    pick: "Pick a job to score this.",
    pickBtn: "Pick a job →",
    change: "Change job",
    open: "Open Match",
    wait: "The keyword check has not loaded yet.",
    spec: "This application has no posting to score.",
    other: "This job was matched for another CV, so it is not scored against this one.",
    none: "This posting names none of the keywords the portal can match, so there is nothing to score.",
    nocv: "There are no roles in this CV to compare with the posting.",
    snippet: "This listing has only a search snippet, so its keywords are not checked against your CV. Add the full listing to score them.",
    for: "For",
    have: "must-have keywords in this job's CV in the posting's own words:",
    of: "of",
    approved: "through a swap you approved",
    offered: "Swaps you can still approve in Match:",
  },
  warn: {
    head: "Not yet ready to send.",
    your: "Your CV",
    scores: "scores",
    weakest: "Weakest part:",
    lost: "points lost",
    why: "The portal suggests sending at 85 or above. Nothing is blocked: the choice is yours.",
    open: "Open CV Review",
  },
  proceed: {
    cvPdfBtn: "Save it anyway", cvDesignBtn: "Save it anyway", cvbPdf: "Save it anyway", cvbDesign: "Save it anyway",
    mailBtn: "Prepare it anyway", msSend: "Send it anyway", msDraft: "Create the draft anyway", applyBtn: "Copy and open anyway",
    any: "Continue anyway",
  },
  lang: { en: "English", de: "German", ar: "Arabic", fr: "French", es: "Spanish", it: "Italian", pt: "Portuguese", nl: "Dutch", tr: "Turkish", ru: "Russian" },
});

/* ------------------------------------------------------------------ coverage */

/**
 * Which check ids have no part (missing), which mapped ids no longer exist
 * (stale), and which map to something that is not a review part (bad).
 */
export function coverage(ids = Object.keys(CHECKS), map = DIMENSION_OF) {
  const have = new Set(ids), parts = new Set(REVIEW_DIMS);
  const at = (id) => (own(map, id) ? map[id] : undefined);
  return {
    missing: ids.filter((id) => at(id) === undefined),
    stale: Object.keys(map).filter((id) => map[id] !== undefined && !have.has(id)),
    bad: ids.filter((id) => at(id) !== undefined && !parts.has(at(id))),
  };
}

/* ------------------------------------------------------------------ keyword strength */

/**
 * Keyword strength for one posting, from feature D's report. The input is one of:
 *   undefined | null                       → "pick"  (no job picked)
 *   { wait: true }                         → "wait"  (the keyword module has not loaded)
 *   { skip: "spec" }                       → "spec"  (a speculative application: no posting)
 *   { skip: <anything else> }              → "other" (a match made for another CV)
 *   { title, report, applied }             → "scored", or "snippet" / "none" / "nocv"
 * where report = keywordReport(posting, cv, vocab) = { source, must: [{ key, term, state }], swaps: [{ id, key }] },
 * title = the posting's title (A.j.r) and applied = A.kwApplied (the approved swap ids
 * kwOverlay put into this job's CV). D's report itself (with `must`) is accepted too.
 *
 * D owns the evidence rule. An item is credited when its state is "in-cv", or when it
 * is "swap" and one of its swaps was approved: D reports on the base text, so an
 * approved swap still reads "swap" there. "other-words", "gap", an unapproved "swap"
 * and any unknown state earn nothing; an ATS matches words, not meanings.
 */
export function keywordStrength(input) {
  const out = (status, note, more = {}) => ({ status, tenths: null, score: null, note, ...more });
  if (!input || typeof input !== "object") return out("pick", LABELS.kw.pick);
  if (input.wait) return out("wait", LABELS.kw.wait);
  if (input.skip) return out(input.skip === "spec" ? "spec" : "other", input.skip === "spec" ? LABELS.kw.spec : LABELS.kw.other);
  const K = input.report && typeof input.report === "object" ? input.report : Array.isArray(input.must) ? input : null;
  if (!K) return out("pick", LABELS.kw.pick);
  const title = S(input.title).trim();
  /* Same rule as D's approved(): only string ids, matched against this report's swaps. */
  const applied = new Set((Array.isArray(input.applied) ? input.applied : []).filter((x) => typeof x === "string"));
  const approvedKeys = new Set((Array.isArray(K.swaps) ? K.swaps : []).filter((s) => s && applied.has(S(s.id))).map((s) => S(s.key)));
  const seen = new Set(), items = [];
  for (const m of Array.isArray(K.must) ? K.must : []) {
    if (!m || typeof m !== "object") continue;
    const key = S(m.key) || S(m.term).toLowerCase();
    if (!key || seen.has(key)) continue;                        // the first of a repeated key wins
    seen.add(key);
    const state = m.state == null ? null : S(m.state);
    const approved = state === "swap" && approvedKeys.has(S(m.key));
    items.push({ key, term: S(m.term), state, credited: state === "in-cv" || approved, approved });
  }
  /* D compares no CV with a search snippet: its states are null, and so is the score. */
  if (S(K.source) === "snippet") return out("snippet", LABELS.kw.snippet, { title, items });
  if (!items.length) return out("none", LABELS.kw.none, { title, items });
  if (items.every((i) => i.state === null)) return out("nocv", LABELS.kw.nocv, { title, items });
  const have = items.filter((i) => i.credited).length, of = items.length;
  const tenths = Math.round((100 * have) / of);
  return {
    status: "scored", tenths, score: tenths / 10, title, have, of,
    approved: items.filter((i) => i.approved).length,
    offered: items.filter((i) => i.state === "swap" && !i.approved).length,
    otherWords: items.filter((i) => i.state === "other-words").length,
    gaps: items.filter((i) => i.state === "gap").length,
    items,
  };
}

/* ------------------------------------------------------------------ the card */

/**
 * scorecard(review, { keywords }) → Card
 *   review   : what reviewCV() returned (never mutated)
 *   keywords : the keywordStrength() input above (optional)
 * Card = { ok, score, rawScore, verdict, gated, lang, market,     (copied from the review)
 *          lost,                                                   (Σ check.penalty)
 *          dims: 7 parts in DIMENSIONS order,
 *          unmapped: [{ id, penalty }] }                           ([] while the coverage test passes)
 * A review part: { id, label, about, status: "scored", tenths 0–100, score, lost, gated,
 *   checks: [{ id, title, sev, penalty, gate, gating }] } with only the checks that cost
 * points, costliest first. `tenths` is the stored truth; show (tenths / 10).toFixed(1).
 */
export function scorecard(review, { keywords } = {}) {
  const r = review && typeof review === "object" ? review : {};
  const list = Array.isArray(r.checks) ? r.checks : null;
  const acc = new Map(REVIEW_DIMS.map((id) => [id, { lost: 0, gated: false, checks: [] }]));
  const unmapped = [];
  let lost = 0;
  (list || []).forEach((k, index) => {
    if (!k || typeof k !== "object") return;
    const pen = Number.isFinite(k.penalty) && k.penalty > 0 ? k.penalty : 0;   // undefined for "na" and "ask"
    const id = S(k.id);
    lost += pen;
    const d = own(DIMENSION_OF, id) ? acc.get(DIMENSION_OF[id]) : null;
    if (!d) { unmapped.push({ id, penalty: pen }); return; }
    /* The review's own gate rule: an unacknowledged, scored high instance of a GATES check. */
    const live = (Array.isArray(k.instances) ? k.instances : []).filter((i) => i && !i.acked && !i.later);
    const gating = !!k.gate && live.some((i) => i.sev === "high");
    if (gating) d.gated = true;
    d.lost += pen;
    if (pen > 0) d.checks.push({ id, title: S(k.title), sev: S(k.sev), penalty: pen, gate: !!k.gate, gating, index });
  });
  const dims = DIMENSIONS.map(({ id, label, about }) => {
    if (id === "keywords") return { id, label, about, ...keywordStrength(keywords) };
    if (!list) return { id, label, about, status: "noreview", tenths: null, score: null, lost: 0, gated: false, checks: [] };
    const d = acc.get(id);
    const tenths = Math.min(d.gated ? CAP : 100, Math.max(0, 100 - d.lost));
    const checks = d.checks
      .sort((a, b) => b.penalty - a.penalty || b.gating - a.gating || b.gate - a.gate || a.index - b.index)
      .map(({ index, ...c }) => c);
    return { id, label, about, status: "scored", tenths, score: tenths / 10, lost: d.lost, gated: d.gated, checks };
  });
  return { ok: !!list, score: r.score, rawScore: r.rawScore, verdict: r.verdict, gated: !!r.gated, lang: r.lang, market: r.market, lost, dims, unmapped };
}

/* ------------------------------------------------------------------ the send warning */

/* The part to name. A gated review is "Not ready" because of a must-fix item, so
   the gated part and its gating check are named even when another part lost more.
   Otherwise the lowest part; ties go to gated, then more points lost, then the
   owner's order. Keyword strength never takes part: the 85 line is the review's. */
function lowestOf(card) {
  let c = card.dims.filter((d) => d.id !== "keywords" && d.status === "scored" && (d.lost > 0 || d.gated));
  if (card.gated && c.some((d) => d.gated)) c = c.filter((d) => d.gated);
  if (!c.length) return null;
  const order = (d) => DIMENSIONS.findIndex((x) => x.id === d.id);
  const d = c.slice().sort((a, b) => a.tenths - b.tenths || b.gated - a.gated || b.lost - a.lost || order(a) - order(b))[0];
  /* A gated part names the must-fix that caps it (B's "first unacknowledged GATES item"),
     not a costlier should-fix; its costs list stays costliest first. */
  const t = (d.gated && d.checks.find((k) => k.gating)) || d.checks[0] || null;
  return { id: d.id, label: d.label, tenths: d.tenths, lost: d.lost, gated: d.gated, top: t ? { id: t.id, title: t.title, sev: t.sev, penalty: t.penalty } : null };
}

/**
 * sendWarning(cardOrReview, action) → Warning
 *   { warn, score, verdict, gated, lang, market, action, lowest: { id, label, tenths, lost,
 *     gated, top: { id, title, sev, penalty } | null } | null, ack }
 * warn is score < 85, which is verdict !== "Ready to send". It never blocks anything:
 * the page shows warningHtml() and one click proceeds. ack is built from numbers and
 * ids only: score | language | market | part | action class ("save", "send", "any"),
 * so an "anyway" for one language, market or kind of action does not silence another.
 */
export function sendWarning(input, action) {
  const card = input && Array.isArray(input.dims) ? input : scorecard(input);
  const warn = !!card.ok && Number.isFinite(card.score) && card.score < READY;
  const act = S(action);
  const lowest = warn ? lowestOf(card) : null;
  const ack = card.ok ? [card.score, S(card.lang), S(card.market), lowest ? lowest.id : "-", own(ACTION_CLASS, act) ? ACTION_CLASS[act] : "any"].join("|") : "";
  return { warn, score: card.score, verdict: card.verdict, gated: !!card.gated, lang: card.lang, market: card.market, action: act, lowest, ack };
}

/* ------------------------------------------------------------------ HTML */

const tenth = (t) => (t / 10).toFixed(1);
/* The section-bar thresholds of the Readiness panel, so no colour is new. */
const colour = (t) => (t >= 85 ? BAND.ready : t >= 70 ? BAND.after : BAND.work);
const bar = (t) => `<div class="track"><i style="width:${t}%;background:${colour(t)}"></i></div>`;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function kwRow(d) {
  const L = LABELS.kw;
  const go = (label) => ` <button class="cvr-link" data-cvr-go="match">${esc(label)}</button>`;
  const open = `<div class="cvr-bar" data-dim="keywords" title="${esc(d.about)}">`;
  if (d.status !== "scored") {
    const btn = d.status === "pick" ? go(L.pickBtn) : ["spec", "other", "none", "snippet"].includes(d.status) ? go(L.change) : "";
    return `${open}<span>${esc(d.label)}</span><div class="hint">${esc(d.note)}${btn}</div></div>`;
  }
  const lead = d.title ? `${L.for} “${d.title}”: ${L.have}` : cap(L.have);
  const text = `${lead} ${d.have} ${L.of} ${d.of}${d.approved ? ` (${d.approved} ${L.approved})` : ""}.${d.offered ? ` ${L.offered} ${d.offered}.` : ""}`;
  return `${open}<span>${esc(d.label)} · ${tenth(d.tenths)}</span>${bar(d.tenths)}<div class="hint">${esc(text)}${go(L.open)}</div></div>`;
}

function partRow(d) {
  return `<div class="cvr-bar" data-dim="${esc(d.id)}" title="${esc(d.about)}"><span>${esc(d.label)} · ${tenth(d.tenths)}${d.gated ? " · " + esc(LABELS.gatedCap) : ""}</span>${bar(d.tenths)}</div>`;
}

/* Only printed when it is true: every check placed and the review's own arithmetic. */
function sumLine(card) {
  if (card.unmapped.length || card.rawScore !== Math.max(0, 100 - card.lost)) return "";
  const s = card.lost > 100
    ? `${LABELS.sum} ${card.lost}; ${LABELS.sumStop}`
    : `${LABELS.sum} ${card.lost}: 100 − ${card.lost} = ${card.rawScore}${card.score < card.rawScore ? ", " + LABELS.sumCapped : ""}`;
  return `<div class="hint">${esc(s)}. ${esc(LABELS.notInScore)}</div>`;
}

/** The CV Review panel. Existing classes only; colours from BAND only. */
export function scorecardHtml(card) {
  if (!card || !card.ok || !Array.isArray(card.dims)) return "";
  const rows = card.dims.map((d) => (d.id === "keywords" ? kwRow(d) : partRow(d))).join("");
  const costs = card.dims.filter((d) => d.status === "scored" && d.id !== "keywords" && d.checks.length)
    .map((d) => `<li>${esc(d.label)} −${d.lost}: ${d.checks.map((k) => `${esc(k.title)} (−${k.penalty})`).join(" · ")}</li>`).join("");
  return `<div class="ipanel cvr-score" id="cvrScore"><h5>${esc(LABELS.title)}</h5>
<div class="cvr-bars" style="grid-template-columns:minmax(0,1fr)">${rows}</div>
${sumLine(card)}${costs ? `<details class="cvr-pass"><summary>${esc(LABELS.costs)}</summary><ul>${costs}</ul></details>` : ""}</div>`;
}

/**
 * The non-blocking warning for one action, or "" when there is nothing to warn about.
 * Pass the same action id to sendWarning() so the ack matches. role: "alert" by default;
 * pass { role: "" } when the container is already a live region (the Builder's #cvbMsg).
 */
export function warningHtml(w, actionId, { role = "alert" } = {}) {
  if (!w || !w.warn) return "";
  const id = S(actionId || w.action), W = LABELS.warn;
  const where = [LABELS.lang[w.lang] || S(w.lang).toUpperCase(), MARKETS[w.market] || S(w.market).toUpperCase()].filter(Boolean).join(" · ");
  const lo = w.lowest;
  const weakest = lo ? ` ${W.weakest} ${lo.label} ${tenth(lo.tenths)}/10, ${lo.lost} ${W.lost}${lo.top ? " — " + lo.top.title : ""}.` : "";
  const proceed = id !== "any" && own(LABELS.proceed, id) ? LABELS.proceed[id] : LABELS.proceed.any;
  return `<div${role ? ` role="${esc(role)}"` : ""} data-cvsc-warn="${esc(id)}"><b style="color:${w.gated ? BAND.work : BAND.after}">${esc(W.head)}</b> ${esc(`${W.your}${where ? ` (${where})` : ""} ${W.scores} ${w.score}/100 — ${w.verdict}.${weakest} ${W.why}`)}
<div class="cvr-acts" style="margin-top:6px"><button class="btn sm" data-sendanyway="${esc(id)}" data-sendack="${esc(w.ack)}">${esc(proceed)}</button><button class="cvr-link" data-cvgo="cvcheck">${esc(W.open)}</button></div></div>`;
}

if (typeof window !== "undefined") {
  window.CV_SCORECARD = { scorecard, keywordStrength, sendWarning, scorecardHtml, warningHtml, coverage, SEND_ACTIONS, ACTION_CLASS, LABELS, DIMENSIONS, READY };
}
