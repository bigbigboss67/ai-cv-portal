/**
 * First 6 seconds (recruiter lens A) and "What gets you rejected" (lens B).
 *
 * A recruiter's first read of a CV is the top third of page 1: the name, the
 * headline, the contact line, the first summary sentence, and the latest role
 * with its first two lines. This module says what that read lands on, what
 * stops it, and whether it ends in a shortlist, a maybe or a skip, judged
 * against the candidate's own headline or, for one job, against the posting.
 * Under it sits the one item most likely to get the CV rejected and the three
 * weakest achievements, each with the review's own question for its figure.
 *
 * It reads the review cv-review.js already made and never re-derives a
 * finding: every rejection, top-third problem and weak-line reason is a live
 * instance of a review check (not checked by the candidate, not waiting for the
 * Builder), and the check's title, rule, fix, note and question are copied from
 * the review as they are. What this adds is only what the review cannot know:
 * which lines sit in the top third, and how they stand against a target.
 *
 * Nothing here writes CV content. Every string it returns is one of:
 *   - a Quote, an exact slice of a candidate field
 *       valueAt(P, path, edits).slice(at, at + text.length) === text
 *     or of the posting exactly as passed ("posting.title" slices opts.posting.title,
 *     "posting.text" slices opts.posting.text);
 *   - a fixed label from LABELS;
 *   - a string copied verbatim from the review (check title, rule, fix, evidence
 *     note, question, the candidate's stored answer), from the keyword report
 *     (a must-have's key) or from the Fit check (a blocker's why).
 * A posting keyword with no evidence in the CV is a gap and is never quoted from
 * the CV. No figure is ever produced: a weak line points at the review's own
 * question, so the candidate types the real figure. Personal data is never
 * quoted: a quote that touches a live HDR-06/07/08/09/10/12 finding comes back
 * empty and masked, and a copied review string that holds such a span becomes
 * LABELS.masked.
 *
 * Pure and deterministic: no DOM, no network, no clock (today comes only from
 * opts.today, the object reviewCV got), no randomness, and every sort ends in an
 * index tie-break. No regex here uses lookbehind.
 */
import { sentences, parseDates, idx, hasFigure, yearsClaims, findDateRanges, asciiDigits, matcher, TITLE_WORDS, SECTIONS, valueAt, BAND } from "./cv-review.js";

/* ---------- small helpers ---------- */

const str = (v) => (v === undefined || v === null ? "" : String(v));
const low = (v) => str(v).toLowerCase();
const squash = (s) => str(s).replace(/\s+/g, " ").trim();
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const deepFreeze = (o) => {
  if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); }
  return o;
};

/* ---------- fixed wording ---------- */

/** Every fixed string the engine can emit. Nothing else it returns is its own wording. */
export const LABELS = deepFreeze({
  title: "First 6 seconds",
  titlePosting: "First 6 seconds — this job",
  scope: {
    top: "The top third of page 1 only: your name, headline, contact line, first summary sentence, and your latest role with its first two lines.",
    master: "Changes your CV for every application",
    job: "Changes only this job's CV",
  },
  target: { headline: "Judged against your own headline", posting: "Judged against this posting's title and must-haves" },
  targetLine: "The posting",
  verdict: { shortlist: "Shortlist", maybe: "Maybe", skip: "Skip" },
  reason: {
    "V-GATE": { ok: "No must-fix item blocks sending", bad: "A must-fix item blocks sending" },
    "V-BLOCK": { ok: "Nothing in the posting rules you out", bad: "The posting rules you out" },
    "V-TOP": { ok: "The top third reads cleanly", bad: "Something in the top third stops the read" },
    "V-TITLE": { ok: "Your headline names this kind of role", bad: "Your headline does not name this kind of role" },
    "V-CURRENT": { ok: "Your latest role runs to the present", bad: "Your latest role does not run to the present" },
    "V-FIG": { ok: "A result figure in the top third", bad: "No result figure in the top third" },
    "V-MUST": { ok: "The posting's must-haves show in the top third in its own words", bad: "Fewer than two of the posting's must-haves show in the top third in its own words" },
  },
  catch: {
    "C-TITLE": "The most senior title up top",
    "C-FIG": "The first figure the eye lands on",
    "C-RESULT": "The first result figure",
    "C-CURRENT": "Current role, dated to the present",
  },
  kill: {
    "K-REJECT": "What gets you rejected",
    "TOP-WR": "No work-rights line in the header",
    "TOP-HL": "No headline in this language",
    "TOP-HL-FAMILY": "Your headline names a different kind of role",
    "TOP-HL-NOROLE": "Your headline names no role",
    "TOP-DATES": "Your latest role's dates raise a question",
    "TOP-ORDER": "Your latest role is not listed first",
    "TOP-SUM": "Your first summary sentence names no role",
    "TOP-HIGH": "A must-fix item in the top third",
  },
  fix: {
    family: "Lead the headline with a title you held that names this kind of role, with any limiting word it had (deputy, assistant, co-).",
    norole: "Start the headline with a title you held.",
    sum: "Open the summary with the role you hold or held, in your words.",
  },
  alt: "A title you held in this family",
  latestTitle: "Your latest title",
  call: {
    keep: "In the top third, in the posting's words",
    move: "In your CV in the posting's words, but below the top third",
    "in-cv": "In your CV in the posting's words",
    swapped: "Your line, with the posting's word you approved for this job",
    swap: "In your line in other words — a same-meaning swap is offered in Match",
    "other-words": "Shown in your CV in other words — no same-meaning swap exists",
    gap: "Not in any line you wrote — never claimed",
    unchecked: "Not checked against your CV",
  },
  weak: { "BUL-04": "Opens with a job-description phrase", "BUL-05": "Qualifier with no figure behind it", "no-figure": "No figure" },
  weakTitle: "Your three weakest achievements",
  aboutRole: "A question about this role, on another of its lines",
  noReject: "Nothing here would get the CV rejected on its own.",
  noWeak: "No weak achievement in your three most recent roles.",
  noQuestion: "No question is open for this line. If you have a figure for it, add it in the Builder.",
  answer: "Your answer (not yet on your CV)",
  masked: "Personal detail — not shown",
  gate: "gate",
  formula: "Formula (guidance only): action verb + what you did + result + business impact. The figure is yours to give; nothing is filled in.",
  act: {
    builder: "Fix in Builder →",
    draft: "Open this job's summary in Draft →",
    match: "Review the swap in Match →",
    answer: "Answer →",
    askAgain: "Ask again",
    use: "Use in Builder →",
  },
});

/** The verdict's colour: the review's own bands, already contrast-checked on the blueprint skin. */
export const VERDICT_COLOUR = deepFreeze({ shortlist: BAND.ready, maybe: BAND.after, skip: BAND.work });

/* ---------- title families ---------- */

/**
 * What kind of role a title names, with a rank for "most senior". The words
 * that set a seniority level in posting-keywords.js SENIORITY map onto these
 * families one for one (executive → exec, vp → vp, director → director,
 * head → head, lead and manager → manager, intern → entry; a test holds the two
 * tables together), so Match's Level and this judgement cannot contradict each
 * other. "chief" and the CxO words are exec; a bare "officer" is a working
 * title, not a C-level one, and "partner" counts only as managing, founding or
 * equity partner ("HR Business Partner" owns nothing).
 */
