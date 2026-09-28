/**
 * One posting read the way a recruiter's screen reads it: its three must-have
 * keywords, the seniority its title and years set, and — where the candidate's
 * own line already says the same thing in other words — the one-word swap that
 * would put the posting's term there.
 *
 * Nothing here writes CV content. Every string this module returns is one of:
 *   - a verbatim slice of the posting (a term, a seniority word, a years quote);
 *   - a verbatim CV string (a bullet, a skill name, a headline, a summary
 *     sentence, the languages line, a role's title or employer);
 *   - a fixed label (LABELS, SENIORITY);
 *   - a swap's `after`: the candidate's line with exactly one span replaced by
 *     the posting's term, re-cased and nothing else.
 * A posting keyword with no evidence in the CV is reported as a gap and is
 * never an input to any replacement. The candidate approves each swap by id;
 * an id is honoured only while this module still proposes exactly that swap.
 *
 * Pure: no DOM, no network, no clock, no randomness, no locale compare, no
 * mutation of inputs. Same inputs, same output. No regex in this file uses
 * lookbehind (older Safari); intake-parse.js, imported below, has one, and the
 * page already loads that file.
 *
 * Types
 *   Posting = { title, text, requirements?: Req[]|null, snippet?: boolean }
 *             requirements: j.intake.requirements for an own listing, else parsed here.
 *             snippet: true when `text` is a search snippet, not the full posting
 *             (saved matches, the apply.html handoff) — no CV check, no swaps.
 *   Vocab   = { VOCAB: string[], SYN: {[key]: string[]} }            the page's
 *   CvIn    = { headline: string|string[], summary: string|string[], langs: string,
 *               skills: ({n,k}|[n,k]|string)[],
 *               roles: [{ t, c, d, tags?, bullets: [{ x, x0?, tags? }] }] } | null
 *             Every language of headline and summary may be passed, so the result
 *             does not change with the draft language. A bullet's base text is
 *             `x0` when present (an overlaid copy), else `x`.
 */
import { parseListing, fnv1a } from "./intake-parse.js";
import { EXTRA_SYN } from "./intake-fit.js";
import { findPersonalData, DEMONYMS } from "./personal-data.js";

/* ---------- tables ---------- */

const deepFreeze = (o) => {
  if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); }
  return o;
};

/**
 * Same-meaning forms a swap may exchange. SYN is a topic table, not a thesaurus
 * ("heavy equipment" is logistics, "car rental" is automotive), so swaps come
 * from this allow-list only, and each form must also be in the page's SYN for
 * that key — a SYN change can only remove swaps. English only.
 *   acronyms: forms that are an acronym, so an all-caps "AI" in a line is not a
 *             reason to print "ARTIFICIAL INTELLIGENCE".
 *   notBefore: words after the form that change its meaning (unused by these groups).
 * Awaiting the owner's yes, deliberately not listed: market analysis ↔ market
 * intelligence, consulting ↔ advisory (notBefore board, committee, council).
 */
export const SAME = deepFreeze([
  { k: "ai", forms: ["ai", "artificial intelligence"], acronyms: ["ai"] },
  { k: "business development", forms: ["business development", "bizdev"] },
  { k: "market entry", forms: ["market entry", "market-entry"] },
]);

/** Seniority levels, highest first. A title word sets the level; years only when the title has none. */
export const SENIORITY = deepFreeze([
  { key: "executive", label: "Executive", words: ["chief", "ceo", "coo", "cfo", "cto", "cmo", "cio", "c-level", "managing director", "general manager", "geschäftsführer", "geschäftsführerin"] },
  { key: "vp", label: "Vice President", words: ["vice president", "vp", "svp", "evp"] },
  { key: "director", label: "Director", words: ["director", "direktor", "direktorin"] },
  { key: "head", label: "Head of function", words: ["head of", "leiter", "leiterin", "leitung"] },
  { key: "senior", label: "Senior", words: ["senior", "sr"] },
  { key: "lead", label: "Lead", words: ["team lead", "lead"] },
  { key: "manager", label: "Manager", words: ["manager"] },
  { key: "mid", label: "Mid level", words: [] },
  { key: "junior", label: "Junior", words: ["junior", "jr"] },
  { key: "intern", label: "Intern / entry level", words: ["intern", "internship", "trainee", "praktikant", "praktikantin", "praktikum", "werkstudent", "werkstudentin"] },
  { key: "none", label: "Not stated", words: [] },
]);

