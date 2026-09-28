/**
 * Listing + profile → fit verdict. Pure: no DOM, no network.
 *
 * The one rule: nothing is reported as proven without a line of the profile that
 * proves it. A requirement the engine cannot read is listed for the person to
 * judge, never quietly counted as met.
 */
import { LANGUAGES, levelRank } from "./intake-parse.js";

/* Sectors decide the role's own field (weight 3). The first nine are tags the
   portal vocabulary already has; the rest are sectors it lacks. */
export const SECTORS = ["automotive", "mobility", "real estate", "media", "publishing", "construction",
  "logistics", "trading", "retail", "tourism", "hospitality", "finance", "banking", "insurance",
  "healthcare", "pharma", "education", "fmcg", "oil & gas", "fintech", "crypto", "legal"];

/* Synonyms the portal's SYN table does not carry. "sales" and "marketing" are
   here so a requirement that names them is checked for them — without these,
   "leading sales teams" would pass on "leading" alone. */
export const EXTRA_SYN = {
  tourism: ["tourism", "touristic", "travel industry", "travel trade", "destination marketing", "tour operator", "tourist board"],
  hospitality: ["hospitality", "hotel", "resort"],
  finance: ["financial services", "finance industry", "finance sector", "asset management"],
  banking: ["banking", "investment bank"],
  insurance: ["insurance", "insurer", "underwriting"],
  healthcare: ["healthcare", "health care", "hospital", "clinical", "medical"],
  pharma: ["pharma", "pharmaceutical"],
  education: ["education", "school", "edtech"],
  fmcg: ["fmcg", "consumer goods"],
  "oil & gas": ["oil & gas", "oil and gas", "petroleum", "upstream", "downstream"],
  fintech: ["fintech", "payments"],
  crypto: ["crypto", "blockchain", "web3"],
  legal: ["legal", "law firm", "litigation"],
  sales: ["sales", "selling", "vertrieb", "account executive"],
  marketing: ["marketing"],
  gcc: ["dubai", "abu dhabi", "sharjah", "ajman", "emirates", "qatar", "doha", "oman", "muscat", "bahrain", "kuwait", "riyadh", "vae", "golfregion"],
};

const pad = (s) => " " + String(s || "").toLowerCase().replace(/[^\p{L}\p{N}&-]+/gu, " ") + " ";

/** Every concept with its synonyms: the portal's VOCAB/SYN plus EXTRA_SYN. */
export function lexicon({ VOCAB = [], SYN = {} } = {}) {
  const keys = [...new Set([...VOCAB, ...Object.keys(SYN), ...Object.keys(EXTRA_SYN)])];
  return keys.map((k) => ({ k, syns: [...new Set([...(SYN[k] || [k]), ...(EXTRA_SYN[k] || [])])] }));
}

/* A synonym matches at a word start. A trailing space in the table ("ai ", "it ")
   means it must also end at a word boundary. */
function synAt(padded, syn) {
  const s = String(syn).toLowerCase();
  const word = pad(s).trim();
  if (!word) return -1;
  return padded.indexOf(" " + word + (s.endsWith(" ") ? " " : ""));
}

/** Concepts named in the text, in order of first appearance. */
export function conceptsIn(text, lex) {
  const p = pad(text);
  return lex
    .map(({ k, syns }) => ({ k, i: Math.min(...syns.map((s) => { const i = synAt(p, s); return i < 0 ? Infinity : i; })) }))
    .filter((x) => x.i < Infinity)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.k);
}

const hasConcept = (text, k, lex) => {
  const e = lex.find((x) => x.k === k);
  const p = pad(text);
  return !!e && e.syns.some((s) => synAt(p, s) >= 0);
};

export function roleFieldOf(listing, lex) {
  const hay = [listing.title || "", ...(listing.duties || []).slice(0, 2)].join(" ");
  return conceptsIn(hay, lex).find((k) => SECTORS.includes(k)) || "";
}

/* ---------- profile evidence ---------- */

function evidenceFor(k, profile, lex) {
  const comp = (profile.competencies || []).find((c) => c[1] === k);
  if (comp) return { kind: "competency", ref: "Competencies", text: comp[0] };
  for (const e of profile.experience || []) {
    const b = (e.bullets || []).find((b) => (b.tags || []).includes(k) || hasConcept(b.x, k, lex));
    if (b) return { kind: "experience", ref: `${e.t} — ${e.c}`, text: b.x };
    if ((e.tags || []).includes(k) || hasConcept(`${e.t} ${e.c}`, k, lex)) {
      return { kind: "experience", ref: `${e.t} — ${e.c}`, text: `${e.t}, ${e.d}` };
    }
  }
  return null;
}