export const FAMILY = deepFreeze([
  { fam: "exec", rank: 7, terms: ["chief", "chief executive", "ceo", "coo", "cfo", "cto", "cmo", "cio", "cdo", "c-level", "managing director",
    "general manager", "geschäftsführer", "geschäftsführerin", "president", "chairman", "chairwoman", "chairperson", "vorsitzender",
    "vorsitzende", "md", "gm", "directeur général", "director general"] },
  { fam: "vp", rank: 6, terms: ["vice president", "vp", "svp", "evp", "vizepräsident", "vizepräsidentin"] },
  { fam: "owner", rank: 6, terms: ["founder", "co-founder", "owner", "co-owner", "inhaber", "inhaberin", "gründer", "gründerin", "mitgründer",
    "managing partner", "founding partner", "equity partner", "fondateur", "fondatrice", "fundador", "fundadora", "مؤسس", "مالك"] },
  { fam: "director", rank: 5, terms: ["director", "direktor", "direktorin", "directeur", "directrice", "directora"] },
  { fam: "head", rank: 5, terms: ["head of", "head", "leiter", "leiterin", "leitung", "رئيس"] },
  { fam: "manager", rank: 4, terms: ["manager", "managerin", "team lead", "lead", "teamleiter", "teamleiterin", "supervisor", "gérant", "gerente", "مدير"] },
  { fam: "advisor", rank: 3, terms: ["advisor", "adviser", "advisory", "consultant", "berater", "beraterin", "conseiller", "conseillère", "asesor", "مستشار"] },
  { fam: "officer", rank: 2, terms: ["officer"] },
  { fam: "staff", rank: 1, terms: ["specialist", "analyst", "engineer", "coordinator", "associate", "assistant", "executive", "representative",
    "administrator", "accountant", "controller", "auditor", "architect", "developer", "planner", "buyer", "trader", "referent", "sachbearbeiter",
    "kaufmann", "kauffrau"] },
  { fam: "entry", rank: 0, terms: ["intern", "internship", "trainee", "praktikant", "praktikantin", "praktikum", "werkstudent", "werkstudentin",
    "apprentice", "auszubildender", "auszubildende"] },
]);

/* Families a recruiter reads as the same kind of role. Symmetric. */
const NEAR_PAIRS = [["exec", "vp"], ["exec", "owner"], ["exec", "director"], ["exec", "head"], ["vp", "director"], ["vp", "head"], ["vp", "owner"],
  ["owner", "director"], ["owner", "head"], ["director", "head"], ["director", "manager"], ["head", "manager"], ["manager", "officer"],
  ["officer", "advisor"], ["officer", "staff"], ["staff", "entry"]];
export const NEAR = deepFreeze(Object.fromEntries(FAMILY.map((f) => [f.fam,
  NEAR_PAIRS.filter((p) => p.includes(f.fam)).map((p) => (p[0] === f.fam ? p[1] : p[0])).sort()])));
const close = (a, b) => a === b || (NEAR[a] || []).includes(b);

const FAM = Object.fromEntries(FAMILY.map((f) => [f.fam, f]));
/* Lookup key: lower case, hyphens and spaces out, so "Co-Founder", "co founder" and "cofounder" are one term. */
const famKey = (s) => low(s).replace(/[-‐\s]+/g, "");
const FAM_BY_KEY = new Map();
for (const f of FAMILY) for (const t of f.terms) FAM_BY_KEY.set(famKey(t), f);
const FAM_M = matcher(FAMILY.flatMap((f) => f.terms));
/* German compounds, as cv-review.js reads them for the headline check (its private
   SUFFIX): Vertriebsleiter, Unternehmensberater, Marketingdirektor. A -leiter
   compound is a head of function, as "Leiter" is in posting-keywords.js. */
const COMPOUND = [[/\p{L}{3,}(?:leiter|leiterin|leitung)$/u, "head"], [/\p{L}{3,}(?:berater|beraterin)$/u, "advisor"],
  [/\p{L}{3,}(?:direktor|direktorin)$/u, "director"], [/\p{L}{3,}(?:manager|managerin)$/u, "manager"]];

/**
 * Every family word in a text, in reading order.
 * @returns {{fam, rank, start, end, word}[]}
 */
export function familiesOf(text) {
  const t = str(text), out = [];
  const hits = FAM_M.all(t);
  let rest = t;
  for (const h of hits) {
    rest = rest.slice(0, h.start) + " ".repeat(h.end - h.start) + rest.slice(h.end);
    const f = FAM_BY_KEY.get(famKey(h.word));
    if (!f) continue;
    /* "Lead Generation Specialist" leads nobody. */
    if (famKey(h.word) === "lead" && /^\s+generation(?![\p{L}])/iu.test(t.slice(h.end))) continue;
    out.push({ fam: f.fam, rank: f.rank, start: h.start, end: h.end, word: h.word });
  }
  const re = /\p{L}+/gu;
  let m;
  while ((m = re.exec(rest))) {
    const c = COMPOUND.find(([rx]) => rx.test(low(m[0])));
    if (c) out.push({ fam: c[1], rank: FAM[c[1]].rank, start: m.index, end: m.index + m[0].length, word: m[0] });
  }
  return out.sort((a, b) => a.start - b.start || b.end - a.end);
}
const famSet = (text) => [...new Set(familiesOf(text).map((h) => h.fam))];

/* The title segment around a hit, bounded by the separators a headline uses, so a
   limiting word (Deputy, Assistant, Co-) that belongs to the title is inside it. */
const SEPS = [" · ", " | ", " – ", " — ", ", "];
function segmentOf(text, s, e) {
  const t = str(text);
  let a = 0, b = t.length;
  for (const sep of SEPS) {
    const i = s > 0 ? t.lastIndexOf(sep, s - 1) : -1;
    if (i >= 0 && i + sep.length <= s) a = Math.max(a, i + sep.length);
    const j = t.indexOf(sep, e);
    if (j >= 0) b = Math.min(b, j);
  }
  while (a < b && /\s/.test(t[a])) a++;
  while (b > a && /\s/.test(t[b - 1])) b--;
  return [a, b];
}

/* ---------- figures ---------- */

const CUR_BEFORE = /(?:aed|eur|usd|gbp|sar|chf|€|\$|£)\s?$/i;
const CUR_AFTER = /^\s?(?:aed|eur|usd|gbp|sar|chf)(?![\p{L}])/iu;
const UNIT_AFTER = /^\s?(?:%|k|m|mn|bn|mio|mrd|million|x)(?![\p{L}])/iu;
const isYearValue = (v) => /^\d{4}$/.test(v) && +v >= 1950 && +v <= 2039;

/**
 * Figure spans in a line, in reading order: years-of-experience claims (kind
 * "years") and magnitudes (kind "figure": a digit run not glued to a letter,
 * not a 1950–2039 year, not inside a date range, with its unit or currency).
 * Mirrors cv-review.js hasFigure(), which has no spans.
 * @returns {{start, end, kind:"years"|"figure"}[]}
 */