/** Every fixed string the page prints for this feature. A count goes before toReview/tailored (…One for 1). */
export const LABELS = deepFreeze({
  mustHave: "The posting's 3 must-haves",
  snippet: "Keywords in the search snippet only — add the full listing to check them against your CV",
  level: "Level",
  setBy: "set by",
  asks: "asks",
  "in-cv": "In your CV in the posting's words",
  swap: "In your CV in other words — a swap is offered below",
  "swap-applied": "In this job's CV in the posting's words (your approval)",
  "other-words": "Evidenced in your CV, not in these words — no same-meaning swap exists",
  gap: "Not in your CV — never claimed",
  now: "Your line",
  withTerm: "With the posting's word",
  apply: "Use the posting's word in this job's CV",
  undo: "Undo",
  applied: "In this job's CV",
  toReview: "wording swaps to review",
  toReviewOne: "wording swap to review",
  scope: "Only the posting's own word replaces yours, only in this job's CV. Your master CV is not changed and nothing is added.",
  none: "No keywords from the portal's vocabulary in this posting.",
  tailored: "keyword swaps you approved — the posting's own word in your line. Undo in Match.",
  tailoredOne: "keyword swap you approved — the posting's own word in your line. Undo in Match.",
  notLoaded: "Your approved keyword swaps are not applied — the keyword module did not load.",
});

/* ---------- text helpers ---------- */

const str = (v) => (v === undefined || v === null ? "" : String(v));
const squash = (s) => str(s).replace(/\s+/g, " ").trim();
const norm = (s) => squash(s).toLowerCase();
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/* Words joined by any run of white space, so a term wrapped over two lines still matches.
   Compiled once per pattern (a report tests ~150 synonyms against every requirement);
   every caller runs its exec loop from lastIndex 0 and none nests the same pattern. */
const RE_CACHE = new Map();
function wordsRe(s) {
  const k = squash(s);
  let re = RE_CACHE.get(k);
  if (!re) {
    if (RE_CACHE.size > 5000) RE_CACHE.clear();
    re = new RegExp(escRe(k).replace(/ /g, "\\s+"), "giu");
    RE_CACHE.set(k, re);
  }
  re.lastIndex = 0;
  return re;
}
const WORD = /[\p{L}\p{N}]/u;
/* A character that continues a keyword: "P&L", "market-entry". A match may not start or end next to one. */
const JOIN = /[\p{L}\p{N}&-]/u;
const LOWER = /\p{Ll}/u;
const UPPER = /\p{Lu}/u;
const letters = (w) => (str(w).match(/\p{L}/gu) || []).length;
const isAcronymWord = (w) => letters(w) >= 2 && !LOWER.test(w);

/** fnv1a of the JSON: memo keys and swap ids. */
export function hash(v) {
  return fnv1a(JSON.stringify(v === undefined ? null : v));
}

/* "UAE nationals", "German citizens": a nationality, never a keyword. */
const NATIONALS_AFTER = /^\s*(?:nationals?|nationality|citizens?|passport)(?![\p{L}\p{N}])/iu;

/**
 * Where a vocabulary synonym occurs: case-insensitive, never inside a word. A
 * trailing space in the table ("ai ", "contract ") means the match must also end
 * at a word boundary; otherwise it is a stem and the match runs to the end of the
 * word, so "negotiat" quotes "negotiations".
 */
function occurrences(hay, syn) {
  const raw = str(syn).toLowerCase(), core = squash(raw);
  if (!core) return [];
  const exactEnd = /\s$/.test(raw);
  const re = wordsRe(core), out = [];
  let m;
  while ((m = re.exec(hay))) {
    const s = m.index;
    let e = s + m[0].length;
    const reject = (s > 0 && JOIN.test(hay[s - 1])) || (exactEnd && e < hay.length && JOIN.test(hay[e]));
    if (reject) { re.lastIndex = s + 1; continue; }
    if (!exactEnd) while (e < hay.length && WORD.test(hay[e])) e++;
    if (NATIONALS_AFTER.test(hay.slice(e, e + 40))) { re.lastIndex = s + 1; continue; }
    out.push({ s, e });
    re.lastIndex = e;
  }
  return out;
}
const hasSyn = (text, syns) => syns.some((s) => occurrences(str(text), s).length > 0);

/* A whole phrase or form: both ends at a word boundary, no stem extension. */
function exactOccurrences(hay, phrase) {
  const re = wordsRe(phrase), out = [];
  if (!squash(phrase)) return out;
  let m;
  while ((m = re.exec(hay))) {
    const s = m.index, e = s + m[0].length;
    if ((s > 0 && JOIN.test(hay[s - 1])) || (e < hay.length && JOIN.test(hay[e])) || NATIONALS_AFTER.test(hay.slice(e, e + 40))) {
      re.lastIndex = s + 1;
      continue;
    }
    out.push({ s, e });
  }
  return out;
}