/* Years count only roles that carry the concept themselves — the role's own tags
   or its text — not a single bullet tag, so "mentored client teams" does not turn
   an advisory role into a leadership role. */
const entryHas = (e, k, lex) =>
  (e.tags || []).includes(k) || hasConcept(`${e.t} ${e.c} ${(e.bullets || []).map((b) => b.x).join(" ")}`, k, lex);

export function spanOf(d, year) {
  const ys = String(d || "").match(/(?:19|20)\d{2}/g);
  if (!ys) return null;
  const start = +ys[0];
  const end = /present|heute|current|today|now|aktuell|laufend/i.test(d) ? year : +ys[ys.length - 1];
  return end >= start ? [start, end] : null;
}

/** Total years covered, overlaps counted once. */
export function unionYears(spans) {
  const v = spans.filter(Boolean).map((s) => s.slice()).sort((a, b) => a[0] - b[0]);
  let total = 0, cur = null;
  for (const [s, e] of v) {
    if (!cur || s > cur[1]) { if (cur) total += cur[1] - cur[0]; cur = [s, e]; }
    else cur[1] = Math.max(cur[1], e);
  }
  return cur ? total + cur[1] - cur[0] : total;
}

const alternatives = (field) => String(field || "").split(/\s*,\s*|\s+or\s+|\s+oder\s+|\s*\/\s*/i).map((s) => s.trim()).filter(Boolean);

export function profileLanguages(profile) {
  return String(profile.langs || "").split(/[·,;|]/).map((s) => s.trim()).filter(Boolean).map((text) => {
    const language = Object.keys(LANGUAGES).find((k) => LANGUAGES[k].some((n) => text.toLowerCase().includes(n)));
    return language ? { language, text, rank: levelRank(text) || 2 } : null;
  }).filter(Boolean);
}

const DEG_WORD = /\b(?:degree|bachelor|master|mba|b\.?\s?sc|m\.?\s?sc|ph\.?d|doctorate|university|universität)\b|hochschul|studium|diplom/i;
const VOCATIONAL = /\b(?:ihk|apprenticeship|vocational)\b|ausbildung|kaufmann|kauffrau|berufsschule|berufsbildende/i;
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);

/* A nationality restriction admits the nationals of a country, read in the
   profile by adjective or country name as a whole word ("Omani" or "Oman", never
   "Romanian"). "local" is how Emiratisation and "nationals only" arrive, so it
   is the UAE; "gcc" admits all six Gulf states. */
const UAE_NATIONAL = /\b(?:emirati|uae|united arab emirates)\b/i;
const GULF = [UAE_NATIONAL, /\bsaudi\b/i, /\bqatari?\b/i, /\bkuwaiti?\b/i, /\bbahraini?\b/i, /\bomani?\b/i];
const ADMITS = {
  uae: [UAE_NATIONAL], emirati: [UAE_NATIONAL], local: [UAE_NATIONAL], gcc: GULF,
  saudi: [GULF[1]], qatari: [GULF[2]], kuwaiti: [GULF[3]], bahraini: [GULF[4]], omani: [GULF[5]],
};
const NATIONALS = { uae: "UAE", gcc: "GCC", local: "local" };
const meetsNationality = (key, nationality) =>
  (ADMITS[key] || [new RegExp(`\\b${String(key).replace(/[^\p{L}]+/gu, "")}\\b`, "iu")]).some((re) => re.test(String(nationality || "")));

/* ---------- one requirement ---------- */

/**
 * @returns {{state:'proven', evidence} | {state:'unproven', why} | {state:'unchecked', why} |
 *           {state:'blocker', why} | {state:'info'}}
 */
