/**
 * CV Review: the candidate's whole CV, read the way an experienced recruiter
 * reads it, with no job posting involved.
 *
 * It reads the profile P (the CV the whole portal writes from) and says, check
 * by check, what a recruiter would flag, plus the questions only the candidate
 * can answer. It never edits P, never rewrites a line, never translates, and
 * never generates text. Every piece of evidence quotes the candidate's own
 * field with its path (e.g. experience.2.bullets.0); every fix is an
 * instruction, and every missing figure is a question, never a placeholder.
 *
 * Deterministic and pure: the same P and the same options always give the same
 * result. There is no network call, no AI call and no clock read when
 * opts.today is given (the page passes it; the tests always do).
 *
 * The one rule behind the checks: every claim in a CV must trace to a line the
 * candidate wrote. Bullets the portal built from its own templates (b.ach) are
 * therefore never counted as the candidate's evidence for anything, and bullet
 * tags (assigned by the parser, not written by the candidate) never prove a
 * skill.
 *
 * Loaded like role-title.js: the page imports it as a module and assigns
 * window.reviewCV. No regex here uses lookbehind, so it also parses on older
 * Safari; word boundaries are checked by hand (see matcher()).
 */

/* Printed personal data (nationality, date of birth, age, place of birth,
   religion) is read by the module the CV Builder shares, so both tabs agree. */
import { findPersonalData, demonymUses, DEMONYMS } from "./personal-data.js";
export { DEMONYMS };

/* ---------- small text helpers ---------- */

const str = (v) => (v === undefined || v === null ? "" : String(v));
const low = (v) => str(v).toLowerCase();
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* Lower-case, punctuation out, whitespace collapsed. */
export const norm = (s) => low(s).replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