/**
 * Where the posting's term occurs in a CV string: at a word start; also ending at
 * a word end when the term is short or holds an acronym, so "negotiation" is in
 * "negotiations" but "AI" is not in "AIM".
 */
function termAt(text, term) {
  const t = squash(term);
  if (!t) return -1;
  const needEnd = t.length <= 3 || t.split(/[\s-]+/).some(isAcronymWord);
  const re = wordsRe(t), hay = str(text);
  let m;
  while ((m = re.exec(hay))) {
    const s = m.index, e = s + m[0].length;
    if ((s > 0 && JOIN.test(hay[s - 1])) || (needEnd && e < hay.length && WORD.test(hay[e]))) { re.lastIndex = s + 1; continue; }
    return s;
  }
  return -1;
}

/* ---------- the posting ---------- */

const OFFER_HEAD = /^(?:what we offer|we offer|our offer|benefits|perks|why join us|about us|about the company|über uns|wir bieten|unser angebot|how to apply)$/i;
const STOP_HEAD = /^(?:requirements|qualifications|your profile|profile|responsibilities(?: and what to expect)?|key responsibilities|your responsibilities|your tasks|your role|the role|about the role|your duties.*|duties.*|job description|what you bring|who you are|about you|skills and experience|knowledge and expertise|ihre aufgaben|aufgaben|ihr profil.*|anforderungen|voraussetzungen|das bringen sie mit|was sie mitbringen|to be successful in this role.*)$/i;
const LABEL_LINE = /^(?:location|job location|standort|arbeitsort|city|country|salary|gehalt|job type|employment type|job id|job published|posted)\s*:/i;
const AGE_WORD = /\b(?:age|aged|years old|younger|alter)\b/i;

function headOf(line) {
  const bare = line.replace(/^[\s•\-–—*·▪●◦]+/, "").trim();
  const whole = bare.replace(/\s*:\s*$/, "");
  const lead = bare.match(/^([^:]{2,80}):/);
  for (const c of [whole, lead ? lead[1].trim() : ""]) {
    if (!c) continue;
    if (STOP_HEAD.test(c)) return "stop";
    if (OFFER_HEAD.test(c)) return "offer";
  }
  return null;
}

/**
 * The posting with what never ranks blanked out (same length, so indices stay
 * valid): offer and about sections ("training", "health insurance", "Vertrag"),
 * label lines ("Location: Dubai"), language and location demands, and an age
 * demand. A nationality demand needs no mask: no keyword is ever read right
 * before "nationals" (NATIONALS_AFTER). Masking changes counts only; terms are
 * quoted unmasked.
 */
function maskOf(hay, reqs) {
  const mask = new Uint8Array(hay.length);
  const set = (s, e) => { for (let i = s; i < e; i++) mask[i] = 1; };
  let pos = 0, offer = false;
  for (const line of hay.split("\n")) {
    const start = pos;
    pos += line.length + 1;
    const h = headOf(line);
    if (h === "stop") offer = false;
    else if (h === "offer") offer = true;
    const bare = line.replace(/^[\s•\-–—*·▪●◦]+/, "");
    if (offer || LABEL_LINE.test(bare)) set(start, start + line.length);
  }
  for (const r of reqs) {
    const t = str(r && r.text);
    if (!t.trim()) continue;
    const drop = r.type === "language" || r.type === "location" || (r.type === "years" && AGE_WORD.test(t));
    if (drop) for (const o of exactOccurrencesLoose(hay, t)) set(o.s, o.e);
  }
  let out = "";
  for (let i = 0; i < hay.length; i++) out += mask[i] && hay[i] !== "\n" ? " " : hay[i];
  return out;
}
/* A requirement's own span, found verbatim; parseListing may have synthesised the text, and then nothing is found. */
function exactOccurrencesLoose(hay, text) {
  const re = wordsRe(text), out = [];
  let m;
  while ((m = re.exec(hay))) { out.push({ s: m.index, e: m.index + m[0].length }); if (!m[0].length) re.lastIndex++; }
  return out;
}

/* The title is counted once: when the text already prints it (an own listing's
   read text), the text alone is read and the title is found inside it. */
function postingHay(P) {
  const title = squash(P.title), text = str(P.text).replace(/\r\n?/g, "\n");
  if (title && norm(text).includes(norm(title))) {
    const m = wordsRe(title).exec(text);
    if (m) return { hay: text, t0: m.index, t1: m.index + m[0].length };
  }
  if (!title) return { hay: text, t0: -1, t1: -1 };
  return { hay: title + "\n" + text, t0: 0, t1: title.length };
}