export function figureSpans(text) {
  const t = asciiDigits(text);
  const dates = findDateRanges(t);
  const claims = yearsClaims(t);
  const inside = (s, list) => list.some((r) => s >= r.start && s < r.end);
  const out = claims.map((y) => ({ start: y.start, end: y.end, kind: "years" }));
  const re = /\d[\d,.]*\d|\d/g;
  let m;
  while ((m = re.exec(t))) {
    const s = m.index;
    let e = s + m[0].length;
    if (s > 0 && /\p{L}/u.test(t[s - 1])) continue;
    if (e < t.length && /\p{L}/u.test(t[e]) && !UNIT_AFTER.test(t.slice(e))) continue;
    if (inside(s, dates) || inside(s, claims)) continue;
    if (isYearValue(m[0].replace(/[,.](?=\d{3}(?!\d))/g, ""))) continue;
    e += (UNIT_AFTER.exec(t.slice(e)) || [""])[0].length;
    let a = s;
    const pre = CUR_BEFORE.exec(t.slice(Math.max(0, s - 5), s));
    if (pre && !(s - pre[0].length > 0 && /\p{L}/u.test(t[s - pre[0].length - 1]))) a = s - pre[0].length;
    const post = CUR_AFTER.exec(t.slice(e));
    if (post) e += post[0].length;
    out.push({ start: a, end: e, kind: "figure" });
  }
  return out.sort((x, y) => x.start - y.start || y.end - x.end);
}

/* The first figure of a line and its first result figure (not a years claim).
   A figure hasFigure() sees but no span shows (a spelled "two stores") is the
   whole line, hit null. */
function lineFigures(text) {
  const spans = figureSpans(text);
  const years = spans.filter((s) => s.kind === "years");
  let blank = asciiDigits(text);
  for (const y of years) blank = blank.slice(0, y.start) + " ".repeat(y.end - y.start) + blank.slice(y.end);
  const res = spans.find((s) => s.kind === "figure") || (hasFigure(blank) ? { start: null, end: null, kind: "figure" } : null);
  const first = spans[0] || res;
  return { first: first || null, result: res };
}

/* ---------- the posting's term, as D's report counts it ---------- */

const WORD = /[\p{L}\p{N}]/u;
const JOIN = /[\p{L}\p{N}&-]/u;
const LOWER = /\p{Ll}/u;
const letterCount = (w) => (str(w).match(/\p{L}/gu) || []).length;
const isAcronymWord = (w) => letterCount(w) >= 2 && !LOWER.test(w);
const wordsRe = (s, flags) => new RegExp(escRe(squash(s)).replace(/ /g, "\\s+"), flags);

/**
 * Where the posting's term stands in a CV line, by the rule posting-keywords.js
 * uses for "in your CV in the posting's words": at a word start (never after a
 * letter, digit, & or -), and also ending at a word end when the term is short or
 * holds an acronym, so "negotiation" is in "negotiations" but "AI" is not in "AIM".
 * @returns {{start, end}|null}
 */
export function termAt(text, term) {
  const t = squash(term);
  if (!t) return null;
  const needEnd = t.length <= 3 || t.split(/[\s-]+/).some(isAcronymWord);
  const re = wordsRe(t, "giu"), hay = str(text);
  let m;
  while ((m = re.exec(hay))) {
    const s = m.index, e = s + m[0].length;
    if ((s > 0 && JOIN.test(hay[s - 1])) || (needEnd && e < hay.length && WORD.test(hay[e]))) { re.lastIndex = s + 1; continue; }
    return { start: s, end: e };
  }
  return null;
}

/* A must-have's `first` indexes the posting as posting-keywords.js reads it: the
   text alone when it already prints the title, else title + "\n" + text, with
   CR LF read as LF and the title's white space collapsed. Map it back to the raw
   strings passed, and quote the term only where it really stands. */
function rawIndexN(raw, n) {
  let k = 0;
  for (let i = 0; i < raw.length; i++) {
    if (k === n) return i;
    if (raw[i] === "\r" && raw[i + 1] === "\n") i++;
    k++;
  }
  return k === n ? raw.length : -1;
}
function rawIndexSq(raw, n) {
  let i = 0, k = 0;
  while (i < raw.length && /\s/.test(raw[i])) i++;
  while (i < raw.length) {
    if (k === n) return i;
    if (/\s/.test(raw[i])) while (i < raw.length && /\s/.test(raw[i])) i++;
    else i++;
    k++;
  }
  return -1;
}
function termQuote(posting, first, term) {
  const title = str(posting.title), text = str(posting.text), tSq = squash(title), textN = text.replace(/\r\n?/g, "\n");
  if (!squash(term)) return null;
  const at = (raw, i) => {
    if (i < 0) return null;
    const re = wordsRe(term, "uy");
    re.lastIndex = i;
    const m = re.exec(raw);
    return m && m[0].length ? { at: i, text: m[0] } : null;
  };
  let hit = null;
  if (Number.isInteger(first) && first >= 0) {
    const inText = !tSq || (low(squash(textN)).includes(low(tSq)) && wordsRe(tSq, "iu").test(textN));
    const [path, raw, i] = inText ? ["posting.text", text, rawIndexN(text, first)]
      : first < tSq.length ? ["posting.title", title, rawIndexSq(title, first)]
      : ["posting.text", text, rawIndexN(text, first - tSq.length - 1)];
    const h = at(raw, i);
    if (h) hit = { path, ...h };
  }
  if (!hit) {
    for (const [path, raw] of [["posting.title", title], ["posting.text", text]]) {
      const m = wordsRe(term, "u").exec(raw) || wordsRe(term, "iu").exec(raw);
      if (m && m[0].length) { hit = { path, at: m.index, text: m[0] }; break; }
    }
  }
  return hit ? { path: hit.path, at: hit.at, text: hit.text, hit: [0, hit.text.length] } : null;
}

/* ---------- recency ---------- */

/**
 * Role indices, most recent first: the order cv-review.js context() ranks roles
 * in (readable roles by end, then start, newest first; an unreadable role right
 * after the last readable role stored before it). A test holds the two together
 * through the review's question ranks.
 */
export function recencyOrder(P, today) {
  const exp = Array.isArray((P || {}).experience) ? P.experience : [];
  const T = today && today.y ? idx(+today.y, +today.m || 1) : idx(9999, 12);
  const early = (s) => (s.open ? T : idx(s.y, s.m || 1));
  const late = (s) => (s.open ? T : idx(s.y, s.m || 12));
  const roles = exp.map((e, i) => { const pd = parseDates(str((e || {}).d)); return { i, pd, readable: !!(pd.from && !pd.from.open) }; });
  const order = roles.filter((r) => r.readable).sort((a, b) => late(b.pd.to) - late(a.pd.to) || early(b.pd.from) - early(a.pd.from) || a.i - b.i);
  for (const r of roles.filter((x) => !x.readable)) {
    const prev = roles.slice(0, r.i).reverse().find((x) => x.readable);
    order.splice(prev ? order.indexOf(prev) + 1 : 0, 0, r);
  }
  return order.map((r) => r.i);
}

/* ---------- the top of page 1 ---------- */

const SUM_ORDER = ["en", "de", "ar", "fr", "es"];