/* FNV-1a, 32 bits, hex: a short stable fingerprint for keys. */
export function hashStr(s) {
  let h = 0x811c9dc5;
  for (const ch of str(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

/* Eastern Arabic (U+0660-0669) and Persian (U+06F0-06F9) digits become 0-9.
   Built from code points so no escape sequence has to survive an editor. */
export function asciiDigits(s) {
  let out = "";
  for (const ch of str(s)) {
    const c = ch.codePointAt(0);
    out += c >= 0x660 && c <= 0x669 ? String(c - 0x660) : c >= 0x6f0 && c <= 0x6f9 ? String(c - 0x6f0) : ch;
  }
  return out;
}

const WORDCH = /[\p{L}\p{N}\p{M}]/u;
/* A match is whole when the characters on either side are not letters or digits.
   JS \b is ASCII-only and breaks on umlauts and Arabic, so it is never used. */
const bound = (t, s, e) => !(s > 0 && WORDCH.test(t[s - 1])) && !(e < t.length && WORDCH.test(t[e]));

/* One list item as regex source: words joined by any run of whitespace, a hyphen
   also matching a space, and (with infl) the common English inflections, so that
   "strategy" finds "strategies" and "client" finds "clients". */
function termSrc(term, infl) {
  const words = term.split(/\s+/).map((w) => escRe(w).replace(/-/g, "[-\\s]?"));
  if (infl) {
    const last = term.split(/\s+/).pop();
    if (/\p{L}$/u.test(last)) {
      const i = words.length - 1;
      words[i] = /y$/.test(last) && last.length > 3
        ? escRe(last.slice(0, -1)) + "(?:y|ies)"
        : words[i] + "(?:s|es|ed|d|ing)?";
    }
  }
  return words.join("\\s+");
}

const NONE = { all: () => [], test: () => false, first: () => null };
const MCACHE = new Map();

/**
 * WHOLE(list): whole-word, case-insensitive, Unicode-aware matching. Longer
 * items are tried first, and when the longest alternative at a position fails
 * the boundary test, the shorter ones are tried at the same position.
 */
export function matcher(terms, { infl = false } = {}) {
  const list = [...new Set((terms || []).map((t) => low(t).trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!list.length) return NONE;
  const key = (infl ? "1" : "0") + list.join("|");
  if (MCACHE.has(key)) return MCACHE.get(key);
  const srcs = list.map((t) => termSrc(t, infl));
  const re = new RegExp(srcs.join("|"), "giu");
  const sticky = srcs.map((s) => new RegExp(s, "iuy"));
  function all(text) {
    const t = str(text), out = [];
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(t))) {
      const s = m.index;
      let e = s + m[0].length;
      if (!m[0].length) { re.lastIndex = s + 1; continue; }
      if (!bound(t, s, e)) {
        let ok = false;
        for (const y of sticky) {
          y.lastIndex = s;
          const k = y.exec(t);
          if (k && k[0].length && bound(t, s, s + k[0].length)) { e = s + k[0].length; ok = true; break; }
        }
        if (!ok) { re.lastIndex = s + 1; continue; }
      }
      out.push({ start: s, end: e, word: t.slice(s, e) });
      re.lastIndex = e;
    }
    return out;
  }
  const M = { all, test: (t) => all(t).length > 0, first: (t) => all(t)[0] || null };
  if (MCACHE.size > 500) MCACHE.clear();
  MCACHE.set(key, M);
  return M;
}

/* Blank out matched spans (same length, so indices stay valid). */
function maskSpans(text, spans) {
  let t = str(text);
  for (const { start, end } of spans) t = t.slice(0, start) + " ".repeat(end - start) + t.slice(end);
  return t;
}

/* Letter words of a text (for counts and small token tests). */
const letterWords = (s) => str(s).match(/\p{L}[\p{L}\p{M}'’-]*/gu) || [];
const wordCount = (s) => str(s).split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
const hasArabic = (s) => { for (const ch of str(s)) { const c = ch.codePointAt(0); if (c >= 0x600 && c <= 0x6ff) return true; } return false; };

/* ---------- dates ---------- */

/* Month tokens (lower case, trailing dot stripped) to 1..12. */
export const MONTHS = (() => {
  const m = {};
  const add = (n, ...ws) => ws.forEach((w) => (m[w] = n));
  add(1, "jan", "january", "jän", "januar", "jänner", "janv", "janvier", "ene", "enero", "gen", "gennaio", "يناير", "كانون الثاني");
  add(2, "feb", "february", "februar", "févr", "fév", "février", "febrero", "febbraio", "فبراير", "شباط");
  add(3, "mar", "march", "mär", "märz", "mrz", "mars", "marzo", "مارس", "آذار");
  add(4, "apr", "april", "avr", "avril", "abr", "abril", "aprile", "أبريل", "ابريل", "نيسان");
  add(5, "may", "mai", "mayo", "mag", "maggio", "مايو", "أيار");
  add(6, "jun", "june", "juni", "juin", "junio", "giu", "giugno", "يونيو", "حزيران");
  add(7, "jul", "july", "juli", "juil", "juillet", "julio", "lug", "luglio", "يوليو", "تموز");
  add(8, "aug", "august", "août", "ago", "agosto", "أغسطس", "اغسطس", "آب");
  add(9, "sep", "sept", "september", "septembre", "septiembre", "set", "settembre", "سبتمبر", "أيلول");
  add(10, "oct", "october", "okt", "oktober", "octobre", "octubre", "ott", "ottobre", "أكتوبر", "اكتوبر", "تشرين الأول");
  add(11, "nov", "november", "novembre", "noviembre", "نوفمبر", "تشرين الثاني");
  add(12, "dec", "december", "dez", "dezember", "déc", "décembre", "dic", "diciembre", "dicembre", "ديسمبر", "كانون الأول");
  return m;
})();

export const OPEN_WORDS = ["present", "current", "currently", "today", "now", "to date", "ongoing", "heute", "bis heute", "aktuell",
  "laufend", "derzeit", "aujourd'hui", "actualidad", "actual", "presente", "oggi", "حتى الآن", "الآن", "حاليا"];
const OPEN_SET = new Set(OPEN_WORDS);
const SINCE = /^(since|from|seit|depuis|desde|dal|منذ)\s+(.+)$/iu;
const WORD_SEP = /\s(to|bis|until|till|à|a|al|au|hasta|إلى)\s/giu;

/* Trim the punctuation a side may carry; a "?" stays, so "Mrz 2005 – ?" is unreadable. */
const trimSide = (s) => str(s).replace(/^[\s.,;:()[\]]+|[\s.,;:()[\]]+$/g, "");

/* One side of a date range. The whole side must match one pattern. */
export function parseSide(raw) {
  const s = trimSide(asciiDigits(raw)).replace(/\s+/g, " ");
  if (!s) return null;
  const l = s.toLowerCase();
  if (OPEN_SET.has(l)) return { open: true, text: s };
  let m = /^(\d{1,2})\s*[-/.]\s*(\d{4})$/.exec(s);
  if (m && +m[1] >= 1 && +m[1] <= 12) return { y: +m[2], m: +m[1], fmt: "MM/YYYY", text: s };
  m = /^(\d{4})\s*[-/.]\s*(\d{1,2})$/.exec(s);                          // ISO 2019-03
  if (m && +m[2] >= 1 && +m[2] <= 12) return { y: +m[1], m: +m[2], fmt: "MM/YYYY", text: s };
  m = /^(.+?)[.,]?\s+(\d{4})$/u.exec(s);
  if (m) {
    const mon = MONTHS[m[1].toLowerCase().replace(/\.$/, "").trim()];
    if (mon) return { y: +m[2], m: mon, fmt: "Mon YYYY", text: s };
  }
  m = /^(\d{4})$/.exec(s);
  if (m && +m[1] >= 1950 && +m[1] <= 2039) return { y: +m[1], m: null, fmt: "YYYY", text: s };
  return null;
}

/**
 * Read a role's dates.
 *   Parenthesised text goes to note. A range splits on the first separator that
 *   gives two readable sides: a dash (– — -) with whitespace on at least one
 *   side or between two date-shaped sides, or a whitespace-delimited word (to,
 *   bis, à, a, al, until …). "since / from / seit X" gives an open end. A single
 *   date gives {from, to: from, single: true}.
 * Returns {from, to, sep, note, single, dangling}. from is null when unreadable.
 */
export function parseDates(d) {
  const notes = [];
  const text = asciiDigits(d).replace(/\(([^)]*)\)/g, (_, x) => { if (x.trim()) notes.push(x.trim()); return " "; }).replace(/\s+/g, " ").trim();
  const out = { from: null, to: null, sep: null, note: notes.join("; "), single: false, dangling: false };
  if (!text) return out;
  let text2 = text;
  const since = SINCE.exec(text);
  if (since) {
    const side = parseSide(since[2]);
    if (side && !side.open) return Object.assign(out, { from: side, to: { open: true, text: since[1] }, sep: since[1] });
    text2 = since[2];                                      // "from 2019 to 2021"
  }
  /* A dash splits only where the whole left side is a date, so the dash inside
     "03-2005" or "2019-03" is never taken for the range separator. */
  const dash = /[–—-]+/g;
  let m;
  while ((m = dash.exec(text2))) {
    const i = m.index, j = i + m[0].length;
    const left = text2.slice(0, i).trim(), right = text2.slice(j).trim();
    const lp = parseSide(left);
    if (!lp || lp.open) continue;
    if (!right) return Object.assign(out, { from: lp, to: lp, sep: m[0], single: true, dangling: true });
    const rp = parseSide(right);
    if (rp) return Object.assign(out, { from: lp, to: rp, sep: m[0] });
  }
  WORD_SEP.lastIndex = 0;
  while ((m = WORD_SEP.exec(text2))) {
    const left = text2.slice(0, m.index), right = text2.slice(m.index + m[0].length);
    const lp = parseSide(left);
    let rp = parseSide(right);
    if (!rp && OPEN_SET.has((m[1] + " " + trimSide(right)).toLowerCase())) rp = { open: true, text: m[1] + " " + right };
    if (lp && !lp.open && rp) return Object.assign(out, { from: lp, to: rp, sep: m[1] });
    WORD_SEP.lastIndex = m.index + 1;
  }
  const one = parseSide(text);
  if (one && !one.open) return Object.assign(out, { from: one, to: one, single: true });
  return out;
}

/* Month index arithmetic. An open side is today. */
export const idx = (y, m) => y * 12 + (m - 1);
const early = (s, T) => (s.open ? T : idx(s.y, s.m || 1));
const late = (s, T) => (s.open ? T : idx(s.y, s.m || 12));
/* The generous reading, used for overlaps: a year-only start is December, a
   year-only end is January. */
const loFrom = (s, T) => (s.open ? T : idx(s.y, s.m || 12));
const loTo = (s, T) => (s.open ? T : idx(s.y, s.m || 1));
const MON_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtIdx = (i) => MON_EN[((i % 12) + 12) % 12] + " " + Math.floor(i / 12);

/* Date ranges inside free text, for "is this bullet really a date line?" and for
   taking dates out before looking for a figure. */
const MONTH_ALT = Object.keys(MONTHS).sort((a, b) => b.length - a.length).map(escRe).join("|");
const OPEN_ALT = OPEN_WORDS.slice().sort((a, b) => b.length - a.length).map(escRe).join("|");
const DATE_TOK = `(?:(?:${MONTH_ALT})\\.?\\s+\\d{4}|\\d{1,2}[/.]\\d{4}|\\d{4})`;
const RANGE_RE = new RegExp(`${DATE_TOK}(?:\\s*[–—-]+\\s*|\\s+(?:to|bis|until|till|à|al|au|hasta)\\s+)(?:${DATE_TOK}|${OPEN_ALT})`, "giu");
export function findDateRanges(text) {
  const t = asciiDigits(text), out = [];
  RANGE_RE.lastIndex = 0;
  let m;
  while ((m = RANGE_RE.exec(t))) {
    if (bound(t, m.index, m.index + m[0].length)) out.push({ start: m.index, end: m.index + m[0].length, word: m[0] });
    else RANGE_RE.lastIndex = m.index + 1;
  }
  return out;
}

/* ---------- numbers and figures ---------- */

const SPELLED_EN = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50 };
const SPELLED_DE = { eins: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwölf: 12,
  dreizehn: 13, vierzehn: 14, fünfzehn: 15, sechzehn: 16, siebzehn: 17, achtzehn: 18, neunzehn: 19, zwanzig: 20, dreißig: 30, vierzig: 40, fünfzig: 50 };
const SPELLED_OTHER = { deux: 2, trois: 3, quatre: 4, cinq: 5, dix: 10, vingt: 20, trente: 30, dos: 2, tres: 3, cuatro: 4, cinco: 5, diez: 10, veinte: 20, treinta: 30 };

/* A spelled number word (English, German, some French and Spanish), 2-59. */
export function spelledNumber(word) {
  const w = low(word).replace(/[‐-]/g, " ").trim();
  if (SPELLED_EN[w] !== undefined) return SPELLED_EN[w];
  if (SPELLED_OTHER[w] !== undefined) return SPELLED_OTHER[w];
  const de = w.replace(/^(zwei|drei)(er|en|em)$/, "$1");
  if (SPELLED_DE[de] !== undefined) return SPELLED_DE[de];
  let m = /^(twenty|thirty|forty|fifty) (one|two|three|four|five|six|seven|eight|nine)$/.exec(w);
  if (m) return SPELLED_EN[m[1]] + SPELLED_EN[m[2]];
  m = /^(ein|zwei|drei|vier|fünf|sechs|sieben|acht|neun)und(zwanzig|dreißig|vierzig|fünfzig)$/.exec(w);
  if (m) return (m[1] === "ein" ? 1 : SPELLED_DE[m[1]]) + SPELLED_DE[m[2]];
  return null;
}

const CURRENCY = matcher(["aed", "eur", "usd", "gbp", "sar", "chf", "mio", "mrd", "bn", "mn"]);
const SPELLED_FIG = matcher(["two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "twenty", "thirty", "forty",
  "fifty", "hundred", "hundreds", "thousand", "thousands", "million", "millions", "billion", "dozen", "dozens", "doubled", "tripled", "halved",
  "zwei", "zweier", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun", "zehn", "elf", "zwölf", "hundert", "tausend", "million",
  "millionen", "milliarde", "milliarden", "verdoppelt", "halbiert"]);

/* Digit runs not glued to a letter (B2B, G20 do not count), with their value
   normalised: thousand separators out, a unit suffix kept. */
function numberRuns(text) {
  const t = asciiDigits(text), out = [];
  const re = /\d[\d,.]*\d|\d/g;
  let m;
  while ((m = re.exec(t))) {
    const s = m.index, e = s + m[0].length;
    if (s > 0 && /\p{L}/u.test(t[s - 1])) continue;
    if (e < t.length && /\p{L}/u.test(t[e]) && !/^(?:k|m|mn|bn|mio|mrd|million|x)(?![\p{L}])/iu.test(t.slice(e))) continue;
    const suf = (/^\s?(%|k|m|mn|bn|mio|mrd|million)(?![\p{L}])/iu.exec(t.slice(e)) || [""])[0];
    const digits = m[0].replace(/[,.](?=\d{3}(?!\d))/g, "").replace(/[.,]$/, "");
    out.push({ start: s, end: e + suf.length, raw: t.slice(s, e + suf.length), value: digits + low(suf).trim(), plain: m[0] });
  }
  return out;
}
const isYear = (n) => /^\d{4}$/.test(n.value) && +n.value >= 1950 && +n.value <= 2039;

/**
 * hasFigure: does a line carry a magnitude? Date ranges are removed first; a
 * standalone year does not count, "B2B" does not count.
 */
export function hasFigure(s) {
  const t = maskSpans(str(s), findDateRanges(s));
  if (numberRuns(t).some((n) => !isYear(n))) return true;
  if (/[%€$£]/.test(t) || CURRENCY.test(t)) return true;
  return SPELLED_FIG.test(t);
}

/* YEARS_CLAIM: "more than 25 years", "über 25 Jahren", "two decades",
   "zwei Jahrzehnte", "a quarter century". Returns [{n, start, end, text}]. */
const YQUAL = "(?:(?:more than|over|nearly|almost|about|around|some|über|mehr als|fast|rund|knapp|plus de|près de|más de|casi)\\s+)?";
const YUNIT = "(?:years?|yrs|jahren?|ans|années|años|anni|عاماً|عاما|عام|سنة|سنوات)";
const YEARS_RE = new RegExp(`${YQUAL}(\\d{1,2})\\s*\\+?\\s*${YUNIT}`, "giu");
const YEARS_WORD_RE = new RegExp(`${YQUAL}([\\p{L}]+(?:[- ][\\p{L}]+)?)\\s+${YUNIT}`, "giu");
const DECADE_RE = /(?:(?:more than|over|nearly|almost|about|around|some|über|mehr als|fast|rund|knapp)\s+)?(\d|[\p{L}]+)\s+(decades?|jahrzehnten?)/giu;
export function yearsClaims(text) {
  const t = asciiDigits(text), out = [];
  const push = (m, n) => { if (n && bound(t, m.index, m.index + m[0].length)) out.push({ n, start: m.index, end: m.index + m[0].length, text: m[0] }); };
  let m;
  YEARS_RE.lastIndex = 0;
  while ((m = YEARS_RE.exec(t))) push(m, +m[1]);
  YEARS_WORD_RE.lastIndex = 0;
  while ((m = YEARS_WORD_RE.exec(t))) { const n = spelledNumber(m[1]); if (n) push(m, n); }
  DECADE_RE.lastIndex = 0;
  while ((m = DECADE_RE.exec(t))) { const k = /^\d$/.test(m[1]) ? +m[1] : spelledNumber(m[1]) || (/^(a|one|ein|eine)$/i.test(m[1]) ? 1 : 0); if (k) push(m, k * 10); }
  const q = /(?:a\s+)?quarter(?:\s+of\s+a)?\s+century|(?:ein\s+)?vierteljahrhundert/giu;
  while ((m = q.exec(t))) push(m, 25);
  return out.sort((a, b) => a.start - b.start);
}

/* ---------- language of a text ---------- */

const STOP = {
  en: new Set(["the", "and", "of", "with", "for", "to", "on", "from", "by", "across", "as"]),
  de: new Set(["und", "der", "die", "das", "mit", "für", "von", "den", "im", "zu", "als", "bei", "eine", "einer", "über", "sowie"]),
  fr: new Set(["le", "la", "les", "et", "du", "pour", "avec", "dans", "une", "sur"]),
  es: new Set(["el", "los", "las", "y", "del", "para", "con", "una", "por"]),
};
/**
 * langOf: 'ar' when more than 30% of the letters are Arabic; otherwise the
 * stopword set with the most hits, when it has 2 or more and beats the
 * runner-up; otherwise 'unknown' (never flagged). "an" and "des" are left out
 * because they are words in two languages each.
 */
export function langOf(text) {
  const t = low(text);
  let letters = 0, ar = 0;
  for (const ch of t) { if (/\p{L}/u.test(ch)) { letters++; const c = ch.codePointAt(0); if (c >= 0x600 && c <= 0x6ff) ar++; } }
  if (letters && ar / letters > 0.3) return "ar";
  const words = t.split(/[^\p{L}]+/u).filter(Boolean);
  const hits = Object.entries(STOP).map(([k, set]) => [k, words.filter((w) => set.has(w)).length]).sort((a, b) => b[1] - a[1]);
  return hits[0][1] >= 2 && hits[0][1] > hits[1][1] ? hits[0][0] : "unknown";
}

/* Sentences, not split after common abbreviations; Arabic splits on . ! ? ؟ too. */
const ABBR = ["e.g.", "i.e.", "etc.", "approx.", "ca.", "z.b.", "z. b.", "bzw.", "dr.", "st.", "no.", "u.a.", "inkl."];
export function sentences(text) {
  const t = str(text).trim(), out = [];
  if (!t) return out;
  let start = 0;
  for (let i = 0; i < t.length; i++) {
    if (!".!?؟".includes(t[i])) continue;
    const before = t.slice(start, i + 1).toLowerCase();
    if (ABBR.some((a) => before.endsWith(a) && (before.length === a.length || !/\p{L}/u.test(before[before.length - a.length - 1])))) continue;
    if (i + 1 >= t.length) break;
    if (!/\s/.test(t[i + 1])) continue;
    let j = i + 1;
    while (j < t.length && /\s/.test(t[j])) j++;
    if (j < t.length && (/[\p{Lu}\p{N}]/u.test(t[j]) || hasArabic(t[j]))) { out.push(t.slice(start, i + 1).trim()); start = j; i = j - 1; }
  }
  const rest = t.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

/* ---------- employers and places ---------- */

const LEGAL = /\s+(l\.?l\.?c\.?|fz-?llc|fze|fzco|gmbh|ag|ltd\.?|limited|plc|inc\.?|co\.|s\.a\.|sarl|kg|ug|llp)$/i;
const NOT_EMPLOYER = new Set(["independent", "self-employed", "self employed", "freelance", "selbständig", "selbstständig", "confidential", "various"]);
/* employerCore: the employer's own name, without the place after it or a legal suffix. */
export function employerCore(c) {
  let s = str(c);
  const cut = [" — ", " – ", " | ", " · ", ",", "("].map((x) => s.indexOf(x)).filter((i) => i >= 0);
  if (cut.length) s = s.slice(0, Math.min(...cut));
  s = s.trim();
  let prev;
  do { prev = s; s = s.replace(LEGAL, "").trim(); } while (s !== prev);
  if (s.length < 4 || NOT_EMPLOYER.has(s.toLowerCase())) return "";
  return s;
}
/* Words of an employer name that identify it ("GTI" in "GTI General Trading"). */
const GENERIC = new Set(["general", "trading", "group", "holding", "holdings", "company", "media", "the", "and", "of", "car", "rental",
  "services", "service", "international", "consulting", "solutions", "partners", "real", "estate", "deutschland", "gulf", "middle", "east"]);
const employerTokens = (c) => letterWords(employerCore(c)).map(low).filter((w) => w.length >= 3 && !GENERIC.has(w));

/* PLACE_GROUPS: alias lists whose match gives the country. */
const PLACES = {
  UAE: ["uae", "u.a.e.", "united arab emirates", "emirates", "vae", "vereinigte arabische emirate", "émirats arabes unis", "emiratos árabes unidos",
    "dubai", "abu dhabi", "sharjah", "ajman", "ras al khaimah", "ras al-khaimah", "ras al khaima", "ras al-khaima", "al ain", "al-ain",
    "fujairah", "umm al quwain", "الإمارات", "دبي", "أبوظبي", "الشارقة", "العين", "رأس الخيمة"],
  KSA: ["saudi arabia", "ksa", "saudi-arabien", "riyadh", "jeddah", "dammam"],
  QA: ["qatar", "katar", "doha"], KW: ["kuwait"], BH: ["bahrain", "manama"], OM: ["oman", "muscat"],
  DE: ["germany", "deutschland", "allemagne", "alemania", "berlin", "hamburg", "munich", "münchen", "hannover", "hanover", "frankfurt", "köln",
    "cologne", "düsseldorf", "stuttgart"],
  AT: ["austria", "österreich", "vienna", "wien"], CH: ["switzerland", "schweiz", "suisse", "zurich", "zürich", "geneva", "genf"],
  UK: ["united kingdom", "uk", "great britain", "britain", "england", "scotland", "wales", "london", "manchester", "birmingham", "edinburgh"],
  LB: ["lebanon", "libanon", "beirut"],
  FR: ["france", "frankreich", "paris"], ES: ["spain", "spanien", "madrid"], IT: ["italy", "italien", "rome", "milan"],
  NL: ["netherlands", "niederlande", "amsterdam"], BE: ["belgium", "belgien", "brussels"], PL: ["poland", "polen", "warsaw"],
  JO: ["jordan", "jordanien", "amman"], EG: ["egypt", "ägypten", "cairo", "alexandria", "giza"],
  IN: ["india", "indien", "mumbai", "bombay", "delhi", "new delhi", "bangalore", "bengaluru", "chennai", "hyderabad", "kolkata", "pune",
    "telangana", "maharashtra", "karnataka", "tamil nadu", "kerala", "gujarat", "west bengal", "uttar pradesh", "haryana", "andhra pradesh", "rajasthan"],
  PK: ["pakistan", "karachi", "lahore", "islamabad", "sindh", "khyber pakhtunkhwa", "balochistan"],
  PH: ["philippines", "philippinen", "manila", "metro manila", "cebu", "makati", "taguig", "quezon city", "pasig"],
  TR: ["turkey", "türkiye", "türkei", "istanbul", "ankara"],
};
/* LinkedIn's location forms, "Greater Mumbai Area" and "Dubai Metropolitan Area":
   a place even when the city inside is not in the lists above. */
const LINKEDIN_AREA = /^(?:greater\s+\p{L}[\p{L}\s.'’-]*\s+area|\p{L}[\p{L}\s.'’-]*\s+(?:metropolitan|metro)\s+area)$/iu;
const GCC = ["UAE", "KSA", "QA", "KW", "BH", "OM"];
const META = {
  GCC: { aliases: ["gcc", "gulf", "golfregion", "golfstaaten", "arabian gulf"], members: GCC },
  DACH: { aliases: ["dach"], members: ["DE", "AT", "CH"] },
  EU: { aliases: ["europe", "eu", "europa"], members: ["DE", "AT", "CH", "UK", "FR", "ES", "IT", "NL", "BE", "PL"] },
  MENA: { aliases: ["middle east", "mena", "nahost"], members: [...GCC, "LB", "JO", "EG"] },
  /* Punjab is a province of Pakistan and a state of India. */
  PUNJAB: { aliases: ["punjab"], members: ["PK", "IN"] },
};
const VAGUE = ["international", "global", "worldwide", "remote"];
const ALIAS = {};
for (const [k, list] of Object.entries(PLACES)) list.forEach((a) => (ALIAS[a] = { country: k }));
for (const [k, g] of Object.entries(META)) g.aliases.forEach((a) => (ALIAS[a] = { meta: k }));
const PLACE_M = matcher(Object.keys(ALIAS));
/* Every place alias in a text, with the country or meta region it names. */
export function placeHits(text) {
  return PLACE_M.all(text).map((h) => { const k = low(h.word).replace(/\s+/g, " "); return Object.assign(h, ALIAS[k] || ALIAS[k.replace(/-/g, " ")] || {}); });
}
const countriesIn = (text) => new Set(placeHits(text).filter((h) => h.country).map((h) => h.country));

/* "Every token is a place (or a vague geography word)": what a comma split leaves
   in a title or employer slot when the parser went wrong. */
function onlyPlaces(text, extra) {
  const hits = placeHits(text);
  if (!hits.length) return false;
  const rest = maskSpans(text, hits);
  return letterWords(rest).every((w) => extra.includes(low(w)) || /^(and|und|&)$/i.test(w));
}

/* ---------- vocabularies ---------- */

export const QUALIFIERS = ["major", "significant", "extensive", "numerous", "high-level", "high-impact", "high-profile", "world-class",
  "best-in-class", "leading-edge", "renowned", "prestigious", "outstanding", "exceptional", "excellent", "successful", "successfully",
  "strategic-level", "key", "umfangreich", "umfangreiche", "umfangreichen", "bedeutend", "bedeutende", "bedeutenden", "zahlreich", "zahlreiche",
  "zahlreichen", "hochrangig", "hochrangige", "hochrangigen", "namhaft", "namhafte", "namhaften", "erfolgreich", "erfolgreiche", "herausragend",
  "herausragende"];
export const BANNED_SUMMARY = ["recognised", "recognized", "proven", "high-performing", "results-driven", "results-oriented", "visionary",
  "major", "extensive", "dynamic", "passionate", "proven track record", "hard-working", "team player", "self-motivated", "detail-oriented",
  "go-to person", "seasoned", "accomplished", "world-class", "outstanding", "exceptional"];
export const BANNED_SUMMARY_DE = ["anerkannt", "anerkannte", "bewährt", "bewährte", "ergebnisorientiert", "ergebnisorientierte", "visionär",
  "visionäre", "umfangreich", "umfangreiche", "umfangreichen", "dynamisch", "dynamische", "leidenschaftlich", "leidenschaftliche",
  "zielstrebig", "zielstrebige", "hochmotiviert", "hochmotivierte"];
const HEADLINE_ADJ = ["experienced", "accomplished", "motivated", "dedicated", "talented", "highly", "top-performing", "award-winning",
  "strategic-minded", "erfahren", "erfahrener", "erfahrene", "engagiert", "engagierter"];

const TITLE_RANK_WORDS = ["advisor", "adviser", "advisory", "berater", "beraterin", "conseiller", "asesor", "consultant", "founder", "co-founder",
  "gründer", "gründerin", "fondateur", "fundador", "owner", "co-owner", "inhaber", "inhaberin", "propriétaire", "partner", "managing partner",
  "gesellschafter", "director", "direktor", "directeur", "directrice", "geschäftsführer", "geschäftsführerin", "managing", "manager", "leiter",
  "leiterin", "gérant", "gerente", "head", "chief", "officer", "president", "vice president", "vp", "ceo", "cfo", "coo", "cto", "cmo", "cio",
  "chairman", "chairwoman", "chairperson", "chair", "vorsitzender", "principal", "lead", "supervisor", "مدير", "رئيس", "مستشار", "شريك", "مؤسس", "مالك"];
export const TITLE_WORDS = matcher([...TITLE_RANK_WORDS, "executive", "specialist", "analyst", "engineer", "coordinator", "administrator",
  "associate", "assistant", "representative", "accountant", "controller", "auditor", "architect", "developer", "planner", "buyer", "trader",
  "kaufmann", "kauffrau", "referent", "sachbearbeiter"]);

/* ---------- HL-02: rank classes ---------- */

/* Each class is one rank. Terms inside a class are the same rank in different
   languages. COVERS is one-way: a held title covers the listed higher-or-equal
   headline classes, never the reverse. */
const RANK = {
  md: ["managing director", "geschäftsführer", "geschäftsführerin", "directeur général", "director general"],
  gm: ["general manager"],
  ceo: ["ceo", "chief executive officer", "chief executive"],
  cfo: ["cfo", "chief financial officer"], coo: ["coo", "chief operating officer"], cto: ["cto", "chief technology officer"],
  cmo: ["cmo", "chief marketing officer"], cio: ["cio", "chief information officer"],
  mp: ["managing partner"],
  vp: ["vice president", "vp", "vizepräsident"],
  president: ["president", "präsident", "président", "presidente"],
  chairman: ["chairman", "chairwoman", "chairperson", "vorsitzender", "vorsitzende"],
  chair: ["chair"],
  founder: ["founder", "gründer", "gründerin", "fondateur", "fondatrice", "fundador", "fundadora", "مؤسس"],
  owner: ["owner", "inhaber", "inhaberin", "propriétaire", "eigentümer", "مالك"],
  partner: ["partner", "gesellschafter", "شريك"],
  director: ["director", "direktor", "direktorin", "directeur", "directrice", "directora"],
  manager: ["manager", "managerin", "leiter", "leiterin", "gérant", "gerente"],
  head: ["head"], chief: ["chief"], officer: ["officer"],
  advisor: ["advisor", "adviser", "advisory", "berater", "beraterin", "conseiller", "conseillère", "asesor", "مستشار"],
  consultant: ["consultant", "consultante", "berater", "beraterin"],
  principal: ["principal"], lead: ["lead"], supervisor: ["supervisor"],
  mudir: ["مدير"], rais: ["رئيس"],
};
const COVERS = { md: ["director"], ceo: ["md", "gm", "director", "chief", "officer"], cfo: ["chief", "officer", "director"],
  coo: ["chief", "officer", "director"], cto: ["chief", "officer", "director"], cmo: ["chief", "officer", "director"],
  cio: ["chief", "officer", "director"], mp: ["partner"], president: ["vp"], chairman: ["chair"], gm: ["manager"] };
const TERM_CLASS = {};
for (const [k, list] of Object.entries(RANK)) for (const t of list) (TERM_CLASS[t] = TERM_CLASS[t] || []).push(k);
const RANK_M = matcher(Object.keys(TERM_CLASS));
/* German compounds: Vertriebsleiter, Unternehmensberater, Marketingdirektor. */
const SUFFIX = [[/\p{L}{3,}(leiter|leiterin)$/u, ["manager"]], [/\p{L}{3,}(berater|beraterin)$/u, ["advisor", "consultant"]],
  [/\p{L}{3,}(direktor|direktorin)$/u, ["director"]]];
/* Words that bind a rank to a lower one: a held "Deputy Managing Director" does
   not support "Managing Director". */
const BINDING = new Set(["deputy", "assistant", "associate", "acting", "junior", "trainee", "stellvertretend", "stellvertretender",
  "stellvertretende", "kommissarisch", "kommissarischer", "kommissarische", "sub"]);

function rankOccurrences(title) {
  const t = str(title), out = [];
  const segStart = (i) => Math.max(0, ...[",", ";", "|", "·", "/", "&", "–", "—", "(", " and ", " und "].map((x) => { const k = t.lastIndexOf(x, i - 1); return k < 0 ? 0 : k + x.length; }));
  const modOf = (s) => {
    const co = /co[-‐\s]?$/i.exec(t.slice(Math.max(0, s - 3), s));
    if (co && !/\p{L}/u.test(t[s - co[0].length - 1] || "")) return co[0];
    const pre = t.slice(segStart(s), s);
    return letterWords(pre).find((x) => BINDING.has(low(x))) || null;
  };
  for (const h of RANK_M.all(t)) for (const cls of TERM_CLASS[low(h.word).replace(/\s+/g, " ")] || []) out.push({ cls, start: h.start, end: h.end, word: h.word, mod: modOf(h.start) });
  const masked = maskSpans(t, RANK_M.all(t));
  const wre = /\p{L}+/gu;
  let m;
  while ((m = wre.exec(masked))) {
    for (const [re, classes] of SUFFIX) if (re.test(low(m[0]))) for (const cls of classes) out.push({ cls, start: m.index, end: m.index + m[0].length, word: m[0], mod: modOf(m.index) });
  }
  return out;
}

/* ---------- markets ---------- */

export const MARKETS = { gcc: "UAE / GCC", dach: "Germany / Austria / Switzerland", uk: "United Kingdom" };
const normMarket = (m) => { const k = low(m); return k === "gulf" || k === "uae" ? "gcc" : MARKETS[k] ? k : "gcc"; };
const DIAL = [["+971", "UAE"], ["+966", "KSA"], ["+974", "QA"], ["+965", "KW"], ["+973", "BH"], ["+968", "OM"], ["+961", "LB"],
  ["+49", "DE"], ["+43", "AT"], ["+41", "CH"], ["+44", "UK"]];
const LANG_EN = { en: "English", de: "German", ar: "Arabic", fr: "French", es: "Spanish", it: "Italian", nl: "Dutch", pt: "Portuguese", tr: "Turkish", ru: "Russian" };

/* The market the review opens with: from the city, GCC when unknown. */
export function defaultMarket(P, edits = {}) {
  const c = countriesIn(edits.city !== undefined ? edits.city : (P || {}).city);
  for (const k of c) { if (GCC.includes(k)) return "gcc"; if (["DE", "AT", "CH"].includes(k)) return "dach"; if (k === "UK") return "uk"; }
  return "gcc";
}
/* The document language the review opens with. */
export function defaultLang(market, P, letterLang) {
  if (letterLang) return low(letterLang);
  return market === "dach" && str(((P || {}).summary || {}).de).trim() ? "de" : "en";
}

/* ---------- languages (LNG) ---------- */

const LANGMAP = {
  german: ["german", "deutsch", "allemand", "alemán", "tedesco", "الألمانية"],
  arabic: ["arabic", "arabisch", "arabe", "árabe", "arabo", "العربية"],
  english: ["english", "englisch", "anglais", "inglés", "inglese", "الإنجليزية", "الانجليزية"],
  french: ["french", "französisch", "français", "francés", "francese", "الفرنسية"],
  spanish: ["spanish", "spanisch", "espagnol", "español", "spagnolo"],
  italian: ["italian", "italienisch", "italien", "italiano"], russian: ["russian", "russisch", "russe", "ruso"],
  turkish: ["turkish", "türkisch", "turc", "turco"], urdu: ["urdu"], hindi: ["hindi"], persian: ["farsi", "persian", "persisch"],
  chinese: ["chinese", "mandarin", "chinesisch"], portuguese: ["portuguese", "portugiesisch", "portugais"], dutch: ["dutch", "niederländisch"],
};
const LANG_GROUP = {};
for (const [g, list] of Object.entries(LANGMAP)) list.forEach((w) => (LANG_GROUP[w] = g));
const LANG_M = matcher(Object.keys(LANG_GROUP));
const NATIVE = ["native", "natively", "mother tongue", "muttersprache", "muttersprachlich", "muttersprachniveau", "langue maternelle", "nativo",
  "nativa", "lengua materna", "لغة أم", "اللغة الأم", "native or bilingual proficiency"];
const NONNATIVE = ["fluent", "fluently", "fließend", "verhandlungssicher", "business fluent", "business level", "advanced", "proficient", "courant",
  "couramment", "fluido", "بطلاقة"];
/* LinkedIn's levels other than "Native or bilingual" are levels, but never read as a
   claim of fluency: "Full professional proficiency" is how LinkedIn words it, not the candidate. */
const OTHER_LEVEL = ["basic", "conversational", "grundkenntnisse", "gut", "good", "intermediate", "working knowledge", "bilingual", "a1", "a2", "b1", "b2", "c1", "c2",
  "full professional proficiency", "professional working proficiency", "limited working proficiency", "elementary proficiency"];
const LEVEL_M = matcher([...NATIVE, ...NONNATIVE, ...OTHER_LEVEL]);
const levelKind = (w) => { const l = low(w).replace(/\s+/g, " "); return NATIVE.includes(l) ? "native" : NONNATIVE.includes(l) ? "nonnative" : "other"; };
const CONNECT = new Set(["and", "und", "et", "y", "sowie", "&"]);

/* Levels stated for each language in a free-text summary: "<lang> (<level>)",
   "<lang> auf <level>", "<lang> <level>", "<level> in <lang>", "<level> <lang>",
   each allowing a list of languages joined by and/und/commas. The nearest valid
   level wins. */
const LIST_SEP = "(?:,|and|und|&|et|y|sowie)";
const AFTER_OK = new RegExp(`^\\s*(?:${LIST_SEP}\\s*LANG\\s*)*(?:\\(|:|auf|au niveau|at)?\\s*$`, "i");
const BEFORE_OK = new RegExp(`^(?:\\s*|\\s*(?:in|en)\\s+(?:LANG\\s*${LIST_SEP}\\s*)*)$`, "i");
/* A name in a hyphen compound, or joined by "/" or "&" to one, is no language with a level
   ("German-speaking markets", "German/English-speaking", "German-Emirati trade"), as the CV Builder reads it. */
const COMPOUND_AFTER = /^(?:[-‐]\p{L}|\s*[/&]\s*\p{L}+[-‐]\p{L})/u;
function summaryLevels(text) {
  const t = str(text), langs = LANG_M.all(t).filter((L) => !COMPOUND_AFTER.test(t.slice(L.end))), levels = LEVEL_M.all(t), out = [];
  /* The text between two points, with every other language name as "LANG". */
  const mid = (a, b) => {
    let s = t.slice(a, b);
    for (const x of langs.filter((y) => y.start >= a && y.end <= b).sort((p, q) => q.start - p.start)) s = s.slice(0, x.start - a) + "LANG" + s.slice(x.end - a);
    return s;
  };
  for (const L of langs) {
    let best = null;
    for (const V of levels) {
      let ok = false, dist;
      if (V.start >= L.end) { ok = AFTER_OK.test(mid(L.end, V.start)); dist = V.start - L.end; }
      else if (V.end <= L.start) { ok = BEFORE_OK.test(mid(V.end, L.start)); dist = L.start - V.end; }
      if (ok && (!best || dist < best.dist)) best = { V, dist };
    }
    if (best) out.push({ group: LANG_GROUP[low(L.word)], lang: L, level: best.V, kind: levelKind(best.V.word) });
  }
  return out;
}
/* Levels in the Languages line: every level in the same part applies to every language in it. */
function langsLineLevels(langs) {
  const out = [], t = str(langs);
  let off = 0;
  for (const part of t.split(/([·,;|/])/)) {
    if (!/^[·,;|/]$/.test(part)) {
      const ls = LANG_M.all(part), vs = LEVEL_M.all(part);
      for (const L of ls) {
        if (vs.length) for (const V of vs) out.push({ group: LANG_GROUP[low(L.word)], lang: { ...L, start: L.start + off, end: L.end + off }, level: { ...V, start: V.start + off, end: V.end + off }, kind: levelKind(V.word) });
        else out.push({ group: LANG_GROUP[low(L.word)], lang: { ...L, start: L.start + off, end: L.end + off }, level: null, kind: null, part: part.trim() });
      }
    }
    off += part.length;
  }
  return out;
}

/* ---------- check catalogue ---------- */

const SECTION = { HDR: "Header", HL: "Headline", SUM: "Summary", EXP: "Experience", BUL: "Bullets", ACH: "Bullets", MET: "Figures",
  SKL: "Skills", LNG: "Languages", EDU: "Education", REF: "References", DOC: "Document language", MKT: "Market", ATS: "ATS" };
export const SECTIONS = ["Header", "Headline", "Summary", "Experience", "Bullets", "Figures", "Skills", "Languages", "Education", "References",
  "Document language", "Market", "ATS"];

/* Checks whose failure means the CV must not go out as it is: one-rule and
   privacy failures. Any unacknowledged high instance of these gates the verdict. */
export const GATES = new Set(["HDR-01", "HDR-02", "HDR-06", "HDR-07", "HDR-08", "HDR-09", "HDR-10", "HDR-11", "HDR-12", "HL-01", "HL-02", "HL-03",
  "SUM-01", "SUM-04", "SUM-06", "SUM-07", "EXP-01", "EXP-02", "EXP-03", "EXP-04", "BUL-08", "LNG-02", "REF-01", "DOC-01", "DOC-02", "ACH-01"]);

/* Checks the candidate cannot act on until the CV Builder can reorder, remove,
   join or format; without opts.builder they are shown with status 'later' and
   carry no penalty. */
const NEEDS_BUILDER = new Set(["EXP-06", "EXP-07", "EXP-11", "BUL-06", "BUL-07", "BUL-08", "MKT-02"]);

/* Why a high item cannot be marked as checked. */
const NO_ACK = "This must change before you send. It cannot be marked as checked, because ";

/* id: [title, rule, source, fix, builderStep, neverDoes, default severity] */
export const CHECKS = {
  "HDR-01": ["Name present and clean", "The first line of a CV is the candidate's name. Without it, or with contact data in its place, the CV cannot be filed.", "CV writer · structure 1", "Type your full name exactly as you want it printed.", "header", "Never takes a name from the email address, the file name or LinkedIn.", "high"],
  "HDR-02": ["Email, phone and location present and well-formed", "A recruiter who cannot reply cannot invite. A malformed email loses the application silently.", "CV writer · structure 1", "Type the email and mobile number you answer, and the city you live in now.", "header", "Never guesses or reformats an address or number, and never picks between two.", "high"],
  "HDR-03": ["Phone number in international format", "Cross-border recruiters dial from abroad; in the Gulf the mobile is expected with its country code.", "CV writer · UAE/GCC", "Write the number starting with + and your own country code.", "header", "Never adds a country code on its own.", "low"],
  "HDR-04": ["Location agrees with the phone number", "A location that contradicts the contact number, or is a region rather than a city, tells a recruiter the wrong thing about where you are.", "CV reviewer · contact line", "Put the city you live in now. If the difference is true (you are relocating, or you keep a foreign number), mark this as checked.", "header", "Never changes the location.", "med"],
  "HDR-05": ["Work-rights line", "Gulf and UK recruiters screen on visa and work rights first. A confirmed work-rights line answers that without printing a nationality.", "CV writer · principles 7", "Say what is true, in your words: the passport you hold and/or your visa or residency status.", "header", "Never derives work rights from nationality or a phone code.", "med"],
  "HDR-06": ["Raw nationality printed", "The portal never prints a raw nationality. It is a bias vector, and work rights are what an employer needs.", "The one rule · CV writer principles 7", "Remove the nationality from that field. Put your work rights in the Work rights field instead.", "header", "Never reads your stored nationality into anything printed, and never deletes it.", "high"],
  "HDR-07": ["Date of birth or age printed", "Date of birth and age invite age bias. UK and DACH norms leave them out, and the portal never prints them.", "The one rule · CV writer principles 7", "Delete the date of birth or age from your CV.", "header", "Never stores or prints a date of birth.", "high"],
  "HDR-08": ["Marital status or children printed", "Family status is a protected characteristic and carries no information about the job.", "The one rule · CV writer principles 7", "Remove it.", "header", "Never prints family details.", "high"],
  "HDR-09": ["Religion printed", "Religion is a protected characteristic and is never on the page.", "The one rule · CV writer principles 7", "Remove it.", "header", "Never prints religion.", "high"],
  "HDR-10": ["Health or family reason printed", "A medical or family detail on paper is a protected characteristic that invites bias no employer is entitled to. That includes the reason for a career break.", "The one rule · owner fact base", "Remove the detail. A dated gap can stand on its own, and you owe no reason on paper.", "experience", "Never asks why a gap exists, never suggests a reason, and never prints one.", "high"],
  "HDR-11": ["Photo on a UK CV", "UK equality norms mean no photo, and a photo never belongs on the version an ATS receives.", "CV writer · United Kingdom", "Choose a style without a photo, such as Plain, for UK applications.", "review", "Never adds a photo to an uploaded CV.", "high"],
  "HDR-12": ["Other personal data printed", "Gender, place of birth, a parent's name and passport, ID or visa numbers are bias vectors and a fraud risk, and no employer needs them on a CV.", "CV review critique · missing checks", "Remove it. Work rights say what an employer needs.", "header", "Never prints an ID number or personal detail.", "high"],
  "HL-01": ["Headline present in this language", "The line under the name is the first claim a recruiter reads. It must be your own positioning, in the document's language.", "CV writer · headline rules 1, 9", "Write one line that describes you using titles you have held and fields you have worked in.", "headline", "Never puts the job ad's role, or a translation, into the headline.", "high"],
  "HL-02": ["Headline names a title you never held", "The headline is built only from titles you actually held. A title not in the record is the first thing an interviewer exposes.", "CV writer · headline rules 1 · CV reviewer", "Use a title you actually held, with any limiting word it had (deputy, assistant, co-), and add the fields you worked in after it.", "headline", "Never suggests a higher title, and never takes one from a posting.", "high"],
  "HL-03": ["Headline carries a target role or application wording", "The target role belongs in the document caption and the letter, never under the name.", "CV writer · headline rules 3", "Keep only your own positioning. The portal writes the target role into the file caption.", "headline", "Never inserts a posting title.", "high"],
  "HL-04": ["Headline length", "The headline should hold at most about 90 characters, so it stays on one line in every style.", "CV writer · headline rules 2", "Keep the title and your two or three strongest fields, and cut the rest.", "headline", "Never shortens the headline itself.", "low"],
  "HL-05": ["Adjectives in the headline", "The headline states titles, fields and regions, not praise. Adjectives there read as self-assessment.", "CV writer · headline rules 2, 6", "Delete the adjective, or replace it with a field or region you worked in.", "headline", "Never replaces a word with one of its own.", "med"],
  "SUM-01": ["Summary present in this language", "The summary is what a recruiter reads in the first six seconds. Each language version must be written or approved by you.", "CV writer · structure 2", "Write the summary in this language yourself, or choose a language you have one in.", "summary", "Never translates or generates a summary.", "high"],
  "SUM-02": ["Summary shape: 3–4 sentences, 60–90 words", "A summary of 3–4 sentences and about 60–90 words gets read. One line is too thin, and a long paragraph gets skipped.", "CV writer · structure 2", "Too long: cut the sentence with the least scope. Too short: add a proof point from your roles.", "summary", "Never trims or pads the text.", "low"],
  "SUM-03": ["Praise words in the summary", "Scope before adjectives. Words like these carry no information unless a sourced fact backs them.", "CV writer · headline rules 6", "Delete the word, or replace it with the fact that justifies it (headcount, units, founded, promoted).", "summary", "Never supplies the replacement fact.", "med"],
  "SUM-04": ["Tailoring line appended to the summary", "The summary never names a target employer and never ends with a line of focus for a job. That reads as mail-merge text and adds a claim you never wrote.", "CV writer · headline rules 7", "Delete that sentence. Tailoring happens in the letter and through bullet order.", "summary", "Never adds tailoring text to your summary.", "high"],
  "SUM-05": ["Employer names in the summary", "The summary names scope, not employers. Employers already appear under Experience.", "CV writer · structure 2", "Describe the employer by its type and size instead, using facts from that role.", "summary", "Never rewrites the sentence.", "low"],
  "SUM-06": ["Years of experience claimed exceed your dates", "Years come from the role dates, rounded down. A recruiter subtracts the dates.", "CV writer · headline rules 4", "Use a number your dates support, or fix the dates.", "summary", "Never changes the number or the dates.", "high"],
  "SUM-07": ["A number in the summary or headline is not in your experience", "Every figure in the summary must come from a role line. An orphan figure is the error that survives until someone checks it.", "CV writer · principles 1", "Add the figure to the role it belongs to, in your words, or remove it from the summary.", "summary", "Never removes, rounds or moves the number.", "high"],
  "SUM-08": ["A place in the summary or headline is not in your experience", "A geography with no role behind it is a claim an interviewer tests.", "CV writer · principles 1 · bullet rules 4", "Remove the place, or add it to the role where you actually worked there.", "summary", "Never adds a place to a role.", "med"],
  "SUM-09": ["Summary has no proof point with scope", "Summary proof points name scope, not praise: staff, divisions, companies founded, promotions.", "CV writer · headline rules 6", "Add one proof point from your strongest role with its scope (headcount, units, founded).", "summary", "Never picks the proof point for you or invents a figure.", "med"],
  "SUM-10": ["First person in the summary", "CV summaries are written without I, my or ich; the name above already says whose CV it is.", "CV review critique · missing checks", "Start the sentence with what you did or are.", "summary", "Never rewrites the sentence.", "low"],
  "EXP-01": ["A role is missing its title, employer or dates", "Every experience entry prints title, employer, place and dates. A missing field reads as sloppiness or as something being hidden.", "CV writer · principles 3", "Type the missing field from your own records.", "experience", "Never fills a field, and never hides an empty one.", "high"],
  "EXP-02": ["A title field holds something that is not a job title", "Parsers put durations, places, dates or company names in the title slot, and the CV then prints them as your job.", "CV reviewer · upload parser", "Type your actual job title. The text shown here probably belongs in the dates or employer field.", "experience", "Never moves text between fields and never guesses the title.", "high"],
  "EXP-03": ["The employer field holds only a place", "A comma split can turn a company and its city into employer = the city. A place is not an employer.", "CV reviewer · upload parser", "Type the company name. Keep the city after it.", "experience", "Never guesses the employer.", "high"],
  "EXP-04": ["Dates cannot be read", "Dates a recruiter or an ATS cannot read make the whole timeline suspect.", "CV writer · structure 4", "Write the dates as month and year, e.g. 'Mar 2005 – Jan 2008'.", "experience", "Never guesses a missing month or year.", "high"],
  "EXP-05": ["Date formats are inconsistent, or months are missing", "One date format throughout, with months where the record has them. Year-only dates hide up to 22 months.", "CV writer · structure 4", "Add the month from your records.", "experience", "Never assumes a month.", "med"],
  "EXP-06": ["Date range dash", "Date ranges take an en dash (–). Hyphens and em dashes look careless and some parsers misread them.", "CV reviewer · dates", "Use '–' between the two dates.", "experience", "Never changes the dates' content.", "low"],
  "EXP-07": ["Roles are not in reverse-chronological order", "Reverse-chronological order, always. The date decides position; relevance decides space.", "CV writer · principles 4", "Reorder the roles in the CV Builder.", "experience", "Never reorders silently.", "med"],
  "EXP-08": ["Overlapping roles with no explanation", "Parallel roles are fine but need a note naming the other role. Otherwise a screener reads them as a date error.", "CV reviewer · dates", "If both roles ran at the same time, confirm it and add a note in your words naming the other role. If not, correct the dates.", "experience", "Never writes the note unless you confirm, and never shortens a role.", "med"],
  "EXP-09": ["Gaps in the timeline", "Recruiters notice gaps over about six months. The CV owes no reason; a gap only matters when the dates are wrong or something true is missing.", "CV writer · principles 4", "Check that the dates are right. If you did something true in that time that belongs on a CV (a role, a project, study), add it.", "experience", "Never asks why, never suggests a reason, never fills the gap.", "med"],
  "EXP-10": ["A role has no place", "Title, employer, place and dates is what every reader and every ATS parses.", "CV writer · principles 3", "Add the city or country where you did this job.", "experience", "Never takes a place from another role or from the company name.", "low"],
  "EXP-11": ["Older roles could become an 'Earlier career' line", "Roles more than about 15 years old collapse to one line each. They are never removed, so the dates stay continuous.", "CV writer · structure 4", "Let the Builder show the role as a one-line 'Earlier career' entry, or keep it in full if it matters for the jobs you target.", "experience", "Never deletes a role.", "low"],
  "EXP-12": ["End date in the future", "An end date after today that is not 'Present' reads as a typing error.", "CV review critique · missing checks", "Correct the date, or write Present if the role is current.", "experience", "Never changes the date.", "med"],
  "BUL-01": ["Number of bullets by recency", "Current role 4–6 bullets, the next two roles 2–4, older roles at most 2 (one more is tolerated without a posting).", "CV writer · bullet rules 5", "Too many: choose which to drop in the Builder. Too few: answer the questions for that role and write a bullet from your answer.", "experience", "Never deletes a bullet and never writes one.", "low"],
  "BUL-02": ["Bullet too long", "A bullet is at most about 180 characters (two printed lines). Past that, it stops being scanned.", "CV writer · bullet rules 9", "Split it into two bullets, or cut the trailing clause. Keep the verb and the object.", "experience", "Never shortens a bullet.", "low"],
  "BUL-03": ["Bullet does not open with a verb, or uses the wrong tense", "Open with a past-tense verb the source supports; the current role may use the present tense. No I or my.", "CV writer · bullet rules 2", "Start with the verb that describes what you did. Use the verb that is true: participated stays participated.", "experience", "Never supplies or upgrades a verb.", "low"],
  "BUL-04": ["Bullet opens with a job-description phrase", "'Responsible for' and 'duties included' describe a job advert, not what you did.", "CV writer · bullet rules 2", "Start with what you did, keeping it exactly as true as the original.", "experience", "Never turns participation into leadership.", "low"],
  "BUL-05": ["Qualifier with no figure behind it", "Unsourced qualifiers read as opinion. Either a figure backs them, or they go.", "CV writer · bullet rules 8", "Answer the question (what made it so: value, count, size?) and put the answer in the bullet, or delete the word.", "experience", "Never deletes the word for you.", "low"],
  "BUL-06": ["Duplicate bullets", "The same line twice reads as padding, and usually comes from merging two CVs.", "CV reviewer · LinkedIn as second source", "Keep the stronger one and delete the other in the Builder.", "experience", "Never deletes or merges bullets.", "med"],
  "BUL-07": ["A bullet looks like a fragment of the previous line", "PDF wrapping can split one bullet into two. A fragment reads as broken.", "CV reviewer · upload parser", "Join the two lines into one bullet, or finish the sentence.", "experience", "Never joins the lines or completes the text itself.", "med"],
  "BUL-08": ["A job title or date line is stuck among the bullets", "When a parser misses a role header, the next role's title or dates end up as a bullet of the role before, and that role is lost.", "CV reviewer · upload parser", "Make it its own role in the Builder with its employer and dates, or delete it if it is a duplicate.", "experience", "Never creates the role automatically.", "high"],
  "BUL-09": ["A bullet describes the company, not you", "One bullet is one achievement or responsibility of yours. A paragraph about what the company does belongs in a one-line scope note, if anywhere.", "CV writer · bullet rules 1", "Turn it into what you did there, or keep a short scope note (company type and size) above the bullets.", "experience", "Never rewrites it into an achievement.", "med"],
  "ACH-01": ["A bullet was written by a portal template", "Achievement bullets built from a template add words you never wrote (places, sectors, responsibilities). Only your own words may reach the CV.", "CV review critique · achievement templates", "Write this bullet yourself in the Builder, using only your answer and your own words.", "experience", "Never counts a template bullet as your evidence.", "high"],
  "MET-01": ["Few bullets carry a figure", "At director level, a claim without magnitude reads as activity. The remedy is your own figures, asked as questions and never estimated.", "CV writer · principles 6", "Answer the questions in the panel. Each real figure you give becomes one bullet you write in the Builder.", "experience", "Never estimates, rounds or adds a figure.", "med"],
  "MET-02": ["Recent role with no figure (question only)", "Missing metrics become questions for you, never placeholders or estimates. An unanswered question never reaches a document.", "CV writer · principles 6", "Answer what you can. Skip what you cannot: nothing is printed for a skipped question.", "experience", "Never turns a question into a bullet without your words.", "low"],
  "MET-03": ["A claim-heavy skill with no line to back it", "P&L, budget and investor relations are claims an interviewer tests. Until a bullet says it, the CV says what the record shows.", "CV writer · trace table", "If you held it, say so in a bullet with its scope. If not, rename the skill to what your bullets show.", "skills", "Never renames a skill or writes the bullet.", "med"],
  "SKL-01": ["A skill no bullet evidences", "The skills block is the ATS keyword set. Only competencies at least one of your bullets shows belong there.", "CV writer · structure 3", "Remove the skill, or add the bullet that shows it, from your real work.", "skills", "Never adds a skill, and never removes one without you.", "med"],
  "SKL-02": ["Languages listed as skills", "Languages belong in the Languages line with their level, not in the keyword block.", "CV reviewer · skills hygiene", "Delete them from Skills. Check that they appear in Languages with your level.", "skills", "Never moves or deletes them for you.", "med"],
  "SKL-03": ["Number of skills", "8–10 core competencies scan well. Fewer looks thin; more dilutes the keyword block (12 print at most).", "CV writer · structure 3", "Keep the 8–10 your bullets show most clearly.", "skills", "Never chooses which to cut.", "low"],
  "SKL-04": ["Soft skills or market labels in the keyword block", "Hard skills only. Soft skills show through bullets, and a market label is not a skill.", "CV reviewer · skills hygiene", "Keep them only if they are core to the roles you target. Your bullets already show them.", "skills", "Never deletes them.", "low"],
  "SKL-05": ["Near-duplicate or lower-case skills", "Two skills where one repeats the other read as padding. Lower-case imports look unedited.", "CV reviewer · skills hygiene", "Keep one wording, in title case.", "skills", "Never merges them.", "low"],
  "LNG-01": ["Languages line present", "Languages with levels are a real differentiator in the Gulf and DACH, and they carry the regional signal without a nationality.", "CV writer · structure 7", "List each language you speak with your level (native, fluent, business, basic).", "languages", "Never guesses a language.", "med"],
  "LNG-02": ["A native language is described as fluent", "Language levels are your own. A native language stays native in every version, never 'fluent' or 'verhandlungssicher'.", "The one rule · CV writer principles 8", "Use the native level everywhere for that language.", "languages", "Never changes a level for you.", "high"],
  "LNG-03": ["A language without a level", "A language with no level leaves the reader guessing.", "CV writer · structure 7", "Add your level after each language.", "languages", "Never assigns a level.", "low"],
  "LNG-04": ["A language in the summary is missing from the Languages line", "The Languages line is where a recruiter and an ATS look; a language named only in the summary is easy to miss.", "CV review critique · missing checks", "Add the language and your level to the Languages line.", "languages", "Never adds a language for you.", "low"],
  "EDU-01": ["Education or qualification present", "Education completes the record. In DACH, the Ausbildung with its awarding body and date is expected.", "CV writer · structure 5", "Add your highest qualification: its exact name, the awarding body, and the year.", "education", "Never infers a qualification from job titles.", "med"],
  "EDU-02": ["Education line cut off or joined", "A detail line cut mid-word or a tab-joined grade looks broken on the page.", "CV reviewer · education block", "Retype the line in full.", "education", "Never completes the words.", "low"],
  "EDU-03": ["English CV with German-only qualification details", "Keep the credential's original name, and give the details in the document language. The wording is yours, never a translation made for you.", "CV writer · structure 5 · CV reviewer", "Keep the credential's name as it is. Write the date, grade and school in English yourself.", "education", "Never translates the line.", "low"],
  "EDU-04": ["Qualification without a year", "A DACH reader expects the qualification's date.", "CV writer · DACH", "Add the year from your certificate.", "education", "Never guesses the year.", "low"],
  "REF-01": ["Referee contact details printed", "State that a reference exists. Contact details appear only after the referee has confirmed they can be reached.", "CV writer · structure 8", "Remove the contact details. Keep a line saying the written reference exists and a copy is available on request.", "review", "Never prints a referee's contact details.", "high"],
  "REF-02": ["References line missing in this language", "A one-line references sentence closes the CV in the document's language.", "CV writer · structure 8", "Write the references sentence in this language.", "review", "Never translates it.", "low"],
  "REF-03": ["A referee is named", "A referee is named only once they have confirmed they can be reached.", "CV writer · questions for the candidate", "Confirm the referee can be reached, then mark this as checked; until then keep only that a written reference exists.", "review", "Never prints a referee's name for you.", "med"],
  "DOC-01": ["Titles and bullets are not in the document language", "Offer a CV language only when titles and bullets exist in it. Machine translation is never done on your behalf.", "CV reviewer · non-English CVs", "Choose the language your CV is written in, or write your titles and bullets in this language yourself.", "review", "Never translates a line.", "high"],
  "DOC-02": ["Summary is in another language", "The summary in each language is your own. A summary, or a sentence of it, in another language breaks the document.", "CV writer · headline rules 9", "Write this language's summary yourself.", "summary", "Never translates.", "high"],
  "DOC-03": ["Dates or languages line not in the document language", "Dates, 'Present' and the languages line follow the document language.", "CV reviewer · non-English CVs", "Write the dates and the languages line in this language yourself.", "languages", "Never translates free text.", "med"],
  "DOC-04": ["Arabic CV needs a native reader (question only)", "An Arabic CV goes out under your name. It needs a native-speaker read.", "CV writer · Arabic-language CV", "Have a native speaker read it before you send it.", "review", "Never produces Arabic text.", "low"],
  "DOC-05": ["German wording rules", "German style: einschließlich, not inklusive; teams are geführt or geleitet, not gesteuert; ich kommuniziere, not die Kommunikation führen.", "CV writer · DACH", "Use einschließlich / geführt / ich kommuniziere.", "summary", "Never edits your German.", "low"],
  "MKT-01": ["US spelling on a UK CV", "UK readers expect British spelling (organisation, programme).", "CV writer · United Kingdom", "Use the British spelling.", "experience", "Never changes spelling for you.", "low"],
  "MKT-02": ["Date style for the chosen market", "GCC and UK readers expect 'Mar 2005 – Jan 2008'. A DACH Lebenslauf uses '03/2005 – 01/2008'.", "CV writer · per market", "Write the dates in this market's style, or let the Builder format them.", "experience", "Never alters the stored dates.", "low"],
  "MKT-03": ["Market questions (question only)", "Some facts only you can confirm, and each market asks for different ones.", "CV writer · per market", "Answer or skip.", "header", "Never prints an answer you have not confirmed.", "low"],
  "MKT-04": ["Likely length", "Two A4 pages at most for a long career; one page under about 8 years of experience. This is an estimate from the word count.", "CV writer · structure 9", "Condense older roles and trim the current role to 4–6 bullets.", "experience", "Never cuts content itself.", "low"],
  "ATS-01": ["Characters that break ATS parsing", "The ATS copy must be clean text. Tabs, private-use glyphs, emoji and doubled bullet marks garble parsing.", "CV writer · principles 9", "Retype the line without the symbol.", "experience", "Never strips characters silently.", "low"],
  "ATS-02": ["Dangling separators in a field", "A field that starts or ends with a separator prints an empty slot, which an ATS reads as a missing field.", "CV reviewer · missing fields", "Delete the stray separator or fill in the missing part.", "experience", "Never fills in the missing part.", "low"],
};

/* ---------- context ---------- */

function context(P, o) {
  P = P && typeof P === "object" ? P : {};
  const edits = o.edits || {};
  const market = normMarket(o.market);
  const L = low(o.lang || "en") || "en";
  const now = new Date();
  const today = o.today && o.today.y ? { y: +o.today.y, m: +o.today.m || 1 } : { y: now.getFullYear(), m: now.getMonth() + 1 };
  const T = idx(today.y, today.m);
  const real = !!(o.real !== undefined ? o.real : o.hasReal);
  const T_ = P.title || {};
  const over = (k) => (edits[k] !== undefined ? { path: "edits." + k, text: str(edits[k]) } : { path: k, text: str(P[k]) });

  /* Roles, their dates and their bullets. */
  const roles = (Array.isArray(P.experience) ? P.experience : []).map((e, i) => {
    e = e || {};
    const pd = parseDates(e.d);
    const bullets = (Array.isArray(e.bullets) ? e.bullets : []).map((b, j) => ({ j, x: str(b && b.x), ach: !!(b && b.ach), achKey: b && b.ach,
      tags: ((b && b.tags) || []).map(low), path: `experience.${i}.bullets.${j}` }));
    const r = { i, e, t: str(e.t), c: str(e.c), d: str(e.d), pd, bullets, tags: (e.tags || []).map(low),
      readable: !!(pd.from && !pd.from.open), current: !!(pd.to && pd.to.open) };
    r.fp = norm(employerCore(r.c) || r.c || r.t) + "|" + (r.readable ? pd.from.y + "-" + (pd.from.m || "") : norm(r.d));
    return r;
  });
  /* ORDER: readable roles newest first (by end, then start); an unreadable role
     keeps its place after the last readable role stored before it. */
  const readable = roles.filter((r) => r.readable).sort((a, b) =>
    late(b.pd.to, T) - late(a.pd.to, T) || early(b.pd.from, T) - early(a.pd.from, T) || a.i - b.i);
  const order = readable.slice();
  for (const r of roles.filter((x) => !x.readable)) {
    const prev = roles.slice(0, r.i).reverse().find((x) => x.readable);
    order.splice(prev ? order.indexOf(prev) + 1 : 0, 0, r);
  }
  order.forEach((r, k) => (r.rank = k));

  /* careerYears from the dates, never from the clock alone. */
  let careerMonths = 0;
  if (readable.length) {
    const start = Math.min(...readable.map((r) => early(r.pd.from, T)));
    const end = readable.some((r) => r.current) ? T : Math.max(...readable.map((r) => late(r.pd.to, T)));
    careerMonths = Math.max(0, end - start);
  }

  /* What prints in the header. The headline mirrors ownHeadline(): the
     language's own, else English, else German, else the latest job title. */
  const hl = str(T_[L]).trim() ? { path: "title." + L, text: str(T_[L]) }
    : str(T_.en).trim() ? { path: "title.en", text: str(T_.en) } : str(T_.de).trim() ? { path: "title.de", text: str(T_.de) }
    : roles[0] && roles[0].t ? { path: "experience.0.t", text: roles[0].t } : { path: "title." + L, text: "" };
  const wrText = o.workRights !== undefined ? str(o.workRights) : str(P.workRights || (!real ? P.nationality : "") || "").trim();
  const wr = { path: P.workRights ? "workRights" : !real && P.nationality ? "nationality" : "workRights", text: wrText };
  const header = { name: over("name"), headline: hl, city: over("city"), phone: over("phone"), email: over("email"), workRights: wr };
  const HEADERF = Object.entries(header).map(([field, f]) => ({ field, ...f }));
  const summaryL = { path: "summary." + L, text: str((P.summary || {})[L]) };
  /* Per-application summaries the Draft saved: these are what actually print for that job. */
  const jobSums = Object.keys(edits).filter((k) => k.startsWith("sum_") && typeof edits[k] === "string")
    .map((k) => ({ path: "edits." + k, text: edits[k], label: (o.jobNames || {})[k.slice(4)] || k.slice(4) }));
  const edu = Array.isArray(P.education) ? P.education : [];
  const comps = Array.isArray(P.competencies) ? P.competencies : [];

  const PRINTED = [...HEADERF.map((f) => ({ ...f, kind: "header" })), { path: "langs", text: str(P.langs), field: "langs", kind: "langs" },
    { ...summaryL, field: "summary", kind: "summary" }];
  for (const r of roles) {
    PRINTED.push({ path: `experience.${r.i}.t`, text: r.t, role: r.i, field: "t", kind: "role" }, { path: `experience.${r.i}.c`, text: r.c, role: r.i, field: "c", kind: "role" },
      { path: `experience.${r.i}.d`, text: r.d, role: r.i, field: "d", kind: "role" });
    for (const b of r.bullets) PRINTED.push({ path: b.path, text: b.x, role: r.i, bullet: b.j, field: "b", kind: "bullet" });
  }
  if (edu[0]) PRINTED.push({ path: "education.0.b", text: str(edu[0].b), field: "edu.b", kind: "edu" }, { path: "education.0.s", text: str(edu[0].s), field: "edu.s", kind: "edu" });
  comps.forEach((c, k) => PRINTED.push({ path: `competencies.${k}.0`, text: str((c || [])[0]), field: "comp", kind: "comp", comp: k }));
  PRINTED.push({ path: "refs." + L, text: str((P.refs || {})[L]), field: "refs", kind: "refs" });

  /* The candidate's own lines: every non-template bullet, titles, employers,
     dates and education. Template bullets never count as evidence. */
  const srcBullets = roles.flatMap((r) => r.bullets.filter((b) => !b.ach).map((b) => ({ ...b, role: r.i })));
  const sourceLines = [...roles.flatMap((r) => [{ path: `experience.${r.i}.t`, text: r.t }, { path: `experience.${r.i}.c`, text: r.c }, { path: `experience.${r.i}.d`, text: r.d }]),
    ...srcBullets.map((b) => ({ path: b.path, text: b.x })), ...edu.flatMap((e, k) => [{ path: `education.${k}.b`, text: str((e || {}).b) }, { path: `education.${k}.s`, text: str((e || {}).s) }])];

  return { P, o, edits, market, L, today, T, real, roles, order, careerMonths, careerYears: Math.floor(careerMonths / 12), header, HEADERF,
    summaryL, jobSums, edu, comps, PRINTED, srcBullets, sourceLines, builder: !!o.builder, cvStyle: str(o.cvStyle),
    employers: roles.map((r) => employerCore(r.c)).filter(Boolean) };
}

/* ---------- evidence helpers ---------- */

const ev = (path, text, hit, note) => ({ path, text: str(text), ...(hit ? { hit: [hit.start, hit.end] } : {}), ...(note ? { note } : {}) });
const roleLabel = (r) => [r.t, employerCore(r.c) || r.c].filter(Boolean).join(" · ") || r.d;
/* A role named in a question from the fields that exist, so an empty title or
   employer never prints as “” or (). */
const empOf = (r) => employerCore(r.c) || r.c.trim();
const roleRef = (r) => { const t = r.t.trim(), e = empOf(r); return t && e ? `“${t}” (${e})` : t ? `“${t}”` : e ? `the role at ${e}` : `role ${r.i + 1}`; };
const yourRole = (r) => { const t = r.t.trim(), e = empOf(r); return t || e ? "your role" + (t ? ` as “${t}”` : "") + (e ? ` at “${e}”` : "") : `role ${r.i + 1}`; };
const atRole = (r) => (empOf(r) ? `At ${empOf(r)}, ` : r.t.trim() ? `As ${r.t.trim()}, ` : `In role ${r.i + 1}, `);
const inst = (sev, evidence, extra = {}) => ({ sev, evidence: Array.isArray(evidence) ? evidence : [evidence], ...extra });

/* The summaries a summary check reads: this language's, plus every per-job summary. */
const summaries = (c) => [{ ...c.summaryL, label: null }, ...c.jobSums.map((s) => ({ ...s, label: "Summary edited for a job: " + s.label }))].filter((s) => s.text.trim());

/* ---------- the checks ---------- */

const RUN = {};

RUN["HDR-01"] = (c) => {
  const f = c.header.name, t = f.text.trim();
  const letters = (t.match(/\p{L}/gu) || []).length, digits = (t.match(/\d/g) || []).length;
  return letters < 2 || t.includes("@") || digits >= 3 ? [inst("high", ev(f.path, f.text, null, t ? "This does not read as a name." : "No name."), { field: "name" })] : [];
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;
RUN["HDR-02"] = (c, Q) => {
  const out = [], { email, phone, city } = c.header;
  if (!EMAIL_RE.test(email.text.trim())) out.push(inst("high", ev(email.path, email.text, null, email.text.trim() ? "The email is not a valid address." : "No email."), { field: "email" }));
  const nd = (phone.text.match(/\d/g) || []).length;
  if (!phone.text.trim() || nd < 7 || nd > 15) out.push(inst("high", ev(phone.path, phone.text, null, phone.text.trim() ? "The phone number has " + nd + " digits." : "No phone number."), { field: "phone" }));
  if (!city.text.trim()) out.push(inst("med", ev(city.path, city.text, null, "No location."), { field: "city" }));
  /* Two sources that disagree, or two values in one field, become a question. */
  for (const k of ["email", "phone", "city"]) {
    const e = c.edits[k], p = str(c.P[k]);
    if (e !== undefined && str(e).trim() && p.trim() && norm(e) !== norm(p)) Q.add("Q-CONTACT", "HDR-02", { key: "Q-CONTACT|" + k, field: k, quote: str(e),
      question: `Your CV shows “${str(e)}” but your profile says “${p}”. Which one do you answer?`, why: "The portal never picks between two addresses or numbers." });
  }
  if ((email.text.match(/@/g) || []).length > 1) Q.add("Q-CONTACT", "HDR-02", { key: "Q-CONTACT|email2", field: "email", quote: email.text,
    question: `“${email.text}” holds more than one address. Which one should print?`, why: "The portal never picks between two addresses." });
  return out;
};

RUN["HDR-03"] = (c) => {
  const p = c.header.phone, t = p.text.trim();
  return t && !/^(\+|00)/.test(t) ? [inst("low", ev(p.path, p.text), { field: "phone" })] : [];
};

RUN["HDR-04"] = (c) => {
  const p = c.header.phone.text.replace(/\s|-/g, "").replace(/^00/, "+"), city = c.header.city;
  const out = [];
  const dial = DIAL.find(([code]) => p.startsWith(code));
  const inCity = countriesIn(city.text);
  if (dial && inCity.size && !inCity.has(dial[1])) out.push(inst("med", [ev(city.path, city.text, placeHits(city.text).find((h) => h.country)), ev(c.header.phone.path, c.header.phone.text)], { field: "city", note: "The location and the phone's country code point to different countries." }));
  /* Only a region or a vague word ("GCC", "Middle East", "International"). */
  if (city.text.trim() && !inCity.size) {
    const hits = placeHits(city.text);
    const rest = letterWords(maskSpans(city.text, hits)).map(low).filter((w) => !CONNECT.has(w));
    if ((hits.length || rest.length) && rest.every((w) => VAGUE.includes(w)))
      out.push(inst("low", ev(city.path, city.text, null, "This names a region, not a city."), { field: "city" }));
  }
  return out;
};

RUN["HDR-05"] = (c, Q) => {
  if (c.market === "dach") return { status: "na" };
  if (c.header.workRights.text.trim()) return [];
  if (c.market === "uk") Q.add("Q-RTW", "HDR-05", { key: "Q-RTW", question: "Do you have the right to work in the UK? If yes, may it be printed, and in what words?", why: "UK recruiters screen on right to work first." });
  else Q.add("Q-WR", "HDR-05", { key: "Q-WR", question: "What is your work-rights or visa status, in the words you want printed?", why: "Gulf recruiters screen on visa and residency status first." });
  return [inst(c.market === "uk" ? "low" : "med", ev(c.header.workRights.path, "", null, "No work-rights line prints."), { field: "workRights" })];
};

const DEMONYM_ACK = "This names a market, a language or a company, not my nationality";
const BORN_ACK = "This is not about me";
const DATE_ACK = "This is not my date of birth or my age";
/* The name and the email address are the candidate's own identifiers: "Christian
   Weber", "german.lopez@…", "max.born@…" name no religion, nationality or birth, so
   the personal-detail scans read every other printed field and skip those two. */
const ownId = (f) => f.field === "name" || f.field === "email";
const notName = (c) => c.HEADERF.filter((f) => !ownId(f));
const printedNotName = (c) => c.PRINTED.filter((f) => !ownId(f));
/* Places and employer names are masked, so "Saudi Arabia" or "Deutsche Bank" is never read as a nationality. */
const maskOf = (c, text) => [...placeHits(text), ...matcher(c.employers).all(text)];
/* One printed field through the shared personal-data scan (personal-data.js). A
   header field reads every demonym that is not a market, a language or the
   work-rights line; running text reads only a self-description. The stored
   nationality joins the demonym list for every profile, built-in or uploaded. */
const personal = (c, f) => findPersonalData(f.text, { zone: f.kind === "header" ? "header" : "text", workRights: f.field === "workRights",
  nationality: c.P.nationality, mask: maskOf(c, f.text), employers: c.employers });
const spanOf = (h) => ({ start: h.index, end: h.index + h.text.length });
/* Every printed field but the name and email, plus the per-job summaries. */
const personalFields = (c) => [...printedNotName(c), ...summaries(c).filter((s) => s.label).map((s) => ({ ...s, field: "summary", kind: "summary" }))];
/* A labelled hit ("Nationality:", "Date of birth:") is never a false positive and
   cannot be dismissed; every other hit can, with the words that fit it. */
const pdInst = (f, h, note, ackLabel) => inst("high", ev(f.path, f.text, spanOf(h), note), { field: f.field, ...(h.label ? {} : { override: true, ackLabel }) });

RUN["HDR-06"] = (c) => {
  const out = [], seen = new Set();
  for (const f of personalFields(c)) for (const h of personal(c, f)) {
    if (h.kind !== "nationality" || seen.has(f.path + ":" + h.index)) continue;
    seen.add(f.path + ":" + h.index);
    const note = h.label ? "A nationality label prints." : f.kind === "header" ? "A nationality prints in the header." : f.label || "A nationality prints in the summary.";
    out.push(pdInst(f, h, note, DEMONYM_ACK));
  }
  /* Two passports on the work-rights line print more than one nationality. */
  const wr = c.header.workRights;
  const wrs = demonymUses(wr.text, { mask: maskOf(c, wr.text), nationality: c.P.nationality }).filter((d) => d.use === "workRights");
  if (wrs.length >= 2) out.push(inst("med", ev(wr.path, wr.text, wrs[0], "More than one nationality prints."), { field: "workRights" }));
  return out;
};

/* A date of birth: a label, "born" + a date or a year (never a company's birth),
   "Jahrgang 1975"; an age ("Age: 45", "45 years old", "j'ai 45 ans", never "20 ans
   d'expérience"); and, in the header, an unlabelled full date, which the candidate
   can mark as not a birthday (a visa expiry, an availability date). */
RUN["HDR-07"] = (c) => {
  /* An age prints wherever it is written, as the CV Builder reads it; a bare date only
     counts in the header (personal-data.js reads it there only). */
  const hits = personalFields(c).flatMap((f) => personal(c, f)
    .filter((h) => h.kind === "dob" || h.kind === "age" || h.kind === "date").map((h) => ({ f, h })));
  return [...hits.filter((x) => x.h.label), ...hits.filter((x) => !x.h.label)]
    .map(({ f, h }) => pdInst(f, h, h.kind === "date" ? "A full date prints in the header." : undefined, h.kind === "dob" ? BORN_ACK : DATE_ACK));
};

const MARITAL_LABELS = matcher(["marital status", "familienstand", "état civil", "situation familiale", "estado civil", "الحالة الاجتماعية"]);
const MARITAL_WORDS = new Set(["married", "single", "divorced", "widowed", "verheiratet", "ledig", "geschieden", "verwitwet", "marié", "mariée", "célibataire", "casado", "casada", "soltero", "متزوج", "أعزب"]);
const CHILDREN_RE = /(?:^|[^\p{L}\d])(?:\d+|one|two|three|four|five|ein|eine|zwei|drei|vier|fünf|un|deux|trois)\s+(?:children|child|kids|kinder|kind|enfants?)(?![\p{L}])/giu;
RUN["HDR-08"] = (c) => {
  const out = [];
  for (const f of printedNotName(c)) for (const h of MARITAL_LABELS.all(f.text)) out.push(inst("high", ev(f.path, f.text, h), { field: f.field }));
  for (const f of notName(c)) {
    /* A bare status word counts only as a whole header segment or after a label. */
    const re = /[^|·,;/—–]+/g;
    let m;
    while ((m = re.exec(f.text))) {
      const seg = m[0].replace(/^[^:]*:/, ""), off = m.index + (m[0].length - seg.length);
      const w = seg.trim();
      if (MARITAL_WORDS.has(w.toLowerCase())) { const s = off + seg.indexOf(w); out.push(inst("high", ev(f.path, f.text, { start: s, end: s + w.length }), { field: f.field, override: true })); }
    }
    CHILDREN_RE.lastIndex = 0;
    while ((m = CHILDREN_RE.exec(f.text))) out.push(inst("high", ev(f.path, f.text, { start: m.index, end: m.index + m[0].length }), { field: f.field, override: true }));
  }
  return out;
};

const RELIGION_LABELS = matcher(["religion", "konfession", "religionszugehörigkeit", "الديانة"]);
RUN["HDR-09"] = (c) => {
  const out = [];
  for (const f of printedNotName(c)) for (const h of RELIGION_LABELS.all(f.text)) out.push(inst("high", ev(f.path, f.text, h), { field: f.field }));
  /* A religion word as a self-description ("Dubai, UAE · Christian", "a practising Muslim"), never a name ("Christian Dior"),
     in every printed field, as the CV Builder reads it. */
  for (const f of personalFields(c))
    for (const h of personal(c, f)) if (h.kind === "religion" && !h.label) out.push(inst("high", ev(f.path, f.text, spanOf(h)), { field: f.field, override: true }));
  return out;
};

const HEALTH = matcher(["health reasons", "health recovery", "health issue", "health issues", "health condition", "medical leave", "medical reasons",
  "illness", "disability", "disabled", "chronic", "sick leave", "burnout", "burn-out", "rehabilitation", "krankheit", "erkrankung",
  "gesundheitliche gründe", "behinderung", "schwerbehindert", "genesung", "reha", "maternity leave", "paternity leave", "parental leave",
  "elternzeit", "mutterschutz", "caring for", "care for a family member", "pflege von angehörigen", "family reasons", "familiäre gründe"]);
const BREAK = matcher(["career break", "break", "auszeit", "sabbatical", "pause", "gap", "family time", "berufspause"]);
RUN["HDR-10"] = (c) => {
  const out = [];
  const scan = (path, text, field, role) => { for (const h of HEALTH.all(text)) out.push(inst("high", ev(path, text, h), { field, role, override: true })); };
  for (const s of summaries(c)) scan(s.path, s.text, "summary");
  for (const f of notName(c)) scan(f.path, f.text, f.field);
  for (const r of c.roles) {
    if (r.pd.note) for (const h of HEALTH.all(r.d)) out.push(inst("high", ev(`experience.${r.i}.d`, r.d, h), { field: "d", role: r.i, override: true }));
    if (BREAK.test(r.t)) {
      scan(`experience.${r.i}.t`, r.t, "t", r.i);
      scan(`experience.${r.i}.c`, r.c, "c", r.i);
      if (!r.pd.note) scan(`experience.${r.i}.d`, r.d, "d", r.i);
      for (const b of r.bullets) scan(b.path, b.x, "b", r.i);
    } else for (const b of r.bullets) if (BREAK.test(b.x)) scan(b.path, b.x, "b", r.i);
  }
  return out;
};

RUN["HDR-11"] = (c) => {
  if (c.market !== "uk") return { status: "na" };
  return (c.cvStyle === "lux" || c.cvStyle === "stone") && !c.real ? [inst("high", ev("cvStyle", "", null, "Your designed style prints a portrait."), { field: "style" })] : [];
};

/* Place-of-birth labels and "born in Beirut" come from personal-data.js. */
const PERSONAL_LABELS = matcher(["gender", "sex", "geschlecht", "father's name", "father’s name", "name of father", "name des vaters", "اسم الأب", "الجنس"]);
/* An ID holds a digit ("Passport: German (EU)", "ID number available on request" hold none);
   a visa's expiry date is no ID number (a full one in the header is HDR-07's dismissable date). */
const ID_RE = /(?:passport|reisepass|visa|visum|emirates id|iqama|id)\s*(?:no\.?|number|nr\.?|nummer|#)\s*:?\s*(?=[A-Z0-9-]*\d)[A-Z0-9-]{5,}|(?:passport|visa|emirates id|iqama)\s*:\s*(?=[A-Z0-9-]*\d)[A-Z0-9-]{5,}|784[-\s]?\d{4}[-\s]?\d{7}[-\s]?\d/giu;
RUN["HDR-12"] = (c) => {
  const out = [];
  const fields = [...notName(c), ...summaries(c).map((s) => ({ ...s, field: "summary" })), { path: "refs." + c.L, text: str((c.P.refs || {})[c.L]), field: "refs" }];
  for (const f of fields) {
    for (const h of PERSONAL_LABELS.all(f.text)) if (f.field !== "summary" || /:/.test(f.text.slice(h.end, h.end + 2))) out.push(inst("high", ev(f.path, f.text, h), { field: f.field }));
    ID_RE.lastIndex = 0;
    let m;
    while ((m = ID_RE.exec(asciiDigits(f.text)))) out.push(inst("high", ev(f.path, f.text, { start: m.index, end: m.index + m[0].length }), { field: f.field }));
  }
  for (const f of personalFields(c)) for (const h of personal(c, f)) if (h.kind === "birthplace") out.push(pdInst(f, h, h.label ? undefined : "A place of birth prints.", BORN_ACK));
  return out;
};

RUN["HL-01"] = (c, Q) => {
  const own = str((c.P.title || {})[c.L]);
  if (own.trim()) return [];
  Q.add("Q-HL", "HL-01", { key: "Q-HL|" + c.L, gate: true, question: "In one line, using titles you have held: how do you describe yourself?", why: "The headline is the first claim a recruiter reads." });
  const hl = c.header.headline;
  const note = hl.text.trim() ? `Your ${LANG_EN[c.L] || c.L} CV would show “${hl.text}” instead.` : "No headline prints.";
  return [inst("high", ev(hl.text.trim() ? hl.path : "title." + c.L, hl.text, null, note), { field: "headline" })];
};

RUN["HL-02"] = (c) => {
  const title = str((c.P.title || {})[c.L]);
  if (!title.trim()) return { status: "na" };
  const held = c.roles.flatMap((r) => rankOccurrences(r.t).map((o) => ({ ...o, role: r.i })));
  const heldList = c.roles.map((r) => r.t).filter(Boolean);
  const out = [];
  for (const h of rankOccurrences(title)) {
    const covering = held.filter((o) => o.cls === h.cls || (COVERS[o.cls] || []).includes(h.cls));
    if (covering.some((o) => o.mod === null || (h.mod && low(o.mod).replace(/[-‐\s]/g, "") === low(h.mod).replace(/[-‐\s]/g, "")))) continue;
    const limited = covering.find((o) => o.mod);
    const note = limited ? `Your title “${c.roles[limited.role].t}” carries “${limited.mod}”; the headline drops it.`
      : `Titles you held: ${heldList.map((t) => "“" + t + "”").join(", ") || "none"}.`;
    out.push(inst("high", ev("title." + c.L, title, h, note), { field: "headline" }));
  }
  /* The same word flagged for two classes (berater) is one finding. */
  const seen = new Set();
  return out.filter((i) => { const k = i.evidence[0].hit.join(); if (seen.has(k)) return false; seen.add(k); return true; });
};

const HL_TARGET = matcher(["application for", "applying for", "candidate for", "target role", "bewerbung als", "bewerbung für", "bewerbung um", "candidature", "seeking", "looking for", "open to", "aspiring"]);
RUN["HL-03"] = (c) => { const t = str((c.P.title || {})[c.L]); return HL_TARGET.all(t).map((h) => inst("high", ev("title." + c.L, t, h), { field: "headline" })); };

RUN["HL-04"] = (c) => {
  const t = str((c.P.title || {})[c.L]), n = t.trim().length;
  if (n <= 90) return [];
  return [inst(n > 120 ? "med" : "low", ev("title." + c.L, t, null, `${n} characters (target 90 or fewer).`), { field: "headline" })];
};

RUN["HL-05"] = (c) => {
  const t = str((c.P.title || {})[c.L]);
  return matcher([...BANNED_SUMMARY, ...HEADLINE_ADJ, ...BANNED_SUMMARY_DE]).all(t).map((h) => inst("med", ev("title." + c.L, t, h), { field: "headline" }));
};

RUN["SUM-01"] = (c, Q) => {
  if (c.summaryL.text.trim()) return [];
  const lang = LANG_EN[c.L] || c.L;
  Q.add("Q-SUM", "SUM-01", { key: "Q-SUM|" + c.L, gate: true, question: `Write your ${lang} summary yourself (3–4 sentences). Nothing is translated for you.`, why: "Each language version must be yours." });
  return [inst("high", ev(c.summaryL.path, "", null, `No ${lang} summary.`), { field: "summary" })];
};

RUN["SUM-02"] = (c) => {
  const t = c.summaryL.text;
  if (!t.trim()) return { status: "na" };
  const w = wordCount(t), s = sentences(t).length;
  const note = `${w} words · ${s} sentences (target 60–90 · 3–4).`;
  if (w < 45 || w > 120 || s < 2 || s > 5) return [inst("med", ev(c.summaryL.path, t, null, note), { field: "summary" })];
  if (w < 60 || w > 90 || s < 3 || s > 4) return [inst("low", ev(c.summaryL.path, t, null, note), { field: "summary" })];
  return [];
};

RUN["SUM-03"] = (c) => {
  const M = matcher(c.L === "de" ? [...BANNED_SUMMARY, ...BANNED_SUMMARY_DE] : BANNED_SUMMARY);
  return summaries(c).flatMap((s) => M.all(s.text).map((h) => inst("med", ev(s.path, s.text, h, s.label), { field: "summary" })));
};

const TAILOR = matcher(["focus for", "schwerpunkt für", "my focus at", "mein schwerpunkt bei", "focus chez", "enfoque para"]);
RUN["SUM-04"] = (c) => summaries(c).flatMap((s) => {
  const hits = TAILOR.all(s.text);
  let from = 0;
  for (const sen of sentences(s.text)) {
    const at = s.text.indexOf(sen, from);
    from = at + sen.length;
    const m = /^(focus|schwerpunkt)(?![\p{L}])/iu.exec(sen);
    if (m && !hits.some((h) => h.start === at)) hits.push({ start: at, end: at + m[0].length });
  }
  return hits.map((h) => inst("high", ev(s.path, s.text, h, s.label), { field: "summary" }));
});

RUN["SUM-05"] = (c) => {
  const M = matcher(c.employers);
  const t = c.summaryL.text;
  return M.all(t).map((h) => inst("low", ev(c.summaryL.path, t, h), { field: "summary" }));
};

/* Months covered by the roles that name a country (merged, conservative reading). */
function spanFor(c, countries) {
  const iv = c.roles.filter((r) => r.readable && [r.c, r.t, r.d, ...r.bullets.filter((b) => !b.ach).map((b) => b.x)].some((x) => {
    for (const h of placeHits(x)) { if (h.country && countries.includes(h.country)) return true; if (h.meta && META[h.meta].members.some((m) => countries.includes(m))) return true; }
    return false;
  })).map((r) => [early(r.pd.from, c.T), late(r.pd.to, c.T)]).sort((a, b) => a[0] - b[0]);
  let total = 0, cur = null;
  for (const [s, e] of iv) { if (!cur || s > cur[1] + 1) { if (cur) total += cur[1] - cur[0] + 1; cur = [s, e]; } else cur[1] = Math.max(cur[1], e); }
  if (cur) total += cur[1] - cur[0] + 1;
  return total;
}

RUN["SUM-06"] = (c) => {
  const out = [];
  const texts = [...summaries(c).map((s) => ({ ...s, field: "summary" })), { path: "title." + c.L, text: str((c.P.title || {})[c.L]), field: "headline" }];
  for (const f of texts) for (const y of yearsClaims(f.text)) {
    if (!c.careerMonths) { out.push(inst("med", ev(f.path, f.text, y, "Your dates cannot be read, so this cannot be checked."), { field: f.field })); continue; }
    /* A claim scoped to a place ("15 years in the GCC") is checked against the roles there. */
    const next = f.text.slice(y.end).split(/\s+/).slice(0, 5).join(" ");
    const place = placeHits(next)[0];
    if (place && place.start <= next.length) {
      const countries = place.country ? [place.country] : META[place.meta].members;
      const yrs = Math.floor(spanFor(c, countries) / 12);
      if (y.n > yrs) out.push(inst("high", ev(f.path, f.text, y, `This says ${y.n} years; your roles that name ${place.word} cover ${yrs}.`), { field: f.field }));
      continue;
    }
    if (y.n > c.careerYears) out.push(inst("high", ev(f.path, f.text, y, `This says ${y.n} years; your dates cover ${c.careerYears}.`), { field: f.field }));
  }
  return out;
};

/* Number tokens a summary may carry, with the two words that follow each. */
const FIG_STOP = new Set(["the", "a", "an", "and", "of", "in", "for", "to", "with", "und", "der", "die", "das", "mit", "von", "für", "im", "in", "over", "across"]);
const nextWords = (t, end) => letterWords(t.slice(end)).map(low).filter((w) => !FIG_STOP.has(w)).slice(0, 2);
const stem = (w) => low(w).replace(/(ing|ed|es|s|en|n)$/u, "");
const SPELLED_1_12 = matcher(["two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "zwei", "zweier", "drei", "dreier", "vier", "fünf", "sechs", "sieben", "acht", "neun", "zehn", "elf", "zwölf"]);
const FOUNDED = matcher(["founded", "co-founded", "gegründet", "mitgegründet"]);
/* Numbers in a line, digits or spelled 2-12, years and years-of-experience claims left out. */
function lineNumbers(t) {
  const claims = yearsClaims(t);
  const inClaim = (s) => claims.some((y) => s >= y.start && s < y.end);
  const nums = numberRuns(t).filter((n) => !isYear(n) && !inClaim(n.start));
  for (const h of SPELLED_1_12.all(t)) if (!inClaim(h.start)) nums.push({ start: h.start, end: h.end, raw: h.word, value: String(spelledNumber(h.word)) });
  return nums.sort((a, b) => a.start - b.start);
}
RUN["SUM-07"] = (c) => {
  const out = [];
  const src = c.sourceLines.filter((l) => l.text.trim()).map((l) => ({ ...l, nums: lineNumbers(l.text), lang: langOf(l.text) }));
  const foundedRoles = c.roles.filter((r) => r.bullets.some((b) => !b.ach && FOUNDED.test(b.x))).length;
  const texts = [...summaries(c).map((s) => ({ ...s, field: "summary" })), { path: "title." + c.L, text: str((c.P.title || {})[c.L]), field: "headline" }];
  for (const f of texts) {
    const sens = sentences(f.text);
    for (const n of lineNumbers(f.text)) {
      const sentence = sens.find((s) => { const at = f.text.indexOf(s); return at <= n.start && n.start < at + s.length; }) || f.text;
      if (/found|gründ/i.test(sentence) && String(foundedRoles) === n.value && foundedRoles > 0) continue;
      /* The same value must sit in one of your lines before the same word
         ("250 staff" / "250 staff"). A value that carries its unit (18%, 4m)
         needs only the value; lines in two different languages are compared
         on the value alone, since nothing here translates. */
      const myNext = nextWords(f.text, n.end).map(stem), myLang = langOf(f.text), unit = /[^\d]$/.test(n.value);
      const sameValue = src.filter((l) => l.nums.some((x) => x.value === n.value));
      const ok = sameValue.some((l) => l.nums.some((x) => x.value === n.value && (unit || l.lang !== myLang || l.lang === "unknown" || myLang === "unknown" || nextWords(l.text, x.end).map(stem).some((w) => myNext.includes(w)))));
      if (ok) continue;
      const e = [ev(f.path, f.text, n, (f.label ? f.label + ". " : "") + (sameValue.length ? "The number is in your roles, but with different words. Which role is this from?" : "Which role is this from?"))];
      if (sameValue.length) e.push(ev(sameValue[0].path, sameValue[0].text, sameValue[0].nums.find((x) => x.value === n.value)));
      out.push(inst("high", e, { field: f.field }));
    }
  }
  return out;
};

/* A place word inside a company's name in running text: "Bank of India", "Emirates
   NBD", "Dubai Holding", "Pakistan Petroleum". The name is a client or a company,
   not a place the candidate claims. A name here is a run of capitalised words that
   holds a company word, or one of the candidate's employers; a capitalised word
   alone does not make one, so "Greater Cairo", "Northern Germany" and "Across
   India" stay places. */
const COMPANY_NAME_WORDS = new Set(["bank", "banque", "air", "airline", "airlines", "airways", "airport", "holding", "holdings", "group", "petroleum",
  "oil", "gas", "properties", "property", "realty", "estates", "telecom", "telecommunications", "nbd", "insurance", "investment", "investments",
  "capital", "development", "developments", "llc", "ltd", "gmbh", "plc", "inc", "fze", "fz-llc", "corporation", "corp", "company", "co",
  "industries", "trading", "motors", "steel", "cement", "energy", "electricity", "authority", "ports", "logistics", "shipping", "partners",
  "ventures", "finance", "financial", "securities", "exchange", "media", "television", "broadcasting", "hospital", "university", "municipality",
  "chamber", "pharma", "pharmaceuticals", "foods", "mall", "hotels", "resorts", "consultancy", "services", "solutions", "systems"]);
const NAME_TOKEN = /\p{Lu}[\p{L}\p{N}&.’'-]*|of|de|du|des|di|del|for|&|al|el/uy;
function inCompanyName(text, h, employers = []) {
  if (matcher(employers).all(text).some((e) => e.start <= h.start && e.end >= h.end)) return true;
  /* The capitalised run around the place, joined by single spaces or "of" / "&". */
  const words = [];
  const grab = (at) => { NAME_TOKEN.lastIndex = at; const m = NAME_TOKEN.exec(text); return m && bound(text, at, at + m[0].length) ? m[0] : null; };
  for (let e = h.end; ;) {
    const sp = /^[ \t]+/.exec(text.slice(e));
    const w = sp && grab(e + sp[0].length);
    if (!w) break;
    words.push(w);
    e += sp[0].length + w.length;
  }
  for (let s = h.start; ;) {
    const m = /(\p{Lu}[\p{L}\p{N}&.’'-]*|of|de|du|des|di|del|for|&|al|el)[ \t]+$/u.exec(text.slice(0, s));
    if (!m || !bound(text, m.index, m.index + m[1].length)) break;
    words.push(m[1]);
    s = m.index;
  }
  return words.some((w) => COMPANY_NAME_WORDS.has(low(w).replace(/[.’']+$/u, "")));
}
RUN["SUM-08"] = (c) => {
  const have = new Set();
  const lines = [...c.sourceLines.map((l) => l.text), c.header.city.text];
  for (const l of lines) for (const k of countriesIn(l)) have.add(k);
  const out = [];
  const texts = [...summaries(c).map((s) => ({ ...s, field: "summary" })), { path: "title." + c.L, text: str((c.P.title || {})[c.L]), field: "headline" }];
  /* Only running text: a Title Case headline would read every place as a name. */
  for (const f of texts) for (const h of placeHits(f.text)) {
    if (f.field === "summary" && inCompanyName(f.text, h, c.employers)) continue;
    const ok = h.country ? have.has(h.country) : META[h.meta].members.some((m) => have.has(m));
    if (!ok) out.push(inst("med", ev(f.path, f.text, h, (f.label ? f.label + ". " : "") + (have.size ? "Places your roles show: " + [...have].join(", ") + "." : "No role names a place.")), { field: f.field }));
  }
  return out;
};

const SCOPE_WORDS = matcher(["founded", "co-founded", "promoted", "staff", "employees", "people", "divisions", "stations", "sites", "branches", "countries",
  "markets", "gegründet", "gründung", "befördert", "mitarbeiter", "mitarbeitern", "filialen", "standorte"]);
RUN["SUM-09"] = (c) => {
  const t = c.summaryL.text;
  if (!t.trim()) return { status: "na" };
  return hasFigure(t) || SCOPE_WORDS.test(t) ? [] : [inst("med", ev(c.summaryL.path, t), { field: "summary" })];
};

const FIRST_PERSON = matcher(["i", "my", "me", "ich", "mein", "meine", "meinen", "meiner", "mich", "mir"]);
RUN["SUM-10"] = (c) => {
  const t = c.summaryL.text;
  return FIRST_PERSON.all(t).map((h) => inst("low", ev(c.summaryL.path, t, h), { field: "summary" }));
};

const FIELD_NAME = { t: "job title", c: "employer", d: "dates" };
RUN["EXP-01"] = (c, Q) => {
  if (!c.roles.length) return [inst("high", ev("experience", "", null, "No roles."), { field: "experience" })];
  const out = [];
  for (const r of c.roles) for (const k of ["t", "c", "d"]) {
    if (r[k].trim()) continue;
    const label = [employerCore(r.c) || r.c, r.d].filter((x) => x.trim()).join(" · ") || r.t;
    out.push(inst("high", ev(`experience.${r.i}.${k}`, "", null, `Role ${r.i + 1} (${label || "no details"}): ${FIELD_NAME[k]} missing.`), { role: r.i, field: k }));
    Q.add("Q-MISS", "EXP-01", { key: `Q-MISS|${r.fp}|${k}`, role: r.i, gate: true, field: k, quote: label,
      question: `Role ${r.i + 1} (${label || "no details"}) has no ${FIELD_NAME[k]}. What was it?`, why: "A missing field reads as something being hidden." });
  }
  return out;
};

const DURATION_RE = /^\s*(?:\d+\s*\+?\s*(years?|yrs?|months?|mos?|jahre?n?|monate?n?|ans?|mois|años|meses)(?![\p{L}])|(?:less than|under|weniger als|moins d'un|menos de)\s+(?:a|one|ein|einem|un|une)?\s*(?:year|month|jahr|monat|an|mois|año|mes)(?![\p{L}]))/iu;
const DURATION_WORDS = new Set(["years", "year", "yrs", "yr", "months", "month", "mos", "mo", "jahre", "jahr", "monate", "monat", "ans", "mois", "años", "meses"]);
const COMPANY_WORDS = matcher(["llc", "gmbh", "ltd", "limited", "fz-llc", "fze", "group", "holding", "inc", "plc", "trading"]);
RUN["EXP-02"] = (c) => {
  const out = [];
  for (const r of c.roles) {
    const t = r.t;
    if (!t.trim()) continue;
    let why = null;
    if (DURATION_RE.test(t)) why = "This reads as a duration.";
    else if (parseDates(t).from) why = "This reads as a date.";
    else {
      const ranges = findDateRanges(t);
      if (ranges.length && letterWords(maskSpans(t, ranges)).filter((w) => !DURATION_WORDS.has(low(w))).length < 2) why = "This reads as a date.";
      else if (onlyPlaces(t, ["international", "remote"])) why = "This reads as a place.";
      else if (!TITLE_WORDS.test(t) && COMPANY_WORDS.test(t)) why = "This reads as a company name.";
    }
    if (why) out.push(inst("high", ev(`experience.${r.i}.t`, t, null, why), { role: r.i, field: "t" }));
  }
  return out;
};

const employerParts = (c) => str(c).split(/[–—|·,/&]| - | and | und /).map((x) => x.trim()).filter(Boolean);
/* The employer field holds only places ("Dubai", "Lahore, Pakistan", "Greater Mumbai Area",
   "Greater Istanbul"). "Greater" without "Area" counts only before a known place,
   so "Greater Anglia" stays a company. */
const employerIsPlace = (c) => !!str(c).trim() && employerParts(c).every((tok) => LINKEDIN_AREA.test(tok) || onlyPlaces(tok, ["international", "remote", "worldwide", "global"]) || onlyPlaces(tok.replace(/^greater\s+/i, ""), []) || VAGUE.includes(low(tok)));
RUN["EXP-03"] = (c) => c.roles.filter((r) => employerIsPlace(r.c))
  .map((r) => inst("high", ev(`experience.${r.i}.c`, r.c), { role: r.i, field: "c" }));

RUN["EXP-04"] = (c) => {
  const out = [];
  for (const r of c.roles) {
    if (!r.d.trim()) continue;
    const { from, to } = r.pd;
    if (!from || from.open) {
      if (hasArabic(r.d)) continue;                          // non-Latin script not understood: not judged
      out.push(inst("high", ev(`experience.${r.i}.d`, r.d, null, "These dates cannot be read."), { role: r.i, field: "d" }));
    } else if (early(from, c.T) > late(to, c.T)) out.push(inst("high", ev(`experience.${r.i}.d`, r.d, null, "The start is after the end."), { role: r.i, field: "d" }));
    else if (early(from, c.T) > c.T) out.push(inst("high", ev(`experience.${r.i}.d`, r.d, null, "The start is in the future."), { role: r.i, field: "d" }));
  }
  return out;
};

RUN["EXP-12"] = (c) => c.roles.filter((r) => r.readable && !r.pd.to.open && !r.pd.single && early(r.pd.to, c.T) > c.T)
  .map((r) => inst("med", ev(`experience.${r.i}.d`, r.d, null, "The end date is after today."), { role: r.i, field: "d" }));

RUN["EXP-05"] = (c, Q) => {
  const out = [], fmts = new Set();
  const sides = [];
  for (const r of c.roles.filter((x) => x.readable)) {
    sides.push({ r, side: r.pd.from, which: "start" });
    if (!r.pd.single && !r.pd.to.open) sides.push({ r, side: r.pd.to, which: "end" });
  }
  sides.forEach((s) => fmts.add(s.side.fmt));
  if (fmts.has("Mon YYYY") && fmts.has("MM/YYYY")) {
    const odd = sides.filter((s) => s.side.fmt === "MM/YYYY");
    const few = sides.filter((s) => s.side.fmt === "Mon YYYY").length < odd.length ? sides.filter((s) => s.side.fmt === "Mon YYYY") : odd;
    const s = few[0];
    out.push(inst("med", ev(`experience.${s.r.i}.d`, s.r.d, locate(s.r.d, s.side.text), "Two date formats are mixed."), { role: s.r.i, field: "d" }));
  }
  if (sides.some((s) => s.side.fmt !== "YYYY")) for (const s of sides.filter((x) => x.side.fmt === "YYYY")) {
    out.push(inst("low", ev(`experience.${s.r.i}.d`, s.r.d, locate(s.r.d, s.side.text), `The ${s.which} month is missing.`), { role: s.r.i, field: "d" }));
    Q.add("Q-MONTH", "EXP-05", { key: `Q-MONTH|${s.r.fp}|${s.which}`, role: s.r.i, field: "d", quote: s.r.d,
      question: `Which month did ${yourRole(s.r)} ${s.which} in ${s.side.y}?`, why: "A year alone hides up to eleven months." });
  }
  return out;
};
/* Where a side's text sits inside the dates string (for the highlight). */
function locate(d, text) {
  const t = asciiDigits(d), i = t.lastIndexOf(text);
  return i >= 0 ? { start: i, end: i + text.length } : null;
}

RUN["EXP-06"] = (c) => c.roles.filter((r) => r.readable && !r.pd.single && ["-", "--", "—"].includes(r.pd.sep))
  .map((r) => inst("low", ev(`experience.${r.i}.d`, r.d, locate(r.d, r.pd.sep)), { role: r.i, field: "d" }));

RUN["EXP-07"] = (c) => {
  const out = [], key = (r) => [late(r.pd.to, c.T), early(r.pd.from, c.T)];
  for (let i = 0; i + 1 < c.roles.length; i++) {
    const a = c.roles[i], b = c.roles[i + 1];
    if (!a.readable || !b.readable) continue;
    const ka = key(a), kb = key(b);
    if (ka[0] < kb[0] || (ka[0] === kb[0] && ka[1] < kb[1]))
      out.push(inst("med", [ev(`experience.${a.i}.d`, a.d, null, `${roleLabel(a)} is listed above ${roleLabel(b)}.`), ev(`experience.${b.i}.d`, b.d)], { role: a.i, field: "order" }));
  }
  return out;
};

const PARALLEL = matcher(["parallel", "in parallel", "alongside", "concurrent", "concurrently", "simultaneous", "simultaneously", "at the same time",
  "part-time", "non-executive", "freelance", "zeitgleich", "parallel zu", "nebenberuflich", "teilzeit", "en parallèle"]);
const PART_TITLE = matcher(["part-time", "non-executive", "board member", "freelance", "teilzeit", "nebenberuflich"]);
/* A pair is explained when one role's dates, note or title says it ran in
   parallel and names the other role (its employer or a word of its title). */
function explains(a, b) {
  const text = [a.d, a.pd.note, a.t].join(" ");
  if (!PARALLEL.test(text)) return false;
  const words = [...employerTokens(b.c), ...letterWords(b.t).map(low).filter((w) => w.length >= 4 && !BINDING.has(w))];
  const core = employerCore(b.c);
  return (core && matcher([core]).test(text)) || (words.length > 0 && matcher(words).test(text.replace(/\s+/g, " ")));
}
RUN["EXP-08"] = (c, Q) => {
  const out = [], rs = c.roles.filter((r) => r.readable);
  for (let x = 0; x < rs.length; x++) for (let y = x + 1; y < rs.length; y++) {
    const a = rs[x], b = rs[y];
    const ov = Math.min(loTo(a.pd.to, c.T), loTo(b.pd.to, c.T)) - Math.max(loFrom(a.pd.from, c.T), loFrom(b.pd.from, c.T)) + 1;
    if (ov < 2) continue;
    if (explains(a, b) || explains(b, a) || PART_TITLE.test(a.t) || PART_TITLE.test(b.t)) continue;
    /* Two current roles overlap by one more month every month: "checked" is keyed on the two dates as written,
       and on the pair in a fixed order, so moving a role up or down keeps the answer. */
    const [p, q] = a.fp <= b.fp ? [a, b] : [b, a];
    out.push(inst("med", [ev(`experience.${a.i}.d`, a.d, null, `${roleLabel(a)} and ${roleLabel(b)} overlap by at least ${ov} months.`), ev(`experience.${b.i}.d`, b.d)], { role: a.i, field: "overlap", pairKey: p.fp + "&" + q.fp, ackBasis: p.d + " | " + q.d }));
    Q.add("Q-PAR", "EXP-08", { key: `Q-PAR|${p.fp}|${q.fp}`, role: a.i, field: "d", quote: a.d,
      question: `Did you hold ${roleRef(a)} and ${roleRef(b)} at the same time? Answer yes, or no — the dates are wrong.`, why: "Overlapping dates with no note read as an error." });
  }
  return out;
};

RUN["EXP-09"] = (c) => {
  const rs = c.roles.filter((r) => r.readable);
  if (!rs.length) return [];
  const iv = rs.map((r) => [early(r.pd.from, c.T), late(r.pd.to, c.T), r]).sort((a, b) => a[0] - b[0]);
  const out = [], merged = [];
  for (const v of iv) { const m = merged[merged.length - 1]; if (m && v[0] <= m[1] + 1) { if (v[1] > m[1]) { m[1] = v[1]; m[2] = v[2]; } } else merged.push(v.slice()); }
  const gap = (s, e, before, after) => {
    const n = e - s + 1;
    if (n < 6) return;
    const e1 = [ev(`experience.${before.i}.d`, before.d, null, `${fmtIdx(s)} – ${fmtIdx(e)}: ${n} months with no role.`)];
    if (after) e1.push(ev(`experience.${after.i}.d`, after.d));
    /* A gap that runs to today grows every month: its "checked" is keyed on where it starts. */
    out.push(inst(n > 12 ? "med" : "low", e1, { role: before.i, field: "gap", ...(after ? {} : { ackBasis: fmtIdx(s) }) }));
  };
  for (let k = 1; k < merged.length; k++) {
    const prevEnd = merged[k - 1][1], nextStart = merged[k][0];
    const before = rs.filter((r) => late(r.pd.to, c.T) === prevEnd)[0], after = rs.filter((r) => early(r.pd.from, c.T) === nextStart)[0];
    gap(prevEnd + 1, nextStart - 1, before, after);
  }
  if (!rs.some((r) => r.current)) {
    const end = Math.max(...rs.map((r) => late(r.pd.to, c.T)));
    const last = rs.find((r) => late(r.pd.to, c.T) === end);
    if (c.T - end >= 6) gap(end + 1, c.T, last, null);
  }
  return out;
};

/* A place inside the company's own name ("Gulf Retail Group") does not say where the job was.
   An employer field that is itself a place is EXP-03's finding, never "no place". */
RUN["EXP-10"] = (c) => c.roles.filter((r) => r.c.trim() && !employerIsPlace(r.c) && !employerParts(r.c).some((tok) => LINKEDIN_AREA.test(tok))
  && !placeHits(maskSpans(r.c, matcher([employerCore(r.c)]).all(r.c))).length && !placeHits(r.pd.note).length)
  .map((r) => inst("low", ev(`experience.${r.i}.c`, r.c), { role: r.i, field: "c" }));

RUN["EXP-11"] = (c) => c.roles.length < 5 ? [] : c.order.filter((r) => r.rank >= 4 && r.readable && !r.pd.to.open && r.pd.to.y <= c.today.y - 15)
  .map((r) => inst("low", ev(`experience.${r.i}.d`, r.d, null, `${roleLabel(r)} ended ${c.today.y - r.pd.to.y} years ago.`), { role: r.i, field: "role", ackBasis: r.d }));

RUN["BUL-01"] = (c) => {
  const out = [];
  for (const r of c.order) {
    const n = r.bullets.length, k = r.rank;
    if (k <= 2 && n === 0) { out.push(inst("med", ev(`experience.${r.i}.t`, r.t, null, `${roleLabel(r)}: no bullets.`), { role: r.i, field: "bullets" })); continue; }
    const [lo, hi] = k === 0 ? [4, 6] : k <= 2 ? [2, 4] : [0, 3];
    if (n < lo || n > hi) out.push(inst("low", ev(`experience.${r.i}.t`, r.t, null, `${roleLabel(r)}: ${n} ${n === 1 ? "bullet" : "bullets"} (target ${k >= 3 ? "3 or fewer" : lo + "–" + hi}).`), { role: r.i, field: "bullets", later: n > hi }));
  }
  return out;
};

RUN["BUL-02"] = (c) => c.roles.flatMap((r) => r.bullets.filter((b) => b.x.trim().length > 180)
  .map((b) => inst(b.x.trim().length > 260 ? "med" : "low", ev(b.path, b.x, null, `${b.x.trim().length} characters (target 180 or fewer).`), { role: r.i, bullet: b.j, field: "b" })));

const IRREG = new Set(["built", "led", "ran", "won", "grew", "drove", "set", "made", "took", "brought", "sold", "bought", "held", "kept", "oversaw",
  "wrote", "taught", "began", "undertook", "spent", "cut", "rebuilt", "met", "gave", "became", "chose", "sent", "rose", "sought", "struck", "stood", "overtook"]);
const firstWord = (x) => {
  const t = str(x).replace(/^[\s•▪►✓➢*·-]+/u, "");
  const w = (/^\p{L}[\p{L}'’-]*/u.exec(t) || [""])[0];
  return { w: low(w).replace(/^co-/, ""), start: t.length ? str(x).length - t.length : 0, len: w.length };
};
const isPast = (w) => /ed$/.test(w) || IRREG.has(w);
const isPres3 = (w) => /^[a-z]+[^s]s$/.test(w) && !isPast(w);
RUN["BUL-03"] = (c) => {
  const out = [];
  for (const r of c.roles) {
    const en = r.bullets.filter((b) => langOf(b.x) === "en");
    const past = en.filter((b) => isPast(firstWord(b.x).w)).length;
    for (const b of en) {
      const f = firstWord(b.x), w = f.w, hit = { start: f.start, end: f.start + f.len };
      let why = null;
      if (["i", "my", "we", "our", "me"].includes(w)) why = "Opens with a pronoun.";
      else if (/ing$/.test(w)) why = "Opens with an -ing form.";
      else if (["the", "a", "an"].includes(w) || /(tion|sion|ment|ance|ence|ship|ity|ness)$/.test(w)) why = "Opens with a noun, not a verb.";
      else if (!r.current && isPres3(w)) why = "Present tense in a past role.";
      else if (r.current && past && isPres3(w)) why = "Mixes past and present tense in the current role.";
      if (why) out.push(inst("low", ev(b.path, b.x, hit, why), { role: r.i, bullet: b.j, field: "b" }));
    }
  }
  return out;
};

const JD_OPENERS = ["responsible for", "duties included", "tasked with", "worked on", "involved in", "zuständig für", "verantwortlich für"];
RUN["BUL-04"] = (c) => c.roles.flatMap((r) => r.bullets.filter((b) => JD_OPENERS.some((p) => norm(b.x).startsWith(norm(p))))
  .map((b) => inst("low", ev(b.path, b.x, matcher(JD_OPENERS).first(b.x)), { role: r.i, bullet: b.j, field: "b" })));

const QUAL_M = matcher(QUALIFIERS);
RUN["BUL-05"] = (c, Q) => {
  const out = [];
  /* "Key account(s)" is a sales term, not praise. */
  const term = (b, h) => low(h.word) === "key" && /^[\s-]+accounts?(?![\p{L}])/iu.test(b.x.slice(h.end));
  for (const r of c.roles) for (const b of r.bullets.filter((x) => !x.ach && !hasFigure(x.x))) for (const h of QUAL_M.all(b.x).filter((h) => !term(b, h))) {
    out.push(inst("low", ev(b.path, b.x, h), { role: r.i, bullet: b.j, field: "b" }));
    Q.add("Q-QUAL", "BUL-05", { key: `Q-QUAL|${r.fp}|${hashStr(norm(b.x))}|${low(h.word)}`, role: r.i, bullet: b.j, figure: true, quote: b.x, path: b.path,
      question: `You wrote “${b.x}”. What made it ${h.word}? A value, a count or a size, with its unit and year, exactly as you can state it.`, why: "A qualifier with no figure reads as opinion." });
  }
  return out;
};

const words4 = (x) => new Set(letterWords(x).map(low).filter((w) => w.length >= 4));
RUN["BUL-06"] = (c) => {
  const out = [], bs = c.srcBullets;
  for (let a = 0; a < bs.length; a++) for (let b = a + 1; b < bs.length; b++) {
    const A = bs[a], B = bs[b];
    if (!norm(A.x)) continue;
    if (norm(A.x) === norm(B.x)) { out.push(inst("med", [ev(A.path, A.x), ev(B.path, B.x, null, "The same line twice.")], { role: B.role, bullet: B.j, field: "b" })); continue; }
    const sa = words4(A.x), sb = words4(B.x);
    const inter = [...sa].filter((w) => sb.has(w)).length, uni = new Set([...sa, ...sb]).size;
    if (Math.min(sa.size, sb.size) >= 5 && uni && inter / uni >= 0.8) out.push(inst("low", [ev(A.path, A.x), ev(B.path, B.x, null, "Nearly the same line twice.")], { role: B.role, bullet: B.j, field: "b" }));
  }
  return out;
};

const FRAG_START = matcher(["and", "or", "of", "to", "with", "for", "in", "und", "oder", "mit", "für", "von", "et", "y"]);
function looksLikeHeader(x) {
  const t = str(x).trim();
  const ranges = findDateRanges(t);
  if (ranges.length && letterWords(maskSpans(t, ranges)).length < 3) return "date";
  const f = firstWord(t);
  if (t.length <= 60 && TITLE_WORDS.test(t) && !/\.$/.test(t) && !isPast(f.w) && (!/ing$/.test(f.w) || /^managing\s/i.test(t))) return "title";
  return null;
}
/* A fragment needs a line before it to have broken off from, so a role's only
   bullet never counts; nor does a complete sentence (capital to full stop). The
   fragment is the first evidence, so "Fix in Builder" goes to it. */
RUN["BUL-07"] = (c) => {
  const out = [];
  for (const r of c.roles) r.bullets.forEach((b, k) => {
    const t = b.x.trim();
    if (!t || r.bullets.length < 2 || (/^\p{Lu}/u.test(t) && /[.!?]$/.test(t))) return;
    let why = null;
    if (/^\p{Ll}/u.test(t)) why = "Starts in lower case.";
    else if (FRAG_START.first(t) && FRAG_START.first(t).start === 0) why = "Starts with a joining word.";
    else if (/(,|&|-)$/.test(t) || /(?:^|\s)(and|und|the)$/i.test(t)) why = "Ends mid-sentence.";
    else if (t.length < 25 && !looksLikeHeader(t)) why = "Very short for a bullet.";
    if (!why) return;
    const e = [ev(b.path, b.x, null, why)];
    if (k > 0) e.push(ev(r.bullets[k - 1].path, r.bullets[k - 1].x, null, "The line before it."));
    out.push(inst("med", e, { role: r.i, bullet: b.j, field: "b" }));
  });
  return out;
};

RUN["BUL-08"] = (c) => c.roles.flatMap((r) => r.bullets.map((b) => [b, looksLikeHeader(b.x)]).filter(([, k]) => k)
  .map(([b, k]) => inst("high", ev(b.path, b.x, null, k === "date" ? `A date line among the bullets of ${roleLabel(r)}.` : `This looks like a job title among the bullets of ${roleLabel(r)}.`), { role: r.i, bullet: b.j, field: "b" })));

const COMPANY_OPEN = ["the company", "the group", "the firm", "our company", "we are", "das unternehmen", "die firma", "die gruppe", "l'entreprise", "la empresa"];
const ESTABLISHED = /(founded in|established in|gegründet|headquartered in|a leading provider|one of the largest|one of the leading)((?:\s+\S+){0,5})/iu;
RUN["BUL-09"] = (c) => {
  const out = [];
  for (const r of c.roles) {
    const core = employerCore(r.c);
    for (const b of r.bullets.filter((x) => !x.ach)) {
      const n = norm(b.x);
      let why = null;
      if (COMPANY_OPEN.some((p) => n.startsWith(norm(p)))) why = "Opens by describing the company.";
      else if (core && new RegExp("^" + escRe(core) + "\\s+(is|was|are|has|provides|offers|operates|ist|bietet|war)(?![\\p{L}])", "iu").test(b.x.trim())) why = "Opens by describing the company.";
      else { const m = ESTABLISHED.exec(b.x); if (m && (/\d{4}/.test(m[2]) || /provider|company|companies|firms?/i.test(m[2]) || /provider/i.test(m[1]))) why = "Describes the company's history or standing."; }
      if (!why && sentences(b.x).length >= 3) why = "A paragraph, not a bullet.";
      if (why) out.push(inst("med", ev(b.path, b.x, null, why), { role: r.i, bullet: b.j, field: "b" }));
    }
  }
  return out;
};

RUN["ACH-01"] = (c) => {
  const out = [], ans = c.o.achAnswers || {};
  for (const r of c.roles) for (const b of r.bullets.filter((x) => x.ach)) {
    const v = str(ans[b.achKey]).trim();
    const at = v ? b.x.indexOf(v) : -1;
    const marks = at >= 0 ? [[0, at], [at + v.length, b.x.length]].filter(([s, e]) => e > s) : [[0, b.x.length]];
    const e = ev(b.path, b.x, null, at >= 0 ? `Only “${v}” is your answer; the rest is template wording.` : "Written by the portal around your answer.");
    e.marks = marks;
    out.push(inst("high", e, { role: r.i, bullet: b.j, field: "b" }));
  }
  return out;
};

RUN["MET-01"] = (c) => {
  const bs = c.srcBullets;
  if (bs.length < 3) return [];
  const n = bs.filter((b) => hasFigure(b.x)).length, pct = Math.round((100 * n) / bs.length);
  return pct < 40 ? [inst("med", ev("experience", "", null, `${n} of ${bs.length} bullets carry a figure (${pct}%).`), { field: "figures" })] : [];
};

/* MET-02 picks up to two questions per recent role from the role's own tags
   (bullet tags when the role has none). Tags only choose the question; they
   never count as evidence, because a question makes no claim. */
const MET_Q = [
  ["Q-MANDATES", ["consulting", "advisory", "strategy"]],
  ["Q-SITES", ["mobility", "retail", "automotive", "fleet"]],
  ["Q-DEALS", ["b2b", "contracts", "negotiation", "business development"]],
  ["Q-TEAM", ["leadership", "operations"]],
  ["Q-MONEY", ["p&l", "restructuring", "cost"]],
];
RUN["MET-02"] = (c, Q) => {
  for (const r of c.order.filter((x) => x.rank <= 2)) {
    const own = r.bullets.filter((b) => !b.ach);
    if (own.some((b) => hasFigure(b.x))) continue;
    const tags = new Set(r.tags.length ? r.tags : own.flatMap((b) => b.tags));
    const picks = MET_Q.filter(([, ts]) => ts.some((t) => tags.has(t))).map(([id, ts]) => [id, ts]).slice(0, 2);
    if (!picks.length) picks.push(["Q-RESULT", []]);
    const at = atRole(r);
    for (const [id, ts] of picks) {
      /* Quote the bullet that carries the most specific tag of the group. */
      const b = ts.map((t) => own.find((x) => x.tags.includes(t))).find(Boolean) || own[0];
      const quote = b ? b.x.trim() : "";
      const wrote = (q) => (quote ? `You wrote “${quote}”. ${q[0].toUpperCase()}${q.slice(1)}` : at + q);
      const text = {
        "Q-TEAM": `${at}how many people did you lead, or how many sites or units? Give the exact figure, or a floor you can defend (“at least …”), with the unit in your words.`,
        "Q-MONEY": `${at}what budget, cost or revenue figure can you state? Give the exact figure or a floor you can defend, with the currency and the year.`,
        "Q-DEALS": wrote("how many agreements, or what value? Give the exact figure or a floor you can defend, with the unit in your words."),
        "Q-MANDATES": `${r.readable ? "Since " + r.pd.from.y : "In this role"}, how many client mandates have you handled, and in which sectors? Give the exact figure or a floor you can defend. May any client be named?`,
        "Q-SITES": `${at}how many stations, branches or vehicles did this cover? Give the exact figure or a floor you can defend, with the unit in your words.`,
        "Q-RESULT": wrote("what changed, and by how much? Give the figure with its unit and year."),
      }[id];
      Q.add(id, "MET-02", { key: `${id}|${r.fp}`, role: r.i, figure: true, quote, path: b ? b.path : `experience.${r.i}.t`, question: text, why: "A recent role with no figure reads as activity." });
    }
  }
  return { status: "ask" };
};

const CLAIM = matcher(["p&l", "profit and loss", "profit & loss", "guv", "ergebnisverantwortung", "budget responsibility", "budgetverantwortung",
  "investor relations", "m&a", "mergers", "acquisitions", "ipo", "fundraising", "board member", "board seat", "aufsichtsrat"]);
RUN["MET-03"] = (c, Q) => {
  const out = [];
  const inBullets = (term) => c.srcBullets.some((b) => matcher([term]).test(b.x));
  const fields = [...c.comps.map((cp, k) => ({ path: `competencies.${k}.0`, text: str((cp || [])[0]), field: "comp", comp: k })),
    ...summaries(c).map((s) => ({ ...s, field: "summary" })), { path: "title." + c.L, text: str((c.P.title || {})[c.L]), field: "headline" }];
  for (const f of fields) for (const h of CLAIM.all(f.text)) {
    if (inBullets(h.word)) continue;
    out.push(inst("med", ev(f.path, f.text, h, f.label), { field: f.field, comp: f.comp }));
    Q.add("Q-CLAIM", "MET-03", { key: "Q-CLAIM|" + low(h.word), quote: h.word, path: f.path,
      question: `Your CV says “${h.word}”. Did you formally hold it? If yes, in which role and for what size? If not, the skill should say what your bullets show.`, why: "A claim an interviewer tests needs a line behind it." });
  }
  return out;
};

/* SKL-01 evidence is the candidate's text only: the skill's name (or a part of
   it) or one of its synonyms in a bullet they wrote. Synonyms (the page's SYN)
   match at a word start, as the portal does; a synonym ending in a space, or
   shorter than 4 characters, must be a whole word. */
function synTest(text, syn) {
  const s = low(syn), t = " " + norm(text).replace(/-/g, " ") + " ", w = norm(s);
  if (!w) return false;
  const whole = s.endsWith(" ") || w.length < 4;
  return t.includes(" " + w + (whole ? " " : "")) || (whole && t.includes(" " + w + "s "));
}
RUN["SKL-01"] = (c) => {
  const syn = c.o.syn || {};
  const texts = c.srcBullets.map((b) => b.x);
  const out = [];
  c.comps.forEach((cp, k) => {
    const name = str((cp || [])[0]), tag = low((cp || [])[1]);
    const parts = name.split(/\s*(?:&|\/|,|\band\b|\bund\b)\s*/).map((x) => x.trim()).filter((x) => x.length >= 2);
    const M = matcher([name, ...parts], { infl: true });
    const syns = [tag, ...((syn[tag] || []))].filter(Boolean);
    const ok = texts.some((x) => M.test(x) || syns.some((s) => synTest(x, s)));
    if (!ok) out.push(inst("med", ev(`competencies.${k}.0`, name), { field: "comp", comp: k }));
  });
  return out;
};

const LANG_SKILL = matcher(["english", "german", "deutsch", "arabic", "arabisch", "french", "français", "französisch", "spanish", "español", "spanisch",
  "italian", "russian", "urdu", "hindi", "turkish", "farsi", "persian", "native", "fluent", "bilingual", "mother tongue", "muttersprache", "العربية", "الإنجليزية"]);
RUN["SKL-02"] = (c) => c.comps.map((cp, k) => [cp || [], k]).filter(([cp]) => LANG_SKILL.test(cp[0]) || LANG_SKILL.test(cp[1]))
  .map(([cp, k]) => inst("med", ev(`competencies.${k}.0`, cp[0], LANG_SKILL.first(cp[0])), { field: "comp", comp: k }));

RUN["SKL-03"] = (c) => {
  const n = c.comps.length;
  const note = `${n} skills (target 8–10).`;
  if (n === 0) return [inst("med", ev("competencies", "", null, note), { field: "comp" })];
  return n < 5 || n > 12 ? [inst("low", ev("competencies", "", null, note), { field: "comp" })] : [];
};

const SOFT = matcher(["leadership", "communication", "mentoring", "teamwork", "team player", "presentation", "motivation", "interpersonal", "problem solving",
  "problem-solving", "time management", "soft skills", "kommunikation", "teamfähigkeit", "führungsstärke"]);
RUN["SKL-04"] = (c) => {
  const out = [];
  c.comps.forEach((cp, k) => {
    const name = str((cp || [])[0]);
    const h = SOFT.first(name) || placeHits(name).find((p) => /^\s+(market|markets|markt|märkte)(?![\p{L}])/iu.test(name.slice(p.end)));
    if (h) out.push(inst("low", ev(`competencies.${k}.0`, name, h), { field: "comp", comp: k }));
  });
  return out;
};

const BRANDS = new Set(["ebay", "iphone", "ipad", "ios", "npm", "macos", "jquery", "iot", "etoro"]);
RUN["SKL-05"] = (c) => {
  const out = [];
  const S = c.comps.map((cp) => new Set(letterWords(str((cp || [])[0])).map(low).filter((w) => w.length >= 3 && !["and", "und"].includes(w))));
  for (let a = 0; a < S.length; a++) for (let b = 0; b < S.length; b++) {
    if (a === b || !S[a].size || !S[b].size) continue;
    const sub = [...S[a]].every((w) => S[b].has(w));
    if (sub && (S[a].size < S[b].size || a < b)) out.push(inst("low", [ev(`competencies.${a}.0`, c.comps[a][0]), ev(`competencies.${b}.0`, c.comps[b][0], null, "One skill repeats the other.")], { field: "comp", comp: a }));
  }
  c.comps.forEach((cp, k) => {
    const name = str((cp || [])[0]).trim();
    if (/^\p{Ll}/u.test(name) && !BRANDS.has(low(letterWords(name)[0] || ""))) out.push(inst("low", ev(`competencies.${k}.0`, name, null, "Starts in lower case."), { field: "comp", comp: k }));
  });
  return out;
};

RUN["LNG-01"] = (c) => (str(c.P.langs).trim() ? [] : [inst("med", ev("langs", "", null, "No languages line."), { field: "langs" })]);

/* German called fluent is a must-fix (the owner's fact base). Another native
   language called fluent may be the candidate's own choice of words (the fact
   base itself prescribes "Arabisch und Englisch verhandlungssicher"), so it is
   a question to the candidate, not a gate. */
RUN["LNG-02"] = (c, Q) => {
  const found = langsLineLevels(c.P.langs).filter((x) => x.kind).map((x) => ({ ...x, path: "langs", text: str(c.P.langs) }));
  for (const [k, v] of Object.entries(c.P.summary || {})) for (const x of summaryLevels(v)) found.push({ ...x, path: "summary." + k, text: str(v) });
  const out = [];
  const groups = [...new Set(found.map((x) => x.group))];
  for (const g of groups) {
    const nat = found.filter((x) => x.group === g && x.kind === "native"), non = found.filter((x) => x.group === g && x.kind === "nonnative");
    if (!nat.length || !non.length) continue;
    const e = [ev(nat[0].path, nat[0].text, nat[0].level, `${nat[0].lang.word}: ${nat[0].level.word}`), ...non.map((x) => ev(x.path, x.text, x.level, `${x.lang.word}: ${x.level.word}`))];
    if (g === "german") { out.push(inst("high", e, { field: "langs" })); continue; }
    out.push(inst("med", e, { field: "langs" }));
    Q.add("Q-NATIVE", "LNG-02", { key: "Q-NATIVE|" + g, quote: non[0].lang.word + " " + non[0].level.word, path: non[0].path,
      question: `Your CV calls ${nat[0].lang.word} “${nat[0].level.word}” and also “${non[0].level.word}”. Which level is true for you?`, why: "A native language stays native in every version." });
  }
  return out;
};

RUN["LNG-03"] = (c) => {
  const t = str(c.P.langs), out = [];
  let off = 0;
  for (const part of t.split(/([·,;|])/)) {
    if (!/^[·,;|]$/.test(part) && LANG_M.test(part) && !LEVEL_M.test(part) && !/\b[abc][12]\b/i.test(part)) {
      const s = off + part.indexOf(part.trim());
      out.push(inst("low", ev("langs", t, { start: s, end: s + part.trim().length }), { field: "langs" }));
    }
    off += part.length;
  }
  return out;
};

RUN["LNG-04"] = (c) => {
  const listed = new Set(LANG_M.all(c.P.langs).map((h) => LANG_GROUP[low(h.word)]));
  const t = c.summaryL.text;
  const seen = new Set();
  return summaryLevels(t).filter((x) => !listed.has(x.group) && !seen.has(x.group) && seen.add(x.group))
    .map((x) => inst("low", ev(c.summaryL.path, t, x.lang), { field: "langs" }));
};

RUN["EDU-01"] = (c) => {
  const ok = c.edu.some((e) => str((e || {}).b).trim());
  return ok ? [] : [inst(c.market === "dach" ? "high" : "med", ev("education", "", null, "No qualification."), { field: "edu" })];
};

const VOWEL = /[aeiouyäöüéèàáíóúâêôœ]/i;
RUN["EDU-02"] = (c) => {
  const e = c.edu[0];
  if (!e) return [];
  const out = [];
  for (const k of ["b", "s"]) {
    const t = str(e[k]);
    let why = null;
    if (t.includes("\t")) why = "A tab joins two parts.";
    else if (t.length >= 158 && /\p{L}$/u.test(t)) why = "The line looks cut off.";
    else {
      const last = (t.trim().match(/[A-Za-zÀ-ÿ]+$/) || [""])[0];
      /* No vowel at all, or an ending no English or German word has ("availabl", "possibl"). */
      if (last.length >= 3 && last === last.toLowerCase() && (!VOWEL.test(last) || /[bcdfgkpt]l$/.test(last))) why = "The line ends mid-word.";
    }
    if (why) out.push(inst("low", ev(`education.0.${k}`, t, null, why), { field: "edu." + k }));
  }
  return out;
};

const GERMAN_EDU = matcher(["abschlussprüfung", "gesamtnote", "gesamtergebnis", "zeugnis", "bestanden", "berufsschule", "berufsbildende", "fachrichtung", "ausbildung"]);
RUN["EDU-03"] = (c) => {
  if (c.L !== "en") return { status: "na" };
  const e = c.edu[0];
  if (!e) return [];
  const out = [];
  const segs = (t) => str(t).split(/\s+[—–]\s+|\s+·\s+|\s*\|\s*|[()]/).map((x) => x.trim()).filter(Boolean);
  const gloss = [...segs(e.b), ...segs(e.s)].some((g) => !GERMAN_EDU.test(g) && letterWords(g).length >= 2 && langOf(g) !== "de");
  const hb = GERMAN_EDU.first(e.b);
  if (hb && !gloss) out.push(inst("low", ev("education.0.b", str(e.b), hb, "No English wording beside it."), { field: "edu.b" }));
  const hs = GERMAN_EDU.first(e.s);
  if (hs) out.push(inst("low", ev("education.0.s", str(e.s), hs, "German details in an English CV."), { field: "edu.s" }));
  return out;
};

RUN["EDU-04"] = (c) => {
  if (c.market !== "dach") return { status: "na" };
  const e = c.edu[0];
  if (!e || !str(e.b).trim()) return [];
  const years = (str(e.b) + " " + str(e.s)).match(/\d{4}/g) || [];
  return years.some((y) => +y >= 1950 && +y <= 2039) ? [] : [inst("low", ev("education.0.b", str(e.b), null, "No year."), { field: "edu.b" })];
};

const REF_CONTACT = matcher(["tel", "phone", "mobile", "telefon", "handy", "whatsapp"]);
RUN["REF-01"] = (c, Q) => {
  const t = str((c.P.refs || {})[c.L]);
  const mail = /[^\s@]+@[^\s@]+\.[A-Za-z]{2,}/.exec(t);
  const digits = /\d{7,}/.test(asciiDigits(t).replace(/[\s-]/g, ""));
  const h = mail ? { start: mail.index, end: mail.index + mail[0].length } : REF_CONTACT.first(t);
  if (!mail && !digits && !h) return [];
  Q.add("Q-REF", "REF-01", { key: "Q-REF", question: `Is there a referee you have confirmed can be reached in ${c.today.y}? Until then the CV says only that a written reference exists.`, why: "A referee's details print only after they have confirmed." });
  return [inst("high", ev("refs." + c.L, t, h), { field: "refs" })];
};

RUN["REF-02"] = (c) => {
  if (c.market === "uk") return { status: "na" };
  return str((c.P.refs || {})[c.L]).trim() ? [] : [inst("low", ev("refs." + c.L, "", null, "No references line."), { field: "refs" })];
};

const HONORIFIC = /(?:^|[^\p{L}])(Mr|Mrs|Ms|Dr|Herr|Frau|Prof)\.?\s+\p{Lu}/gu;
RUN["REF-03"] = (c, Q) => {
  const t = str((c.P.refs || {})[c.L]);
  if (!t.trim()) return [];
  let hit = null;
  const m = HONORIFIC.exec(t);
  HONORIFIC.lastIndex = 0;
  if (m) hit = { start: m.index + m[0].length - m[0].trimStart().length, end: m.index + m[0].length };
  if (!hit) {
    const skip = new Set([...c.employers.flatMap((e) => letterWords(e).map(low)), ...Object.keys(ALIAS)]);
    const re = /(\p{Lu}\p{Ll}+)\s+(\p{Lu}\p{Ll}+)/gu;
    let x;
    while ((x = re.exec(t))) {
      const atStart = !t.slice(0, x.index).trim() || /[.!?]\s*$/.test(t.slice(0, x.index));
      const ws = [x[1], x[2]];
      if (atStart || ws.some((w) => TITLE_WORDS.test(w) || skip.has(low(w)) || /^(references?|referenzen|written|available|request|copy)$/i.test(w))) { re.lastIndex = x.index + x[1].length; continue; }
      hit = { start: x.index, end: x.index + x[0].length };
      break;
    }
  }
  if (!hit) return [];
  Q.add("Q-REF", "REF-03", { key: "Q-REF", question: `Is there a referee you have confirmed can be reached in ${c.today.y}? Until then the CV says only that a written reference exists.`, why: "A referee is named only once they have confirmed." });
  return [inst("med", ev("refs." + c.L, t, hit), { field: "refs" })];
};

RUN["DOC-01"] = (c) => {
  const bs = c.roles.flatMap((r) => r.bullets.map((b) => b.x)), counts = {};
  for (const x of bs) { const l = langOf(x); counts[l] = (counts[l] || 0) + 1; }
  const known = bs.length - (counts.unknown || 0);
  if (known < 3) return [];
  const share = (counts[c.L] || 0) / known;
  if (share >= 0.5) return [];
  const split = Object.entries(counts).filter(([k]) => k !== "unknown").map(([k, n]) => `${k} ${n}`).join(" · ");
  return [inst("high", ev("experience", "", null, `Detected in your bullets: ${split}; ${c.L} ${counts[c.L] || 0}.`), { field: "language" })];
};

RUN["DOC-02"] = (c) => {
  const out = [], t = c.summaryL.text;
  if (!t.trim()) return [];
  const whole = langOf(t);
  if (whole !== c.L && whole !== "unknown") return [inst("high", ev(c.summaryL.path, t, null, `This summary reads as ${LANG_EN[whole] || whole}.`), { field: "summary" })];
  let from = 0;
  for (const s of sentences(t)) {
    const at = t.indexOf(s, from);
    from = at + s.length;
    const l = langOf(s);
    if (wordCount(s) >= 8 && l !== c.L && l !== "unknown") out.push(inst("high", ev(c.summaryL.path, t, { start: at, end: at + s.length }, `This sentence reads as ${LANG_EN[l] || l}.`), { field: "summary" }));
  }
  return out;
};

const NOT_DE_DATES = matcher(["present", "current", "today", "since", "mar", "may", "oct", "dec", "march", "october", "december"]);
/* German, French and Spanish date words that are not also English words ("mars",
   "mayo" and "ago" are only read inside the dates field). */
const NOT_EN_DATES = matcher(["heute", "aktuell", "seit", "mrz", "mär", "märz", "mai", "okt", "dez",
  "janv", "janvier", "févr", "fév", "février", "mars", "avr", "avril", "juin", "juil", "juillet", "août", "septembre", "octobre", "novembre", "déc", "décembre",
  "aujourd'hui", "depuis", "ene", "enero", "febrero", "marzo", "abr", "abril", "mayo", "junio", "julio", "ago", "agosto", "septiembre", "octubre",
  "noviembre", "dic", "diciembre", "actualidad", "desde", "hasta"]);
RUN["DOC-03"] = (c) => {
  const out = [];
  const M = c.L === "de" ? NOT_DE_DATES : c.L === "en" ? NOT_EN_DATES : null;
  if (!M) return { status: "na" };
  for (const r of c.roles) { const h = M.first(r.d); if (h) out.push(inst("med", ev(`experience.${r.i}.d`, r.d, h), { role: r.i, field: "d", later: true })); }
  const L = c.L === "de" ? matcher(["native", "fluent", "mother tongue"]) : matcher(["muttersprache", "verhandlungssicher", "fließend"]);
  const h = L.first(c.P.langs);
  if (h) out.push(inst("med", ev("langs", str(c.P.langs), h), { field: "langs" }));
  return out;
};

RUN["DOC-04"] = (c, Q) => {
  if (c.L !== "ar") return { status: "na" };
  Q.add("Q-AR", "DOC-04", { key: "Q-AR", market: true, question: "Has a native Arabic speaker read this version?", why: "An Arabic CV goes out under your name." });
  return { status: "ask" };
};

const DE_TEAM_STEER = /(?:^|[^\p{L}])(teams?)(?:\s+\S+){0,3}?\s+(steuern|steuerte|steuerten|gesteuert)(?![\p{L}])/giu;
const DE_KOMM = /die\s+kommunikation\s+(geführt|führen|führte)/giu;
RUN["DOC-05"] = (c) => {
  if (c.L !== "de") return { status: "na" };
  const out = [];
  const fields = [{ path: "summary.de", text: str((c.P.summary || {}).de) }, { path: "title.de", text: str((c.P.title || {}).de) },
    ...c.roles.flatMap((r) => r.bullets.filter((b) => langOf(b.x) === "de").map((b) => ({ path: b.path, text: b.x })))];
  for (const f of fields) {
    for (const h of matcher(["inklusive"]).all(f.text)) out.push(inst("low", ev(f.path, f.text, h), { field: "de" }));
    for (const re of [DE_TEAM_STEER, DE_KOMM]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(f.text))) out.push(inst("low", ev(f.path, f.text, { start: m.index, end: m.index + m[0].length }), { field: "de" }));
    }
  }
  return out;
};

const US_SPELL = matcher(["organization", "organizations", "organized", "organizing", "optimization", "optimize", "optimized", "analyze", "analyzed",
  "prioritize", "prioritized", "recognized", "specialized", "center", "centers", "color", "favor", "favorable", "labor", "behavior", "modeling", "traveled", "program"]);
RUN["MKT-01"] = (c) => {
  if (c.market !== "uk" || c.L !== "en") return { status: "na" };
  const out = [];
  for (const f of c.PRINTED) for (const h of US_SPELL.all(f.text)) {
    if (low(h.word) === "program" && /^\s+(software|programming|language)/i.test(f.text.slice(h.end))) continue;
    out.push(inst("low", ev(f.path, f.text, h), { field: f.field }));
  }
  return out;
};

RUN["MKT-02"] = (c) => {
  const want = c.market === "dach" ? "MM/YYYY" : "Mon YYYY";
  const sides = c.roles.filter((r) => r.readable).flatMap((r) => [[r, r.pd.from], ...(r.pd.single || r.pd.to.open ? [] : [[r, r.pd.to]])]).filter(([, s]) => s.m);
  const other = sides.filter(([, s]) => s.fmt !== want);
  if (!sides.length || other.length * 2 <= sides.length) return [];
  const [r, s] = other[0];
  return [inst("low", ev(`experience.${r.i}.d`, r.d, locate(r.d, s.text), `${other.length} of ${sides.length} dates use another style than this market expects (${want === "MM/YYYY" ? "03/2005" : "Mar 2005"}).`), { role: r.i, field: "d" })];
};

RUN["MKT-03"] = (c, Q) => {
  if (c.market === "gcc") {
    Q.add("Q-DL", "MKT-03", { key: "Q-DL", market: true, question: "Do you hold a UAE driving licence? If yes, may it be printed, and in what words?", why: "Many Gulf roles ask for it." });
    Q.add("Q-NOTICE", "MKT-03", { key: "Q-NOTICE", market: true, question: "What is your notice period, or the date you can start?", why: "Gulf recruiters ask for it at the first call." });
    if (LANG_M.all(c.P.langs).some((h) => LANG_GROUP[low(h.word)] === "arabic"))
      Q.add("Q-ARCV", "MKT-03", { key: "Q-ARCV", market: true, question: "Do you want an Arabic CV? You would write or approve every line, and a native speaker would read it.", why: "Arabic is in your languages." });
  } else if (c.market === "uk") Q.add("Q-RTW", "MKT-03", { key: "Q-RTW", market: true, question: "Do you have the right to work in the UK? If yes, may it be printed, and in what words?", why: "UK recruiters screen on right to work first." });
  return { status: "ask" };
};

RUN["MKT-04"] = (c) => {
  const W = wordCount(c.summaryL.text) + c.roles.reduce((n, r) => n + wordCount(r.t) + wordCount(r.c) + r.bullets.reduce((m, b) => m + wordCount(b.x), 0), 0)
    + c.comps.reduce((n, cp) => n + wordCount((cp || [])[0]), 0) + (c.edu[0] ? wordCount(c.edu[0].b) + wordCount(c.edu[0].s) : 0);
  const over = c.careerYears >= 8 ? W > 950 : W > 550;
  return over ? [inst("low", ev("experience", "", null, `About ${W} words — likely over ${c.careerYears >= 8 ? "two pages" : "one page"} (an estimate).`), { field: "length" })] : [];
};

const PUA = new RegExp("[" + String.fromCharCode(0xe000) + "-" + String.fromCharCode(0xf8ff) + "]", "u");
const PICTO = (() => { try { return new RegExp("\\p{Extended_Pictographic}", "u"); } catch { return /$^/; } })();
RUN["ATS-01"] = (c) => {
  const out = [];
  for (const f of c.PRINTED) {
    const t = f.text;
    if (!t) continue;
    let why = null, at = -1;
    if ((at = t.indexOf("\t")) >= 0) why = "Contains a ⟨TAB⟩.";
    else if (PUA.test(t)) { at = t.search(PUA); why = `Contains ⟨U+${t.charCodeAt(at).toString(16).toUpperCase()}⟩, a private-use symbol.`; }
    else if (PICTO.test(t)) { at = t.search(PICTO); why = "Contains an emoji."; }
    else if (f.kind === "bullet" && /^\s*[•▪►✓➢–]\s/u.test(t)) { at = t.search(/\S/); why = "Starts with its own bullet mark."; }
    else if ((at = t.trim().search(/ {2,}/)) >= 0) { at += t.indexOf(t.trim()); why = "Contains doubled spaces."; }
    if (why) out.push(inst("low", ev(f.path, t, at >= 0 ? { start: at, end: at + 1 } : null, why), { field: f.field, role: f.role, bullet: f.bullet }));
  }
  return out;
};

const SEP = "—–\\-|·,/";
const DANGLE = new RegExp(`^[${SEP}]|[${SEP}]$|[${SEP}]\\s*[${SEP}]`);
RUN["ATS-02"] = (c) => {
  const out = [];
  const fields = [...c.roles.flatMap((r) => ["t", "c", "d"].map((k) => ({ path: `experience.${r.i}.${k}`, text: r[k], role: r.i, field: k }))),
    ...(c.edu[0] ? ["b", "s"].map((k) => ({ path: `education.0.${k}`, text: str(c.edu[0][k]), field: "edu." + k })) : []),
    { path: c.header.city.path, text: c.header.city.text, field: "city" }];
  for (const f of fields) {
    const t = f.text.trim();
    if (!t) continue;
    /* "Co-owner" and "FZ-LLC" are words, not separators: only a hyphen with a space beside it counts. */
    const probe = t.replace(/(\p{L})-(\p{L})/gu, "$1_$2").replace(/(\d)[-/](\d)/g, "$1_$2");
    if (DANGLE.test(probe)) out.push(inst("low", ev(f.path, f.text), { role: f.role, field: f.field }));
  }
  return out;
};

/* ---------- questions ---------- */

const FIGURE_Q = new Set(["Q-QUAL", "Q-TEAM", "Q-MONEY", "Q-DEALS", "Q-MANDATES", "Q-SITES", "Q-RESULT"]);
class Questions {
  constructor(c) { this.c = c; this.list = []; this.keys = new Set(); }
  add(id, check, q) {
    if (this.keys.has(q.key)) return;
    this.keys.add(q.key);
    const r = q.role !== undefined ? this.c.roles[q.role] : null;
    this.list.push({ id, check, ...q, figure: FIGURE_Q.has(id), rank: r ? r.rank : undefined, roleFp: r ? r.fp : undefined,
      roleLabel: r ? [r.t, r.d].filter(Boolean).join(" · ") : undefined });
  }
  /* Order: gate-linked first, then roles by recency, then the rest, market
     questions last. At most 2 figure questions per role and 12 open in all;
     the rest wait behind "show more". */
  finish(answers = {}, skipped = {}) {
    const w = (q) => (q.gate ? 0 : q.rank !== undefined ? 1 : q.market ? 3 : 2);
    const inRole = (q) => ["Q-MISS", "Q-MONTH", "Q-PAR"].includes(q.id) ? 0 : FIGURE_Q.has(q.id) && q.id !== "Q-QUAL" ? 1 : 2;
    const all = this.list.map((q, k) => ({ q, k })).sort((a, b) => w(a.q) - w(b.q) || (a.q.rank ?? 99) - (b.q.rank ?? 99) || inRole(a.q) - inRole(b.q) || a.k - b.k).map((x) => x.q);
    const perRole = {};
    let open = 0;
    for (const q of all) {
      const a = str(answers[q.key]).trim();
      q.state = skipped[q.key] ? "skipped" : a ? "answered" : "open";
      if (a) { q.answer = a; q.needsUnit = q.figure && answerNeedsUnit(a); }
      if (q.state !== "open") continue;
      let more = false;
      if (q.figure && q.roleFp) { perRole[q.roleFp] = (perRole[q.roleFp] || 0) + 1; if (perRole[q.roleFp] > 2) more = true; }
      if (!more && open >= 12) more = true;
      if (more) q.more = true; else open++;
    }
    return all;
  }
}

/* An answer with a number but no unit ("12", "40m") cannot become a line: the
   unit would have to come from the portal's question. Money with a currency
   and a percentage carry their unit. */
export function answerNeedsUnit(answer) {
  const a = str(answer);
  if (!/\d/.test(asciiDigits(a)) && !SPELLED_FIG.test(a)) return false;
  if (/[%€$£]/.test(a) || CURRENCY.test(a)) return false;
  const words = letterWords(a).map(low).filter((w) => !/^(at|least|over|more|than|about|approx|approximately|mindestens|über|mehr|als|rund|k|m|mn|bn|million|millions|mio|thousand|tausend|and|und|or|oder)$/.test(w) && spelledNumber(w) === null);
  return !words.some((w) => w.length >= 3);
}

/* Stored answers whose question no longer exists (the line changed, the role
   moved, a new CV was uploaded): never shown beside a bullet automatically. */
export function orphanAnswers(answers, result) {
  const live = new Set((result.questions || []).map((q) => q.key));
  return Object.keys(answers || {}).filter((k) => str(answers[k]).trim() && !live.has(k)).map((k) => ({ key: k, answer: str(answers[k]) }));
}

/* ---------- scoring ---------- */

const PENALTY = { high: [15, 5, 10], med: [5, 2, 4], low: [1, 0, 0] };
const penaltyOf = (sev, n) => (n ? PENALTY[sev][0] + Math.min(PENALTY[sev][2], PENALTY[sev][1] * (n - 1)) : 0);
/* Text colours on the blueprint skin: each reaches at least 5:1 on its page
   (#0c1a26), panel (#112632) and raised (#16303e) backgrounds, so the 10–12px
   chips and verdict pass WCAG AA. Red / amber / grey keep the severity. */
export const BAND = { ready: "#8fd3ae", after: "#d9b36a", work: "#f2836b" };
export const SEV_COLOUR = { high: "#f2836b", med: "#d9b36a", low: "#98a4aa" };
export const SEV_LABEL = { high: "Must fix", med: "Should fix", low: "Consider" };

/* The stable key of one instance: check + role + bullet/field + every quoted
   text (the hit where there is one) + every measured note ("overlap by 21
   months", "12 bullets"), or the instance's ackBasis where a note grows with
   the clock. When any of them changes, the key no longer matches and a
   "checked by you" flag comes back. */
function keyOf(id, c, i) {
  const r = i.role !== undefined ? c.roles[i.role] : null;
  const b = r && i.bullet !== undefined ? r.bullets[i.bullet] : null;
  const parts = i.evidence.map((e) => [e.hit ? str(e.text).slice(e.hit[0], e.hit[1]) : str(e.text), i.ackBasis !== undefined ? "" : str(e.note)].map(norm).join("~"));
  if (i.pairKey) parts.sort();                                // a pair reads the same in either role order
  if (i.ackBasis !== undefined) parts.push(norm(i.ackBasis));
  return [id, i.pairKey || (r ? r.fp : ""), b ? hashStr(norm(b.x)) : i.field || "", hashStr(parts.join("|"))].join("|");
}

/**
 * reviewCV(P, opts) — the whole review.
 *
 * opts: { market: 'gcc'|'gulf'|'dach'|'uk', lang, today:{y,m}, real (uploaded
 *   CV: window.HAS_REAL_PROFILE), edits (the portal's edits object: header
 *   overrides, sum_<jobId> summaries), cvStyle, workRights (the page's
 *   workRights(); computed the same way when absent), syn (the page's SYN
 *   table), achAnswers (edits.ach), ack (edits.cvrAck: {instanceKey:true}),
 *   answers (edits.cvq), skipped (edits.cvqSkip), jobNames ({jobId: title}),
 *   builder (true once the CV Builder can reorder, remove, join and format) }
 *
 * Returns { score, rawScore, verdict, band, gated, market, lang, careerYears,
 *   checks:[{id, section, sev, status, title, rule, source, fix, builderStep,
 *   neverDoes, gate, instances:[…]}], items:[failing checks with evidence],
 *   questions:[…], sections:{name: 0-100}, counts }.
 */
export function reviewCV(P, opts = {}) {
  const c = context(P, opts);
  const Q = new Questions(c);
  const ack = opts.ack || {};
  const checks = [];
  let total = 0, gated = false;
  const secPen = Object.fromEntries(SECTIONS.map((s) => [s, 0]));
  for (const [id, meta] of Object.entries(CHECKS)) {
    const [title, rule, source, fix, builderStep, neverDoes, sev0] = meta;
    const section = SECTION[id.split("-")[0]];
    let res;
    try { res = RUN[id](c, Q); } catch (err) { res = { status: "na", error: String(err && err.message || err) }; }
    const base = { id, section, title, rule, source, fix, builderStep, neverDoes, gate: GATES.has(id), sev: sev0 };
    if (!Array.isArray(res)) { checks.push({ ...base, status: res.status, instances: [], ...(res.error ? { error: res.error } : {}) }); continue; }
    for (const i of res) {
      i.key = keyOf(id, c, i);
      /* med and low may be marked "checked, it's true and stays"; a high item
         only when it is a pattern match that may be a name, place or company. */
      i.ackable = i.sev !== "high" || !!i.override;
      if (i.sev === "high" && !i.ackable) i.noAck = NO_ACK + (GATES.has(id) ? "it breaks the one rule or prints personal data." : "a recruiter would reject the CV for it.");
      if (i.sev === "high" && i.override) i.ackLabel = i.ackLabel || "This is my name, a place or a company, not a personal detail";
      i.acked = i.ackable && !!ack[i.key];
      i.later = !c.builder && (NEEDS_BUILDER.has(id) || !!i.later);
    }
    const live = res.filter((i) => !i.acked && !i.later);
    const status = live.length ? "fail" : res.some((i) => i.later && !i.acked) ? "later" : res.length && res.every((i) => i.acked) ? "checked" : "pass";
    let pen = 0;
    for (const s of ["high", "med", "low"]) pen += penaltyOf(s, live.filter((i) => i.sev === s).length);
    total += pen;
    secPen[section] += pen;
    if (GATES.has(id) && live.some((i) => i.sev === "high")) gated = true;
    const sev = ["high", "med", "low"].find((s) => live.some((i) => i.sev === s)) || ["high", "med", "low"].find((s) => res.some((i) => i.sev === s)) || sev0;
    checks.push({ ...base, sev, status, penalty: pen, instances: res });
  }
  const questions = Q.finish(opts.answers, opts.skipped);
  const rawScore = Math.max(0, Math.round(100 - total));
  const score = gated ? Math.min(rawScore, 59) : rawScore;
  const verdict = gated ? "Not ready — must-fix items" : score >= 85 ? "Ready to send" : score >= 70 ? "Ready after the should-fixes" : "Needs work";
  const band = gated || score < 70 ? BAND.work : score >= 85 ? BAND.ready : BAND.after;
  const items = checks.filter((k) => k.status === "fail").map((k) => ({
    id: k.id, sev: k.sev, section: k.section, title: k.title, why: k.rule, fix: k.fix, builderStep: k.builderStep, gate: k.gate,
    evidence: k.instances.filter((i) => !i.acked && !i.later).flatMap((i) => i.evidence.map((e) => ({ ...e, sev: i.sev, key: i.key, ackable: i.ackable }))),
  }));
  const liveInst = checks.filter((k) => k.status === "fail").flatMap((k) => k.instances.filter((i) => !i.acked && !i.later));
  const counts = {
    mustFix: liveInst.filter((i) => i.sev === "high").length, shouldFix: liveInst.filter((i) => i.sev === "med").length,
    consider: liveInst.filter((i) => i.sev === "low").length, failingChecks: items.length,
    later: checks.filter((k) => k.status === "later").length, checkedByYou: checks.reduce((n, k) => n + k.instances.filter((i) => i.acked).length, 0),
    passed: checks.filter((k) => k.status === "pass").length, na: checks.filter((k) => k.status === "na").length,
    questionsOpen: questions.filter((q) => q.state === "open").length, questionsAnswered: questions.filter((q) => q.state === "answered").length,
  };
  const sections = Object.fromEntries(SECTIONS.map((s) => [s, Math.max(0, 100 - secPen[s])]));
  return { score, rawScore, verdict, band, gated, market: c.market, lang: c.L, careerYears: c.careerYears, checks, items, questions, sections, counts };
}

/* The name the task brief uses. Same function, same result. */
export const reviewCv = reviewCV;

/* ---------- small helpers for the page ---------- */

/* Is a CV language ready to offer? A summary exists in it and DOC-01 passes. */
export function langReadiness(P, langs, opts = {}) {
  const out = {};
  for (const L of langs || []) {
    const r = reviewCV(P, { ...opts, lang: L });
    const fails = r.checks.filter((k) => (k.id === "DOC-01" || k.id === "SUM-01") && k.status === "fail").map((k) => k.id);
    out[L] = { ready: !fails.length, fails };
  }
  return out;
}

/* The Profile field a "Fix" button can focus, or null when only the CV Builder
   can do it (Profile has one headline input, English, and edits only the first
   education entry; the seed keeps its work-rights line in data-p="nationality"). */
export function profileTarget(path, { real = false } = {}) {
  const p = str(path);
  let m;
  if (["name", "city", "phone", "email", "langs"].includes(p)) return `[data-p="${p}"]`;
  if ((m = /^edits\.(name|city|phone|email)$/.exec(p))) return m[1] === "name" ? null : `[data-p="${m[1]}"]`;
  if (p === "title.en") return '[data-p="title.en"]';
  if (p === "workRights" || p === "nationality") return real ? `[data-p="${p}"]` : '[data-p="nationality"]';
  if ((m = /^summary\.([a-z]{2})$/.exec(p))) return `[data-p="summary.${m[1]}"]`;
  if ((m = /^experience\.(\d+)\.(t|c|d)$/.exec(p))) return `[data-xp="${m[1]}.${m[2]}"]`;
  if ((m = /^experience\.(\d+)\.bullets\.(\d+)$/.exec(p))) return `[data-xp="${m[1]}.b.${m[2]}"]`;
  if ((m = /^education\.0\.(b|s)$/.exec(p))) return `[data-xp="edu.${m[1]}"]`;
  if ((m = /^competencies\.(\d+)\.0$/.exec(p))) return `[data-skilldel="${m[1]}"]`;
  return null;
}

/* The value an evidence path points at, for the page's "quote" and for tests. */
export function valueAt(P, path, edits = {}) {
  const p = str(path);
  if (p.startsWith("edits.")) return str(edits[p.slice(6)]);
  let v = P;
  for (const k of p.split(".")) { if (v === undefined || v === null) return ""; v = v[k]; }
  return typeof v === "string" ? v : v && typeof v === "object" && "x" in v ? str(v.x) : str(v);
}

/**
 * traceLines(lines, P, {answers}) — the trace check on a CV the portal actually
 * generated. Each printed line (a bullet or a summary sentence) is matched to
 * the candidate's closest own line (never a template bullet) or a stored
 * answer; every word that line does not contain is returned as added. Allowed
 * without a source: small function words and the first word (the Builder may
 * re-verb).
 */
const TRACE_FREE = new Set(["the", "a", "an", "and", "of", "in", "for", "to", "with", "on", "at", "by", "from", "as", "its", "their", "und", "der",
  "die", "das", "mit", "für", "von", "im", "zu", "bei", "den", "dem", "ein", "eine", "einer"]);
export function traceLines(lines, P, { answers = {} } = {}) {
  const pool = [];
  for (const [k, v] of Object.entries((P || {}).summary || {})) for (const s of sentences(v)) pool.push({ path: "summary." + k, text: s });
  (P.experience || []).forEach((e, i) => {
    pool.push({ path: `experience.${i}.t`, text: str(e.t) });
    (e.bullets || []).forEach((b, j) => { if (!b.ach) pool.push({ path: `experience.${i}.bullets.${j}`, text: str(b.x) }); });
  });
  const ansStems = new Set(Object.values(answers).flatMap((a) => letterWords(a).map(stem)));
  return (lines || []).map((line) => {
    const toks = [];
    const re = /\p{L}[\p{L}\p{M}'’-]*|\d[\d,.]*/gu;
    let m;
    while ((m = re.exec(str(line)))) toks.push({ word: m[0], start: m.index, end: m.index + m[0].length, stem: stem(m[0]) });
    let best = null, bestN = -1;
    for (const s of pool) {
      const st = new Set([...letterWords(s.text), ...(s.text.match(/\d[\d,.]*/g) || [])].map(stem));
      const n = toks.filter((t) => st.has(t.stem)).length;
      /* Most shared words wins; on a tie, the shorter line (a bullet over a whole summary sentence). */
      if (n > bestN || (n === bestN && best && st.size < best.stems.size)) { best = { ...s, stems: st }; bestN = n; }
    }
    const added = toks.filter((t, k) => k > 0 && !TRACE_FREE.has(low(t.word)) && !(best && best.stems.has(t.stem)) && !ansStems.has(t.stem))
      .map(({ word, start, end }) => ({ word, start, end }));
    return { line: str(line), source: best ? { path: best.path, text: best.text } : null, added };
  });
}

if (typeof window !== "undefined") window.reviewCV = reviewCV;