export function checkRequirement(req, profile, { lex, year }) {
  switch (req.type) {
    case "location":
      return { state: "info" };

    case "nationality":
      return meetsNationality(req.nationality, profile.nationality)
        ? { state: "info" }
        : { state: "blocker", why: `The listing is restricted to ${NATIONALS[req.nationality] || cap(req.nationality)} nationals.` };

    case "language": {
      const mine = profileLanguages(profile).find((l) => l.language === req.language);
      if (mine && mine.rank >= levelRank(req.level)) {
        return { state: "proven", evidence: { kind: "language", ref: "Languages", text: mine.text } };
      }
      return { state: "unproven", why: mine ? `Your CV lists ${mine.text}; the listing asks for ${req.level}.` : `Your CV lists no ${cap(req.language)}.` };
    }

    case "degree": {
      const edu = (profile.education || []).map((e) => `${e.b || ""} ${e.s || ""}`.trim()).filter(Boolean);
      const degree = edu.find((s) => DEG_WORD.test(s) && !VOCATIONAL.test(s));
      if (!degree) {
        if (!edu.length) return { state: "unproven", why: "Your CV lists no degree." };
        const first = (profile.education[0].b || edu[0]).trim();
        return { state: "unproven", why: VOCATIONAL.test(edu[0]) ? `Your qualification (${first}) is vocational, not a degree.` : `Your education (${first}) is not a degree.` };
      }
      const alts = alternatives(req.field).map((a) => conceptsIn(a, lex)).filter((c) => c.length);
      if (!req.field || /related field|verwandte/i.test(req.field) || !alts.length || alts.some((cs) => cs.every((k) => hasConcept(degree, k, lex)))) {
        return { state: "proven", evidence: { kind: "education", ref: "Education", text: degree } };
      }
      return { state: "unproven", why: `Your degree is not in ${req.field}.` };
    }

    case "years": {
      const exp = profile.experience || [];
      if (!req.field) {
        const n = unionYears(exp.map((e) => spanOf(e.d, year)));
        return n >= req.years
          ? { state: "proven", evidence: { kind: "experience", ref: "Experience", text: `${n} years in total` } }
          : { state: "unproven", why: `Your CV covers ${n} years; the listing asks for ${req.years}.` };
      }
      const alts = alternatives(req.field).map((a) => conceptsIn(a, lex)).filter((c) => c.length);
      if (!alts.length) return { state: "unproven", why: `“${req.field}” is not recognised in your CV — check it yourself.` };
      let best = { n: -1, cs: alts[0], es: [] };
      for (const cs of alts) {
        const es = exp.filter((e) => cs.every((k) => entryHas(e, k, lex)));
        const n = unionYears(es.map((e) => spanOf(e.d, year)));
        if (n > best.n) best = { n, cs, es };
      }
      if (best.n >= req.years) {
        return { state: "proven", evidence: { kind: "experience", ref: best.es.map((e) => `${e.t} — ${e.c}`).join("; "), text: `${best.n} years (${best.es.map((e) => e.d).join(", ")})` } };
      }
      return { state: "unproven", why: `Your CV shows ${best.n} years with ${best.cs.join(" + ")}; the listing asks for ${req.years}.` };
    }

    default: {
      const cs = conceptsIn(req.field || req.text, lex);
      if (!cs.length) return { state: "unchecked", why: "Not recognised in your CV — check it yourself." };
      const missing = cs.filter((k) => !evidenceFor(k, profile, lex));
      if (missing.length) return { state: "unproven", why: `Your CV shows no ${missing.join(", ")}.` };
      return { state: "proven", evidence: evidenceFor(cs[0], profile, lex) };
    }
  }
}

/* ---------- the verdict ---------- */

/**
 * @param {{title:string, duties:string[], requirements:object[]}} listing
 * @param {object} profile  the portal's P
 * @param {{vocab?:{VOCAB:string[],SYN:object}, sample?:boolean, year?:number}} [opt]
 */
export function assessFit(listing, profile, { vocab = {}, sample = false, year = new Date().getFullYear() } = {}) {
  const lex = lexicon(vocab);
  const L = listing || {};
  const roleField = roleFieldOf(L, lex);
  const proven = [], unproven = [], blockers = [];
  let total = 0, got = 0, mustOpen = false;

  for (const req of L.requirements || []) {
    const r = checkRequirement(req, profile || {}, { lex, year });
    if (r.state === "info") continue;
    if (r.state === "blocker") { blockers.push({ req, why: r.why }); continue; }
    const w = req.strength === "nice" ? 1
      : roleField && conceptsIn(req.field || req.text, lex).includes(roleField) ? 3 : 2;
    if (r.state === "proven") { proven.push({ req, evidence: r.evidence }); total += w; got += w; continue; }
    // A requirement with no recognisable content is listed but not scored: soft
    // skills ("a team player") would otherwise sink every full-length posting.
    // For the same reason only a scored must decides Apply against "name the gap".
    const scored = r.state === "unproven";
    unproven.push({ req, why: r.why, scored });
    if (scored) total += w;
    if (scored && req.strength === "must") mustOpen = true;
  }

  const score = total ? Math.round((100 * got) / total) : null;
  const verdict = blockers.length || (score !== null && score < 40) ? "skip"
    : score === null || mustOpen ? "gap"
    : "apply";
  return { score, verdict, roleField, proven, unproven, blockers, sampleProfile: !!sample };
}