/**
 * The lines of the CV in print order, each tied to the field it prints from.
 * CV mode (no opts.printed): P as the CV Builder prints it, in stored order.
 * Posting mode (opts.printed): this job's Draft. A printed line that is not a
 * field of P, exactly, is own:false: never quoted, never scanned, never judged.
 * @returns {{mode, L, jid, name, headline, city, phone, email, workRights, wrText,
 *   s1, role, bullets, top:Line[], lower:Line[], roles}}
 *   Line = {path, at, text, kind, own, role?, bullet?, template?, swapped?, x?}
 */
export function topOf(P, opts = {}) {
  P = P && typeof P === "object" ? P : {};
  const o = opts && typeof opts === "object" ? opts : {};
  const edits = o.edits && typeof o.edits === "object" ? o.edits : {};
  const L = low(o.lang || "en") || "en";
  const real = !!(o.real !== undefined ? o.real : o.hasReal);
  const pr = o.printed && typeof o.printed === "object" ? o.printed : null;
  const jid = pr && pr.jid !== undefined ? str(pr.jid) : "";
  const exp = Array.isArray(P.experience) ? P.experience : [];
  const V = (path) => valueAt(P, path, edits);
  const line = (path, kind, extra = {}) => ({ path, at: 0, text: V(path), kind, own: true, ...extra });
  const none = (kind, extra = {}) => ({ path: "", at: -1, text: "", kind, own: false, ...extra });

  /* The header, as cv-review.js context() reads it: an override in edits wins. */
  const over = (k) => (edits[k] !== undefined ? "edits." + k : k);
  const T_ = P.title || {};
  const hlPaths = [...new Set(["title." + L, "title.en", "title.de", ...Object.keys(T_).sort().map((k) => "title." + k)])];
  let headline;
  if (pr && pr.headline !== undefined) {
    const want = str(pr.headline);
    const p = [...hlPaths, "experience.0.t"].find((x) => want.trim() && V(x) === want);
    headline = p ? line(p, "headline") : none("headline", { printed: want });
  } else {
    const p = [str(T_[L]).trim() && "title." + L, str(T_.en).trim() && "title.en", str(T_.de).trim() && "title.de",
      exp[0] && str(exp[0].t).trim() && "experience.0.t"].find(Boolean);
    headline = p ? line(p, "headline") : none("headline");
  }
  const wrText = o.workRights !== undefined ? str(o.workRights) : str(P.workRights || (!real ? P.nationality : "") || "").trim();
  const wrPath = P.workRights ? "workRights" : !real && P.nationality ? "nationality" : "workRights";
  const wrAt = wrText.trim() ? V(wrPath).indexOf(wrText) : -1;
  const workRights = wrAt >= 0 ? { path: wrPath, at: wrAt, text: wrText, kind: "workRights", own: true } : none("workRights", { path: wrPath });

  /* The summary: the first sentence is what the eye reads; the rest is lower down. */
  let sumPath = "", sumText = "";
  if (pr && pr.summary !== undefined) {
    const s1 = sentences(pr.summary)[0] || "";
    const paths = [...new Set([jid && edits["sum_" + jid] !== undefined ? "edits.sum_" + jid : "", "summary." + L,
      ...SUM_ORDER.map((k) => "summary." + k), ...Object.keys(P.summary || {}).sort().map((k) => "summary." + k)].filter(Boolean))];
    const p = s1 && paths.find((x) => V(x).includes(s1));
    if (p) { sumPath = p; sumText = str(pr.summary); }
    else if (s1) sumPath = "?";
  } else { sumPath = "summary." + L; sumText = V(sumPath); }
  const sums = [];
  if (sumPath && sumPath !== "?") {
    const field = V(sumPath);
    let from = 0;
    for (const s of sentences(sumText)) {
      const at = field.indexOf(s, from);
      if (at < 0) { sums.push(none("summary")); continue; }
      sums.push({ path: sumPath, at, text: s, kind: "summary", own: true });
      from = at + s.length;
    }
  } else if (sumPath === "?") sums.push(none("summary"));

  /* Roles: resolved to P by their exact title, employer and dates (first unused
     match, so two identical entries map to two roles), bullets by their exact text.
     An approved keyword swap prints {x, x0}: it resolves on x0, the candidate's line. */
  const usedRoles = new Set();
  const roleLines = (pr ? (Array.isArray(pr.roles) ? pr.roles : []) : exp.map((e) => e || {})).map((r, pos) => {
    r = r && typeof r === "object" ? r : {};
    const t = str(r.t), c = str(r.c), d = str(r.d);
    const i = pr ? exp.findIndex((e, k) => !usedRoles.has(k) && e && str(e.t) === t && str(e.c) === c && str(e.d) === d) : pos;
    if (i >= 0) usedRoles.add(i);
    const src = i >= 0 && Array.isArray(exp[i].bullets) ? exp[i].bullets : [];
    const usedB = new Set();
    const bullets = (Array.isArray(r.bullets) ? r.bullets : []).map((b, pj) => {
      const x = typeof b === "string" ? b : str(b && b.x);
      const x0 = typeof b === "string" ? b : b && typeof b.x0 === "string" ? b.x0 : x;
      const j = i < 0 ? -1 : pr ? src.findIndex((sb, k) => !usedB.has(k) && str(sb && sb.x) === x0) : pj;
      if (j < 0) return none("bullet", { role: i });
      usedB.add(j);
      const path = `experience.${i}.bullets.${j}`;
      return { path, at: 0, text: V(path), kind: "bullet", own: true, role: i, bullet: j, template: !!(src[j] && src[j].ach), swapped: x !== x0, x };
    });
    const f = (k) => (i >= 0 ? line(`experience.${i}.${k}`, k, { role: i }) : none(k, { role: i }));
    return { i, pos, t: f("t"), c: f("c"), d: f("d"), bullets };
  });
  const role = roleLines[0] || null;
  const bullets = role ? role.bullets.slice(0, 2) : [];

  /* Skills and languages print lower down; a keyword may stand there. */
  const comps = Array.isArray(P.competencies) ? P.competencies : [];
  const usedC = new Set();
  const skillNames = pr && Array.isArray(pr.skills) ? pr.skills.map(str) : comps.map((c) => str((c || [])[0]));
  const skills = skillNames.map((n) => {
    const k = comps.findIndex((c, q) => !usedC.has(q) && str((c || [])[0]) === n);
    if (k < 0 || !n.trim()) return none("skill");
    usedC.add(k);
    return line(`competencies.${k}.0`, "skill");
  });
  const langs = str(P.langs).trim() ? line("langs", "langs") : null;

  const s1 = sums[0] || null;
  const top = [headline, s1, role && role.t, role && role.c, ...bullets].filter(Boolean);
  const lower = [...sums.slice(1), ...(role ? role.bullets.slice(2) : []),
    ...roleLines.slice(1).flatMap((r) => [r.t, r.c, ...r.bullets]), ...skills, ...(langs ? [langs] : [])];
  return {
    mode: pr ? "posting" : "cv", L, jid, real, name: line(over("name"), "name"), headline, city: line(over("city"), "city"),
    phone: line(over("phone"), "phone"), email: line(over("email"), "email"), workRights, wrText, s1, role, bullets, top, lower, roles: roleLines,
  };
}

/* ---------- the engine ---------- */