function lexiconOf(vocab) {
  const V = vocab && Array.isArray(vocab.VOCAB) ? vocab.VOCAB : [];
  const S = vocab && vocab.SYN && typeof vocab.SYN === "object" ? vocab.SYN : {};
  const own = (k) => Object.prototype.hasOwnProperty.call(S, k);
  const out = [], seen = new Set();
  V.forEach((k, i) => {
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ k, syns: own(k) && Array.isArray(S[k]) && S[k].length ? S[k] : [k], extra: false, order: i });
  });
  /* The Fit check's extra concepts (sales, marketing, sectors). Page SYN wins a shared key:
     EXTRA_SYN's gcc adds "dubai", which would put GCC on every Dubai posting. */
  Object.keys(EXTRA_SYN).forEach((k, i) => {
    if (seen.has(k) || own(k)) return;
    seen.add(k);
    out.push({ k, syns: EXTRA_SYN[k], extra: true, order: V.length + i });
  });
  return out;
}

const REQ_CUE = /^(?:(?:proven|strong|solid|excellent|good|deep|sound|demonstrated|extensive|hands-on|working|in-depth|advanced)\s+)*(?:experience|knowledge|understanding|expertise|background|proficiency|skills?|familiarity|track record)\s+(?:in|with|of|using)\s+/i;
const REQ_TAIL = /\s*(?:is\s+)?(?:required|a must|essential|mandatory)\.?$/i;
const TOOLISH = /[A-Z]{2}|\d|[+#/]/;
const PERSONAL_WORD = /\b(?:nationals?|nationality|citizens?|passport|age|aged|gender|male|female|religio\w*|marital|married|health|medical|photo)\b/i;
const DEMONYM_RE = new RegExp(`(?:^|[^\\p{L}])(?:${DEMONYMS.slice().sort((a, b) => b.length - a.length).map((w) => escRe(w).replace(/\s+/g, "\\s+")).join("|")})(?![\\p{L}])`, "iu");

function readPosting(posting, vocab) {
  const P = posting && typeof posting === "object" ? posting : {};
  const reqs = (Array.isArray(P.requirements) ? P.requirements : parseListing(str(P.text)).requirements).filter((r) => r && typeof r === "object");
  const { hay, t0, t1 } = postingHay(P);
  const masked = maskOf(hay, reqs);
  const lex = lexiconOf(vocab);
  const inTitle = (occ) => occ.some((o) => o.s >= t0 && o.s < t1);
  const named = new Map(reqs.map((r) => [r, new Set(lex.filter((c) => hasSyn(r.text, c.syns)).map((c) => c.k))]));
  const mustReqs = reqs.filter((r) => r.strength === "must" && (r.type === "skill" || (r.type === "years" && str(r.field).trim() && !AGE_WORD.test(str(r.text)))));
  const skillReqs = reqs.filter((r) => r.type === "skill");
  const cands = [];

  for (const c of lex) {
    const byStart = new Map();
    for (const s of c.syns) for (const o of occurrences(masked, s)) if (!byStart.has(o.s) || byStart.get(o.s).e < o.e) byStart.set(o.s, o);
    if (!byStart.size) continue;
    /* An extra concept counts only where a requirement names it, the way the Fit check reads it. */
    if (c.extra && !skillReqs.some((r) => named.get(r).has(c.k))) continue;
    const occ = [...byStart.values()].sort((a, b) => a.s - b.s);
    cands.push({
      key: c.k, term: squash(hay.slice(occ[0].s, occ[0].e)), kind: "concept",
      must: mustReqs.some((r) => named.get(r).has(c.k)), count: occ.length, inTitle: inTitle(occ), first: occ[0].s, order: c.order,
    });
  }

  /* A must requirement that names no concept may name a tool or a standard ("SAP S/4HANA", "IFRS").
     Kept only when short, tool-like, free of personal words and printed verbatim in the posting. */
  const base = lex.length ? Math.max(...lex.map((c) => c.order)) + 1 : 0;
  const seen = new Set();
  reqs.forEach((r, ri) => {
    if (r.type !== "skill" || r.strength !== "must" || named.get(r).size) return;
    const p = squash(r.text).replace(REQ_CUE, "").replace(REQ_TAIL, "").replace(/[\s.,;:]+$/, "").trim();
    if (!p || p.split(" ").length > 4 || !TOOLISH.test(p) || PERSONAL_WORD.test(p) || DEMONYM_RE.test(p)) return;
    const occ = exactOccurrences(masked, p);
    const key = p.toLowerCase();
    if (!occ.length || seen.has(key)) return;
    seen.add(key);
    cands.push({ key, term: squash(hay.slice(occ[0].s, occ[0].e)), kind: "phrase", must: true, count: occ.length, inTitle: inTitle(occ), first: occ[0].s, order: base + ri });
  });

  /* must, then frequency, then the title, then first appearance; `order` makes it a total order. */
  cands.sort((a, b) => (b.must - a.must) || (b.count - a.count) || (b.inTitle - a.inTitle) || (a.first - b.first) || (a.order - b.order));
  const must = cands.slice(0, 3).map(({ key, term, kind, must: m, count, inTitle: it, first }) => ({ key, term, kind, must: m, count, inTitle: it, first }));
  return { P, reqs, hay, lex, must };
}

/**
 * The posting's top three keywords.
 * @returns {{key, term, kind:"concept"|"phrase", must:boolean, count:number, inTitle:boolean, first:number}[]}
 *   term: the posting's wording at its first occurrence (white space collapsed);
 *   first: its index in the posting as read (title prepended when the text does not print it).
 */
export function mustHave3(posting, vocab) {
  return readPosting(posting, vocab).must;
}

/* ---------- seniority ---------- */

const YEARS_Q = /\d{1,2}\s*\+?\s*(?:(?:to|-|–|—|bis)\s*\d{1,2}\s*\+?\s*)?(?:years?|yrs?|jahre?n?)(?![\p{L}])/iu;

function titleHits(title) {
  const t = str(title), found = [];
  SENIORITY.forEach((row, rank) => {
    for (const w of row.words) {
      for (const o of exactOccurrencesLoose(t, w)) {
        if ((o.s > 0 && WORD.test(t[o.s - 1])) || (o.e < t.length && WORD.test(t[o.e]))) continue;
        if (w === "lead" && /^\s+generation\b/i.test(t.slice(o.e))) continue;   // "Lead Generation Specialist" leads nobody
        found.push({ s: o.s, e: o.e, rank });
      }
    }
  });
  /* Longest first, spans never overlap: "General Manager" is one hit, not also "Manager". */
  found.sort((a, b) => (b.e - b.s) - (a.e - a.s) || a.s - b.s || a.rank - b.rank);
  const kept = [];
  for (const h of found) if (!kept.some((k) => h.s < k.e && k.s < h.e)) kept.push(h);
  return kept.sort((a, b) => a.s - b.s).map((h) => ({ rank: h.rank, text: t.slice(h.s, h.e) }));
}

/**
 * The level a posting asks for.
 * @param {string} title
 * @param {object[]|{requirements:object[]}} listingOrReqs
 * @param {string|null} [text] the posting text; when given, a years quote is kept only if printed there verbatim
 * @returns {{key, label, set:{from:"title"|"requirement", text}[], years:number|null, asks:{from:"requirement", text}|null}}
 *   set: the words that set the label. asks: the years quote when the title set the label.
 */
export function seniority(title, listingOrReqs, text = null) {
  const reqs = Array.isArray(listingOrReqs) ? listingOrReqs
    : listingOrReqs && Array.isArray(listingOrReqs.requirements) ? listingOrReqs.requirements : [];
  const yr = reqs.filter((r) => r && r.type === "years" && Number.isFinite(+r.years) && !AGE_WORD.test(str(r.text)));
  const pool = yr.some((r) => r.strength === "must") ? yr.filter((r) => r.strength === "must") : yr;
  let best = null;
  for (const r of pool) if (!best || +r.years > +best.years) best = r;
  const years = best ? +best.years : null;
  let quote = null;
  if (best) {
    const q = str(best.text).match(YEARS_Q);
    const printed = text === null || text === undefined || norm(str(title) + " " + str(text)).includes(norm(q ? q[0] : ""));
    if (q && printed) quote = { from: "requirement", text: squash(q[0]) };
  }
  const hits = titleHits(title);
  const row = (key) => SENIORITY.find((r) => r.key === key);
  if (hits.length) {
    const top = SENIORITY[Math.min(...hits.map((h) => h.rank))];
    return { key: top.key, label: top.label, set: hits.map((h) => ({ from: "title", text: h.text })), years, asks: quote };
  }
  if (years !== null && quote) {
    const r = row(years >= 6 ? "senior" : years >= 3 ? "mid" : "junior");
    return { key: r.key, label: r.label, set: [quote], years, asks: null };
  }
  const none = row("none");
  return { key: none.key, label: none.label, set: [], years, asks: null };
}

/* ---------- the CV ---------- */

const baseOf = (b) => (typeof b === "string" ? b : b && typeof b.x0 === "string" ? b.x0 : str(b && b.x));
const tagsOf = (b) => (b && Array.isArray(b.tags) ? b.tags : []);
const listOf = (v) => (Array.isArray(v) ? v : [v]).map(str).filter((s) => s.trim());
const pdIn = (text, zone) => findPersonalData(text, zone ? { zone } : {}).length > 0;
/* The SAME table is English: a swap goes only into a line written mostly in Latin script. */
const mostlyLatin = (t) => { const all = letters(t); return all > 0 && 2 * (str(t).match(/\p{Script=Latin}/gu) || []).length > all; };

function cvRead(cv) {
  const skills = (Array.isArray(cv.skills) ? cv.skills : []).map((s) =>
    typeof s === "string" ? { n: s, k: "" } : Array.isArray(s) ? { n: str(s[0]), k: str(s[1]) } : { n: str(s && s.n), k: str(s && s.k) },
  ).filter((s) => s.n.trim());
  const roles = (Array.isArray(cv.roles) ? cv.roles : []).map((e) => {
    const r = e && typeof e === "object" ? e : {};
    const count = new Map();
    const bullets = (Array.isArray(r.bullets) ? r.bullets : []).map((b) => {
      const x = baseOf(b), dup = count.get(x) || 0;
      count.set(x, dup + 1);
      return { x, tags: tagsOf(b), dup, pd: !!x.trim() && pdIn(x) };
    });
    return { t: str(r.t), c: str(r.c), d: str(r.d), bullets };
  });
  const headlines = listOf(cv.headline), summaries = listOf(cv.summary), langs = listOf(cv.langs);
  const sentences = summaries.flatMap((s) => (s.match(/[^.!?]+[.!?]*/g) || []).map((x) => x.trim()).filter(Boolean));
  const ref = (r) => ({ t: r.t, c: r.c, d: r.d });
  /* Reading order for evidence: bullets, skills, headline, summary sentences, languages, role headers. */
  const quotable = [
    ...roles.flatMap((r) => r.bullets.filter((b) => b.x.trim()).map((b) => ({ ref: ref(r), text: b.x, pd: b.pd, tags: b.tags }))),
    ...skills.map((s) => ({ ref: "skills", text: s.n, k: s.k })),
    ...headlines.map((h) => ({ ref: "headline", text: h, zone: "header" })),
    ...sentences.map((s) => ({ ref: "summary", text: s })),
    ...langs.map((l) => ({ ref: "langs", text: l })),
    ...roles.flatMap((r) => [r.t, r.c].filter((x) => x.trim()).map((x) => ({ ref: ref(r), text: x, zone: "header" }))),
  ];
  const all = [...headlines, ...summaries, ...langs, ...skills.map((s) => s.n), ...roles.flatMap((r) => [r.t, r.c, ...r.bullets.map((b) => b.x)])];
  return { roles, quotable, all };
}
const clean = (q) => (q.pd !== undefined ? !q.pd : !pdIn(q.text, q.zone));

/* ---------- swaps ---------- */

/* The SAME group for a must-have, cut down to the forms the page's SYN also holds. */
function groupFor(m, same, SYN) {
  const g = (Array.isArray(same) ? same : []).find((x) => x && x.k === m.key);
  if (!g) return null;
  const syn = (SYN && Array.isArray(SYN[m.key]) ? SYN[m.key] : []).map(norm);
  const forms = (g.forms || []).map(norm).filter((f) => f && syn.includes(f));
  if (!forms.includes(norm(m.term))) return null;
  return { forms, acronyms: (g.acronyms || []).map(norm), notBefore: (g.notBefore || []).map(norm) };
}

const capFirst = (s) => s.replace(/\p{L}/u, (c) => c.toUpperCase());
/* A word keeps its printed case when it is an acronym, mixed case or a symbol word ("AI", "BizDev", "P&L", "S/4HANA"). */
const keepCase = (w) => /[&/\d]/.test(w) || isAcronymWord(w) || (LOWER.test(w) && UPPER.test([...w].slice(1).join("")));
const byWord = (s, fn) => s.split(/([\s-]+)/).map((p, i) => (i % 2 ? p : fn(p))).join("");
const atSentenceStart = (pre) => /^[\s"'“‘(\[•·*–—-]*$/u.test(pre) || /[.!?:;]["'”’)\]]*\s+$/u.test(pre);

/**
 * The posting's term re-cased for the place it goes. Title Case from a job title
 * does not travel into a sentence ("Business Development" → "business
 * development"); the line's own capitals do: an all-caps line, a Title Case
 * phrase, a sentence start. An acronym ("AI") is not an all-caps line, and a
 * capital that is not at a sentence start ("AI", "BizDev") is the word's own,
 * so it does not pass to the term.
 */
function recase(term, synonym, pre, g) {
  const to = byWord(term, (w) => (keepCase(w) ? w : w.toLowerCase()));
  const synWords = synonym.split(/[\s-]+/).filter(Boolean);
  const synCaps = isAcronymWord(synonym);
  if (synCaps && !g.acronyms.includes(norm(synonym)) && (synWords.length > 1 || letters(synonym) >= 4)) return to.toUpperCase();
  if (!synCaps && synWords.length > 1 && synWords.every((w) => UPPER.test(w[0]))) return byWord(to, (w) => (keepCase(w) ? w : capFirst(w)));
  return UPPER.test(synonym[0]) && atSentenceStart(pre) ? capFirst(to) : to;
}

function formAt(text, form, g, termFirst) {
  for (const o of exactOccurrences(text, form)) {
    const pre = text.slice(0, o.s);
    const art = pre.match(/(?:^|[^\p{L}\p{N}])(an?)\s+$/iu);
    const synonym = text.slice(o.s, o.e);
    if (art) {
      const vowel = /^[aeiou]/i.test(termFirst(synonym, pre));
      if ((art[1].toLowerCase() === "a") === vowel) continue;   // the article is never edited, so the swap is not offered
    }
    const next = text.slice(o.e).match(/^\s+([\p{L}\p{N}&-]+)/u);
    if (next && g.notBefore.includes(next[1].toLowerCase())) continue;
    return { at: o.s, synonym, pre };
  }
  return null;
}

function swapList(C, must, vocab, same, all) {
  const SYN = vocab && vocab.SYN ? vocab.SYN : {};
  const out = [];
  must.forEach((m, mi) => {
    if (m.kind !== "concept") return;
    const needed = !C.all.some((t) => termAt(t, m.term) >= 0);
    if (!all && !needed) return;
    const g = groupFor(m, same, SYN);
    if (!g) return;
    const others = g.forms.filter((f) => f !== norm(m.term));
    C.roles.forEach((role, ri) => role.bullets.forEach((b, bi) => {
      if (!b.x.trim() || b.pd || !mostlyLatin(b.x)) return;
      for (const f of others) {
        const hit = formAt(b.x, f, g, (syn, pre) => recase(m.term, syn, pre, g));
        if (!hit) continue;
        const to = recase(m.term, hit.synonym, hit.pre, g);
        const after = b.x.slice(0, hit.at) + to + b.x.slice(hit.at + hit.synonym.length);
        const r = { t: role.t, c: role.c, d: role.d };
        /* The id names the line (role and its n-th identical bullet), so one click changes one line. */
        const id = "s" + hash([m.key, norm(m.term), r.t, r.c, r.d, b.dup, b.x, hit.at, hit.synonym, to]);
        out.push({ id, key: m.key, term: m.term, role: r, roleIndex: ri, bulletIndex: bi, at: hit.at, synonym: hit.synonym, to, before: b.x, after, needed, mi });
      }
    }));
  });
  out.sort((a, b) => a.roleIndex - b.roleIndex || a.bulletIndex - b.bulletIndex || a.at - b.at || a.mi - b.mi);
  return out.map(({ mi, ...s }) => s);
}

/**
 * Proposed swaps: a must-have the CV does not print in the posting's words,
 * printed in one of the candidate's bullets in a same-meaning form.
 * @param {{all?:boolean, same?:object[]}} [opt] all: also swaps no longer needed
 *   (the list an approval is validated against; never capped).
 * @returns {{id, key, term, role:{t,c,d}, roleIndex, bulletIndex, at, synonym, to, before, after, needed}[]}
 *   in reading order. after === before.slice(0,at) + to + before.slice(at + synonym.length).
 */
export function swaps(cv, posting, vocab, { all = false, same = SAME } = {}) {
  if (!cv || typeof cv !== "object" || (posting && posting.snippet === true)) return [];
  return swapList(cvRead(cv), readPosting(posting, vocab).must, vocab, same, all);
}

/** The line with every swap whose `before` is exactly this line applied, right to left. Nothing else changes. */
export function applySwaps(text, list) {
  const t = str(text);
  const ok = (Array.isArray(list) ? list : [])
    .filter((s) => s && s.before === t && typeof s.synonym === "string" && s.synonym && typeof s.to === "string" && t.substr(s.at, s.synonym.length) === s.synonym)
    .sort((a, b) => b.at - a.at);
  let out = t, lo = Infinity;
  for (const s of ok) {
    if (s.at + s.synonym.length > lo) continue;   // overlaps one already applied
    out = out.slice(0, s.at) + s.to + out.slice(s.at + s.synonym.length);
    lo = s.at;
  }
  return out;
}

/* ---------- the report ---------- */

function stateOf(m, C, list, lex) {
  if (!C) return { state: null, evidence: null };
  const quote = (q) => ({ ref: q.ref, text: q.text });
  if (C.all.some((t) => termAt(t, m.term) >= 0)) {
    const q = C.quotable.find((x) => termAt(x.text, m.term) >= 0 && clean(x));
    return { state: "in-cv", evidence: q ? quote(q) : null };
  }
  if (m.kind === "phrase") return { state: "gap", evidence: null };
  const s = list.find((x) => x.key === m.key && x.needed);
  if (s) return { state: "swap", evidence: { ref: s.role, text: s.before } };
  const syns = (lex.find((c) => c.k === m.key) || { syns: [] }).syns;
  const q = C.quotable.find((x) => ((x.tags && x.tags.includes(m.key)) || (x.k && x.k === m.key) || hasSyn(x.text, syns)) && clean(x));
  return q ? { state: "other-words", evidence: quote(q) } : { state: "gap", evidence: null };
}

/**
 * Everything the page shows for one job, in one call.
 * @returns {{source:"posting"|"snippet", must:(MustHave & {state, evidence})[], level, swaps:Swap[],
 *            gaps:string[], claimed:string[]}}
 *   state: "in-cv" | "swap" | "other-words" | "gap" | null (no CV, or a snippet).
 *   evidence: null | {ref: {t,c,d} | "skills" | "headline" | "summary" | "langs", text} — text verbatim from the CV.
 *   swaps: every proposal (needed or not), uncapped: the list approvals are checked against.
 *   gaps: terms of must-haves with no evidence. claimed: keys the CV evidences — never list these as gaps.
 */
export function keywordReport(posting, cv, vocab, { same = SAME } = {}) {
  const R = readPosting(posting, vocab);
  const level = seniority(R.P.title, R.reqs, str(R.P.text));
  const snippet = R.P.snippet === true;
  const C = cv && typeof cv === "object" && !snippet ? cvRead(cv) : null;
  const list = C ? swapList(C, R.must, vocab, same, true) : [];
  const must = R.must.map((m) => ({ ...m, ...stateOf(m, C, list, R.lex) }));
  return {
    source: snippet ? "snippet" : "posting",
    must,
    level,
    swaps: list,
    gaps: must.filter((m) => m.state === "gap").map((m) => m.term),
    claimed: must.filter((m) => m.state && m.state !== "gap").map((m) => m.key),
  };
}

/* ---------- approvals ---------- */

const idSet = (ids) => new Set((Array.isArray(ids) ? ids : []).filter((x) => typeof x === "string"));

/** The report's swaps the candidate approved. An id the report no longer proposes applies nothing. */
export function approved(report, ids) {
  const want = idSet(ids);
  return (report && Array.isArray(report.swaps) ? report.swaps : []).filter((s) => want.has(s.id));
}

/**
 * Role copies with approved swaps applied: a changed bullet becomes {...b, x0: base, x: swapped};
 * its tags are the same array. A bullet an earlier overlay changed and no swap now applies to
 * gets its base text back (undo). Roles and bullets not touched are returned as they are.
 */
export function overlay(roles, list) {
  const on = Array.isArray(list) ? list : [];
  return (Array.isArray(roles) ? roles : []).map((e, ri) => {
    if (!e || typeof e !== "object" || !Array.isArray(e.bullets)) return e;
    let changed = false;
    const bullets = e.bullets.map((b, bi) => {
      const base = baseOf(b);
      const mine = on.filter((s) => s && s.roleIndex === ri && s.bulletIndex === bi && s.before === base && s.role
        && s.role.t === str(e.t) && s.role.c === str(e.c) && s.role.d === str(e.d));
      const x = mine.length ? applySwaps(base, mine) : base;
      if (x === base) {
        if (!b || typeof b !== "object" || !("x0" in b)) return b;
        const { x0, ...rest } = b;
        changed = true;
        return { ...rest, x: base };
      }
      changed = true;
      return typeof b === "string" ? { x0: base, x } : { ...b, x0: base, x };
    });
    return changed ? { ...e, bullets } : e;
  });
}

/** The swap rows a panel shows: approved ones always, then needed ones up to `cap` rows in all. */
export function visibleSwaps(report, ids, cap = 6) {
  const want = idSet(ids);
  const list = report && Array.isArray(report.swaps) ? report.swaps : [];
  let room = Math.max(0, cap - list.filter((s) => want.has(s.id)).length);
  const out = [];
  for (const s of list) {
    if (want.has(s.id)) out.push(s);
    else if (s.needed && room > 0) { out.push(s); room--; }
  }
  return out;
}