const PD_CHECKS = new Set(["HDR-06", "HDR-07", "HDR-08", "HDR-09", "HDR-10", "HDR-12"]);
const SEV_RANK = { high: 0, med: 1, low: 2 };

/* Where a path prints on the page, for "reading order" among equals. */
function posOf(path, printPos) {
  const p = str(path);
  const H = { name: 0, "edits.name": 0, email: 2, "edits.email": 2, phone: 3, "edits.phone": 3, city: 4, "edits.city": 4, workRights: 5, nationality: 5, cvStyle: 6 };
  let m;
  if (Object.prototype.hasOwnProperty.call(H, p)) return H[p];
  if (/^title\./.test(p)) return 1;
  if (/^summary\./.test(p)) return 10;
  if (/^edits\.sum_/.test(p)) return 11;
  if (p === "experience") return 20;
  if ((m = /^experience\.(\d+)\.(t|c|d)$/.exec(p))) return 1000 + 1000 * printPos(+m[1]) + { t: 1, c: 2, d: 3 }[m[2]];
  if ((m = /^experience\.(\d+)\.bullets\.(\d+)$/.exec(p))) return 1000 + 1000 * printPos(+m[1]) + 10 + +m[2];
  if ((m = /^experience\.(\d+)/.exec(p))) return 1000 + 1000 * printPos(+m[1]);
  if ((m = /^competencies\.(\d+)/.exec(p))) return 1e7 + +m[1];
  if (p === "competencies") return 1e7;
  if (p === "langs") return 1.1e7;
  if (/^education/.test(p)) return 1.2e7;
  if (/^refs/.test(p)) return 1.3e7;
  return 2e7;
}

const Q = (path, at, text, hit) => ({ path, at, text: str(text), hit: hit && hit[1] > hit[0] ? [hit[0], hit[1]] : null });

/**
 * firstGlance(P, review, opts) — the first six seconds of a recruiter's read.
 *
 * @param P       the portal profile (never changed)
 * @param review  reviewCV(P, opts) (never changed)
 * @param opts    the same object reviewCV got (lang, today, edits, workRights, real …), plus
 *   printed  posting mode: what this job's Draft prints, {jid, headline, summary,
 *            roles:[{t,c,d,bullets:[string|{x,x0}]}], skills?:[string]}, i.e.
 *            ownHeadline(), summaryOf(A), A.keep in print order with bullets in
 *            relevance order (an approved swap as {x, x0}), A.comps names.
 *   posting  {title, text, report?, blockers?}. title is the exact string also given
 *            to keywordReport (the page passes roleOf(j), which role-title.js derives
 *            from j.r, so it is not a slice of j.r); every "posting.title" Quote slices
 *            it. report is posting-keywords.js keywordReport(): the one must-have list
 *            and evidence rule Match shows. blockers is assessFit().blockers; only
 *            each blocker's `why` is read, never the posting line (it may carry age or
 *            gender wording).
 * @returns Glance, where Quote = {path, at, text, hit:[s,e]|null, masked?:true} and
 *   Act = {to:"builder"|"draft"|"match", step?, path?, label, scope?} (scope only in posting mode):
 *   { mode:"cv"|"posting", scope:LABELS.scope.top, formula:LABELS.formula,
 *     target:{source:"headline"|"posting", quote:Quote|null, family:string[]},
 *     top:{name, headline, city, workRights, summary:Quote|null, workRightsPresent:boolean,
 *          role:{i, t, c, d}|null, bullets:Quote[]},
 *     verdict:"shortlist"|"maybe"|"skip",
 *     reasons:[{code:"V-GATE"|"V-BLOCK"|"V-TOP"|"V-TITLE"|"V-CURRENT"|"V-FIG"|"V-MUST", ok, label, check?, path?, notes?}],
 *     catches:[{code:"C-TITLE"|"C-FIG"|"C-RESULT"|"C-CURRENT", label, quote, kind?:"years"|"figure"}],
 *     kills:[{code, label, sev, check?, key?, gate?, title?, why?, fix, step, path?, quote, note?, act, top,
 *             against?:{label, quote}, alt?:{label, quote}}],            K-REJECT first when card B has an item
 *     reject:{check, sev, gate, title, why, fix, step, key, path, quote, note, act, top}|null,
 *     weakest:[{quote, role, bullet, why:("BUL-04"|"BUL-05"|"no-figure")[], act,
 *               question:{key, id, check, text, state:"open"|"answered"|"skipped", more, path,
 *                         about:"line"|"role", answer?, label?, quote?}|null}],
 *     callNow:[{k, term:Quote|null, must, state:"keep"|"move"|"in-cv"|"swap"|"other-words"|"gap"|"unchecked",
 *               label, quote:Quote|null, swapped?, top?, act:Act|null}] }   [] without a report
 */
export function firstGlance(P, review, opts = {}) {
  P = P && typeof P === "object" ? P : {};
  const o = opts && typeof opts === "object" ? opts : {};
  const R = review && typeof review === "object" ? review : {};
  const edits = o.edits && typeof o.edits === "object" ? o.edits : {};
  const L = low(R.lang || o.lang || "en") || "en";
  const top = topOf(P, { ...o, lang: L });
  const posting = o.posting && typeof o.posting === "object" ? o.posting : null;
  const mode = posting ? "posting" : "cv";
  const exp = Array.isArray(P.experience) ? P.experience : [];
  const order = recencyOrder(P, o.today);
  const rankOf = new Map(order.map((i, k) => [i, k]));
  const printedIdx = top.roles.map((r) => r.i).filter((i) => i >= 0);
  const printPos = (i) => (top.mode === "posting" ? (printedIdx.indexOf(i) >= 0 ? printedIdx.indexOf(i) : 999) : i);
  const topRole = top.role && top.role.i >= 0 ? top.role.i : -1;
  const V = (path) => valueAt(P, path, edits);

  /* Live instances: failing, not checked by the candidate, not waiting for the Builder. */
  const live = [];
  (Array.isArray(R.checks) ? R.checks : []).forEach((k, ci) => {
    if (!k || k.status !== "fail") return;
    (k.instances || []).forEach((i, ii) => { if (i && !i.acked && !i.later) live.push({ k, i, ci, ii }); });
  });
  const firstEv = (x) => (x.i.evidence || [])[0] || {};

  /* Personal data: every span a live privacy check found. */
  const pd = [];
  for (const x of live) if (PD_CHECKS.has(x.k.id)) for (const e of x.i.evidence || []) {
    if (!e || !e.path) continue;
    const t = str(e.text);
    pd.push(e.hit ? { path: e.path, s: e.hit[0], e: e.hit[1], text: t.slice(e.hit[0], e.hit[1]) } : { path: e.path, s: 0, e: Infinity, text: t });
  }
  const pdTexts = [...new Set(pd.map((x) => low(x.text).trim()).filter(Boolean))];
  const maskQ = (q) => {
    if (!q) return q;
    const n = Math.max(1, q.text.length);
    return pd.some((x) => x.path === q.path && x.s < q.at + n && q.at < x.e) ? { path: q.path, at: q.at, text: "", hit: null, masked: true } : q;
  };
  const isMasked = (ln) => !!(ln && ln.own && maskQ(Q(ln.path, ln.at, ln.text, null)).masked);
  /* A string copied from the review (a note, a question, an answer) that holds a masked span is not shown. */
  const safe = (s) => { const l = low(s); return pdTexts.some((t) => l.includes(t)) ? LABELS.masked : str(s); };
  const lineQ = (ln, hit) => (ln && ln.own ? maskQ(Q(ln.path, ln.at, ln.text, hit)) : null);

  /* Posting mode: only what this job's CV prints counts. */
  const printedSet = new Set(printedIdx);
  const visible = (x) => {
    if (top.mode !== "posting") return true;
    if (x.i.role !== undefined && !printedSet.has(x.i.role)) return false;
    return (x.i.evidence || []).every((e) => {
      const p = str(e && e.path);
      const m = /^experience\.(\d+)/.exec(p);
      if (m && !printedSet.has(+m[1])) return false;
      return !/^edits\.sum_/.test(p) || p === "edits.sum_" + top.jid;
    });
  };
  const shown = live.filter(visible);

  /* Is a path in the top third? */
  const headerPaths = new Set([top.name.path, top.headline.path, top.city.path, top.phone.path, top.email.path, top.workRights.path].filter(Boolean));
  const topPaths = new Set([...headerPaths, ...(top.role ? [top.role.t, top.role.c, top.role.d] : []).filter((l) => l.own).map((l) => l.path),
    ...top.bullets.filter((b) => b.own).map((b) => b.path)]);
  const isTop = (path, hit) => {
    if (topPaths.has(path)) return true;
    const s = top.s1;
    if (s && s.own && s.path === path) return !hit || (hit[0] < s.at + s.text.length && s.at < hit[1]);
    return false;
  };

  const act = (step, path) => ({ to: "builder", step: str(step), path: str(path), label: LABELS.act.builder, ...(mode === "posting" ? { scope: LABELS.scope.master } : {}) });
  const evQuote = (x) => {
    const e = firstEv(x);
    if (!e.path || !str(e.text)) return null;
    const v = V(e.path), at = v === str(e.text) ? 0 : v.indexOf(str(e.text));
    return at < 0 ? null : maskQ(Q(e.path, at, e.text, e.hit));
  };
  const fromInst = (code, x) => {
    const e = firstEv(x);
    return {
      code, label: LABELS.kill[code], sev: x.i.sev, check: x.k.id, key: str(x.i.key), gate: !!x.k.gate, title: str(x.k.title), path: str(e.path),
      quote: evQuote(x), note: e.note ? safe(e.note) : "", why: str(x.k.rule), fix: str(x.k.fix), step: str(x.k.builderStep),
      act: act(x.k.builderStep, e.path), top: isTop(str(e.path), e.hit),
    };
  };
  const secIdx = (x) => { const k = SECTIONS.indexOf(x.k.section); return k < 0 ? 99 : k; };
  const byOrder = (a, b) => SEV_RANK[a.i.sev] - SEV_RANK[b.i.sev] || secIdx(a) - secIdx(b)
    || posOf(firstEv(a).path, printPos) - posOf(firstEv(b).path, printPos) || a.ci - b.ci || a.ii - b.ii;

  /* ----- B: what gets you rejected ----- */
  /* A gate first; else the most severe item in reading order. A "Consider" item alone
     does not get a CV rejected, so it never takes this place. */
  const gates = shown.filter((x) => x.k.gate && x.i.sev === "high").sort(byOrder);
  const pool = gates.length ? gates : shown.filter((x) => x.i.sev === "high" || x.i.sev === "med").sort(byOrder);
  const rj = pool[0] ? fromInst("K-REJECT", pool[0]) : null;
  const reject = rj ? { check: rj.check, sev: rj.sev, gate: rj.gate, title: rj.title, why: rj.why, fix: rj.fix, step: rj.step, key: rj.key,
    path: rj.path, quote: rj.quote, note: rj.note, act: rj.act, top: rj.top } : null;

  /* ----- A: the top third ----- */
  /* One item is listed once: when card B's item is also a top-third problem, it stays
     K-REJECT with top: true. */
  const kills = [];
  const seen = new Set();
  const addKill = (k) => {
    const id = (k.check || k.code) + "|" + (k.path || (k.quote ? k.quote.path : ""));
    if (seen.has(id)) return;
    seen.add(id);
    kills.push(k);
  };
  if (rj) addKill(rj);
  const liveOf = (id) => shown.filter((x) => x.k.id === id).sort(byOrder);

  for (const x of liveOf("HDR-05")) addKill(fromInst("TOP-WR", x));
  for (const x of liveOf("HL-01")) addKill(fromInst("TOP-HL", x));

  /* The headline against the target: the posting's title, or (CV mode) the latest role's title. */
  const hl = top.headline.own && !isMasked(top.headline) ? top.headline : null;
  const target = mode === "posting"
    ? { source: "posting", quote: str(posting.title).trim() ? Q("posting.title", 0, posting.title, null) : null, family: famSet(posting.title) }
    : { source: "headline", quote: hl ? lineQ(hl, null) : null, family: hl ? famSet(hl.text) : [] };
  const other = mode === "posting" ? (hl ? famSet(hl.text) : []) : (top.role && top.role.t.own ? famSet(top.role.t.text) : []);
  if (hl && target.family.length && other.length && !target.family.some((a) => other.some((b) => close(a, b)))) {
    const want = target.family;
    let alt = null;
    for (const i of order) {
      const t = str((exp[i] || {}).t);
      const h = familiesOf(t).find((f) => want.some((w) => close(w, f.fam)));
      if (h) { alt = { label: LABELS.alt, quote: maskQ(Q(`experience.${i}.t`, 0, t, segmentOf(t, h.start, h.end))) }; break; }
    }
    const first = familiesOf(hl.text)[0];
    addKill({
      code: "TOP-HL-FAMILY", label: LABELS.kill["TOP-HL-FAMILY"], sev: "med", quote: lineQ(hl, first ? segmentOf(hl.text, first.start, first.end) : null),
      against: mode === "posting" ? { label: LABELS.targetLine, quote: target.quote } : { label: LABELS.latestTitle, quote: lineQ(top.role.t, null) },
      fix: LABELS.fix.family, step: "headline", act: act("headline", hl.path), alt, top: true,
    });
  }
  if (hl && hl.text.trim() && !familiesOf(hl.text).length && !TITLE_WORDS.test(hl.text)) {
    addKill({ code: "TOP-HL-NOROLE", label: LABELS.kill["TOP-HL-NOROLE"], sev: "med", quote: lineQ(hl, null), fix: LABELS.fix.norole, step: "headline",
      act: act("headline", hl.path), top: true });
  }
  if (topRole >= 0) {
    const dPath = `experience.${topRole}.d`;
    for (const id of ["EXP-09", "EXP-04", "EXP-12"]) for (const x of liveOf(id)) {
      if ((x.i.evidence || []).some((e) => e && e.path === dPath)) addKill({ ...fromInst("TOP-DATES", x), top: true });
    }
  }
  if (top.mode === "cv") for (const x of liveOf("EXP-07")) if (firstEv(x).path === "experience.0.d") addKill({ ...fromInst("TOP-ORDER", x), top: true });
  const s1 = top.s1;
  if (s1 && s1.own && !isMasked(s1) && s1.text.trim() && !TITLE_WORDS.test(s1.text) && !familiesOf(s1.text).length) {
    addKill({ code: "TOP-SUM", label: LABELS.kill["TOP-SUM"], sev: "med", quote: lineQ(s1, null), fix: LABELS.fix.sum, step: "summary",
      act: act("summary", s1.path), top: true });
  }
  if (!s1 || (s1.own && !s1.text.trim())) for (const x of liveOf("SUM-01")) addKill({ ...fromInst("TOP-SUM", x), top: true });
  for (const x of shown.filter((y) => y.i.sev === "high").sort(byOrder)) {
    const e = firstEv(x);
    if (isTop(str(e.path), e.hit)) addKill({ ...fromInst("TOP-HIGH", x), top: true });
  }

  /* ----- what the eye lands on ----- */
  const junk = new Set(shown.filter((x) => x.k.id === "BUL-08" || x.k.id === "BUL-09").flatMap((x) => (x.i.evidence || []).slice(0, 1).map((e) => e.path)));
  const usable = (ln) => ln && ln.own && !ln.template && !isMasked(ln) && str(ln.text).trim() && !junk.has(ln.path);
  const catches = [];
  const titled = [hl, top.role && top.role.t].filter((l) => l && usable(l));
  let best = null;
  titled.forEach((l, k) => familiesOf(l.text).forEach((h) => { if (!best || h.rank > best.h.rank) best = { l, h, k }; }));
  if (best) catches.push({ code: "C-TITLE", label: LABELS.catch["C-TITLE"], quote: lineQ(best.l, segmentOf(best.l.text, best.h.start, best.h.end)) });
  /* Figures are credited only from the candidate's own claim lines: the headline, the
     first summary sentence and the first two bullets — never the city, the work
     rights, the employer, the title or the dates, never a template line, and never a
     line the review reads as a company description or a stray header. */
  const figLines = [hl, s1, ...top.bullets].filter(usable);
  let cFig = null, cRes = null;
  for (const l of figLines) {
    const f = lineFigures(l.text);
    if (!cFig && f.first) cFig = { l, s: f.first };
    if (!cRes && f.result) cRes = { l, s: f.result };
  }
  const figQ = (x) => lineQ(x.l, x.s.start === null ? null : [x.s.start, x.s.end]);
  if (cFig) catches.push({ code: "C-FIG", label: LABELS.catch["C-FIG"], quote: figQ(cFig), kind: cFig.s.kind });
  if (cFig && cFig.s.kind === "years" && cRes) catches.push({ code: "C-RESULT", label: LABELS.catch["C-RESULT"], quote: figQ(cRes), kind: "figure" });
  const dLine = top.role && top.role.d.own ? top.role.d : null;
  if (dLine && !isMasked(dLine)) {
    const pdd = parseDates(dLine.text);
    if (pdd.to && pdd.to.open) {
      const at = asciiDigits(dLine.text).lastIndexOf(str(pdd.to.text));
      catches.push({ code: "C-CURRENT", label: LABELS.catch["C-CURRENT"], quote: lineQ(dLine, at >= 0 ? [at, at + str(pdd.to.text).length] : null) });
    }
  }

  /* ----- call now: the posting's must-haves (posting-keywords.js report) ----- */
  const callNow = [];
  const report = posting && posting.report && Array.isArray(posting.report.must) ? posting.report : null;
  if (report) {
    const topLines = top.top.filter((l) => l.own && !l.template && !isMasked(l));
    const lowLines = top.lower.filter((l) => l.own && !l.template && !isMasked(l));
    const swapsOf = (key) => (Array.isArray(report.swaps) ? report.swaps : []).filter((s) => s && s.key === key);
    const roleOfLine = (l) => (l.role !== undefined && l.role >= 0 ? exp[l.role] || {} : null);
    const sameRole = (l, ref) => { const e = roleOfLine(l); return !!(e && ref && str(e.t) === str(ref.t) && str(e.c) === str(ref.c) && (ref.d === undefined || str(e.d) === str(ref.d))); };
    const synHit = (s) => (str(s.before).substr(s.at, str(s.synonym).length) === str(s.synonym) ? [s.at, s.at + str(s.synonym).length] : null);
    for (const m of report.must) {
      if (!m || typeof m !== "object") continue;
      const item = { k: str(m.key), term: termQuote(posting, m.first, m.term), must: !!m.must, state: "unchecked", quote: null, act: null };
      const find = () => {
        for (const [zone, lines] of [["keep", topLines], ["move", lowLines]]) for (const l of lines) {
          const h = termAt(l.text, m.term);
          if (h) return { state: zone, quote: lineQ(l, [h.start, h.end]) };
          /* An approved swap printed the posting's word into this line: quote the
             candidate's own line (x0), never the swapped text, and mark it. */
          if (l.swapped && termAt(l.x, m.term)) {
            const s = swapsOf(m.key).find((w) => str(w.before) === l.text);
            return { state: zone, quote: lineQ(l, s ? synHit(s) : null), swapped: true };
          }
        }
        return null;
      };
      if (m.state === "in-cv" || m.state === "swap") {
        const f = find();
        if (f) Object.assign(item, f);
        else if (m.state === "swap") {
          const s = swapsOf(m.key).find((w) => w.needed !== false) || swapsOf(m.key)[0];
          const l = s ? [...topLines, ...lowLines].find((x) => x.kind === "bullet" && x.text === str(s.before) && sameRole(x, s.role)) : null;
          Object.assign(item, { state: "swap", quote: l ? lineQ(l, synHit(s)) : null });
        } else item.state = "in-cv";
      } else if (m.state === "other-words") {
        const ev = m.evidence && typeof m.evidence === "object" ? m.evidence : {};
        const text = str(ev.text);
        let l = null, at = -1;
        if (ev.ref && typeof ev.ref === "object") l = [...topLines, ...lowLines].find((x) => (x.kind === "bullet" || x.kind === "t" || x.kind === "c") && x.text === text && sameRole(x, ev.ref));
        else if (ev.ref === "skills") l = lowLines.find((x) => x.kind === "skill" && x.text === text);
        else if (ev.ref === "headline") l = topLines.find((x) => x.kind === "headline" && x.text === text);
        else if (ev.ref === "langs") l = lowLines.find((x) => x.kind === "langs" && x.text === text);
        else if (ev.ref === "summary" && s1 && s1.own && text) {
          const v = V(s1.path);
          at = v.indexOf(text);
          if (at >= 0) l = { path: s1.path, at, text, own: true, kind: "summary" };
        }
        Object.assign(item, { state: "other-words", quote: l ? lineQ(l, null) : null });
        if (l) item.top = l.kind === "summary" ? at < s1.at + s1.text.length : topLines.includes(l);
      } else if (m.state === "gap") item.state = "gap";
      if (item.state === "keep" || item.state === "move") item.top = item.state === "keep";
      item.label = item.swapped ? LABELS.call.swapped : LABELS.call[item.state];
      if (item.state === "move") item.act = { to: "draft", label: LABELS.act.draft, scope: LABELS.scope.job };
      if (item.state === "swap") item.act = { to: "match", label: LABELS.act.match, scope: LABELS.scope.job };
      callNow.push(item);
    }
  }

  /* ----- B: the three weakest achievements ----- */
  const pdPaths = new Set(pd.map((x) => x.path));
  const instOn = (id, path) => shown.filter((x) => x.k.id === id && (x.i.evidence || []).some((e, n) => n === 0 && e.path === path)).sort(byOrder);
  const qs = Array.isArray(R.questions) ? R.questions : [];
  const cands = [];
  const roleSet = top.mode === "posting" ? printedIdx : exp.map((e, i) => i);
  for (const i of roleSet) {
    const rank = rankOf.has(i) ? rankOf.get(i) : 99;
    if (rank > 2) continue;
    const bs = Array.isArray((exp[i] || {}).bullets) ? exp[i].bullets : [];
    bs.forEach((b, j) => {
      const path = `experience.${i}.bullets.${j}`, x = str(b && b.x);
      if (!b || b.ach || !x.trim() || junk.has(path) || pdPaths.has(path)) return;
      const why = [], b4 = instOn("BUL-04", path), b5 = instOn("BUL-05", path);
      if (b4.length) why.push("BUL-04");
      if (b5.length) why.push("BUL-05");
      if (!hasFigure(x)) why.push("no-figure");
      if (!why.length) return;
      const e = (b5[0] || b4[0]) ? firstEv(b5[0] || b4[0]) : null;
      cands.push({ i, j, rank, path, x, why, hit: e && e.hit ? e.hit : null });
    });
  }
  cands.sort((a, b) => a.rank - b.rank || b.why.length - a.why.length || a.j - b.j || a.i - b.i);
  const picked = cands.slice(0, 3);
  const qOf = (q, about) => ({
    key: str(q.key), id: str(q.id), check: str(q.check), text: safe(q.question), state: str(q.state), more: !!q.more, path: str(q.path), about,
    ...(q.state === "answered" ? { answer: safe(q.answer) } : {}),
  });
  /* A line's own question is the review's first figure question on that exact line.
     Only then, and only once per question, a figure question the review asks about
     another line of the same role: it is shown with that line's quote, so an answer
     is never read as belonging to the wrong bullet. A question about a line that is
     itself in this list stays with that line (a second one waits in the Questions
     aside). No question is ever made here. */
  const ownQ = picked.map((c) => qs.find((q) => q && q.figure && q.path === c.path) || null);
  const usedQ = new Set(ownQ.filter(Boolean).map((q) => q.key));
  const pickedPaths = new Set(picked.map((c) => c.path));
  const weakest = picked.map((c, n) => {
    let question = ownQ[n] ? qOf(ownQ[n], "line") : null;
    if (!question) {
      const rq = qs.find((q) => q && q.figure && q.check === "MET-02" && q.role === c.i && !usedQ.has(q.key) && !pickedPaths.has(str(q.path)));
      if (rq) {
        usedQ.add(rq.key);
        const v = V(rq.path);
        question = { ...qOf(rq, "role"), label: LABELS.aboutRole, quote: v ? maskQ(Q(str(rq.path), 0, v, null)) : null };
      }
    }
    return { quote: maskQ(Q(c.path, 0, c.x, c.hit)), role: c.i, bullet: c.j, why: c.why, question, act: act("experience", c.path) };
  });

  /* ----- reasons and the verdict ----- */
  const blockers = posting && Array.isArray(posting.blockers) ? posting.blockers.filter((b) => b && typeof b === "object") : [];
  const reason = (code, ok, extra = {}) => ({ code, ok, label: LABELS.reason[code][ok ? "ok" : "bad"], ...extra });
  const reasons = [];
  /* The review's gate, over what this job's CV prints: a must-fix item on a role the
     posting's CV leaves out does not stop this one (in CV mode this is review.gated). */
  const gatedShown = shown.some((x) => x.k.gate && x.i.sev === "high");
  const gated = top.mode === "posting" ? gatedShown : !!R.gated || gatedShown;
  reasons.push(reason("V-GATE", !gated, reject && reject.gate ? { check: reject.check, path: reject.path } : {}));
  if (mode === "posting") reasons.push(reason("V-BLOCK", !blockers.length, blockers.length ? { notes: blockers.map((b) => safe(b.why)).filter(Boolean) } : {}));
  const topCodes = new Set(["TOP-WR", "TOP-HL", "TOP-DATES", "TOP-ORDER", "TOP-SUM", "TOP-HIGH"]);
  const topKill = kills.find((k) => topCodes.has(k.code) || (k.code === "K-REJECT" && k.top));
  reasons.push(reason("V-TOP", !topKill, topKill ? { check: topKill.check || topKill.code, path: topKill.quote ? topKill.quote.path : "" } : {}));
  const titleKill = kills.find((k) => k.code === "TOP-HL-FAMILY" || k.code === "TOP-HL-NOROLE");
  reasons.push(reason("V-TITLE", !titleKill, titleKill ? { check: titleKill.code, path: titleKill.quote ? titleKill.quote.path : "" } : {}));
  const cur = catches.find((c) => c.code === "C-CURRENT");
  const gapNow = topRole >= 0 && liveOf("EXP-09").find((x) => (x.i.evidence || []).length === 1 && firstEv(x).path === `experience.${topRole}.d`);
  reasons.push(reason("V-CURRENT", !!cur, cur ? {} : { path: topRole >= 0 ? `experience.${topRole}.d` : "experience", ...(gapNow ? { check: "EXP-09" } : {}) }));
  const cf = catches.find((c) => c.code === "C-FIG");
  const figOk = !!((cf && cf.kind !== "years") || catches.some((c) => c.code === "C-RESULT"));
  const metQ = qs.find((q) => q && q.check === "MET-02" && q.role === topRole);
  reasons.push(reason("V-FIG", figOk, figOk ? {} : metQ ? { check: "MET-02", path: str(metQ.path) } : { check: "MET-01", path: "experience" }));
  const judged = callNow.filter((c) => c.state !== "unchecked");
  if (judged.length) {
    const keep = callNow.filter((c) => c.state === "keep").length;
    reasons.push(reason("V-MUST", keep >= Math.min(2, judged.length)));
  }
  const allGap = judged.length > 0 && judged.every((c) => c.state === "gap");
  const failed = (code) => reasons.some((r) => r.code === code && !r.ok);
  const verdict = failed("V-GATE") || failed("V-BLOCK") || allGap ? "skip" : reasons.every((r) => r.ok) ? "shortlist" : "maybe";

  const out = (ln) => (ln && ln.own ? { ...lineQ(ln, null), ...(ln.template ? { template: true } : {}), ...(ln.swapped ? { swapped: true } : {}) } : null);
  return {
    mode,
    target,
    top: {
      name: out(top.name), headline: out(top.headline), city: out(top.city), workRights: out(top.workRights), workRightsPresent: !!top.wrText.trim(),
      summary: out(top.s1), role: top.role && top.role.i >= 0 ? { i: top.role.i, t: out(top.role.t), c: out(top.role.c), d: out(top.role.d) } : null,
      bullets: top.bullets.map(out),
    },
    verdict,
    reasons,
    catches,
    kills,
    reject,
    weakest,
    callNow,
    formula: LABELS.formula,
    scope: LABELS.scope.top,
  };
}

if (typeof window !== "undefined") window.firstGlance = firstGlance;
