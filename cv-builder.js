/**
 * The CV builder: the candidate's master CV, edited step by step.
 *
 * One rule holds the whole module together: every claim on the CV traces to a line
 * the candidate wrote. So there is no function here that returns new prose. The
 * only strings any operation can produce are
 *   - text the candidate typed (setField, addBullet, setLang),
 *   - exact substrings of existing text (splitBullet),
 *   - an exact concatenation of two of their lines (mergeBullets),
 *   - verbatim copies of their own lines (restoreLine, makeOwnLine, chips),
 *   - fixed labels (headings, month names, level labels, language names),
 *   - dates formatted from the month and year the candidate picked.
 * A missing field is reported, never filled. A missing figure becomes a question
 * whose answer is stored and shown back, never spliced into a line.
 *
 * Pure: no DOM, no storage, no clock (callers pass ctx.now), and no op mutates its
 * input — each returns a new state. The page loads it as window.CVB; the Node tests
 * run exactly what ships.
 *
 * ctx = { now: Date, docLangs: ['EN','DE',...], cvLang: 'en', jobs: [{r, co}],
 *         match: (text, needle) => bool, vocab: {VOCAB, SYN}, source: P_SOURCE,
 *         real: HAS_REAL_PROFILE, market: 'gcc'|'dach'|'uk', header: {...},
 *         owner: {real, key, who}, srcHash, targetRole, sumOverrides }
 * Every field is optional; a check that needs a missing one is skipped.
 */
import { FIGURE, WEAK_OPENERS, BUZZWORDS } from "./coach.js";
import { layoutCv } from "./cv-text-pdf.js";
import { findPersonalData, demonymUses } from "./personal-data.js";

/* ------------------------------------------------------------------ basics */

const S = (v) => (v == null ? "" : String(v));
const lc = (s) => S(s).toLowerCase();
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
const uniq = (a) => [...new Set(a)];
const isObj = (o) => !!o && typeof o === "object" && !Array.isArray(o);
/* Letters and digits only, for comparing two lines "as the same words". */
const norm = (s) => lc(s).normalize("NFC").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** 32-bit FNV-1a over UTF-16 code units, as hex. Stable ids and source hashes. */
export function fnv1a(s) {
  let h = 0x811c9dc5;
  const t = S(s);
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

/* The page's keyword matcher (career-portal.html padKw/synHit), copied so the module
   works on its own: a synonym matches at the start of a word, never inside one, so
   "ai" is not found in "Dubai". The page passes its own through ctx.match. */
const padKw = (s) => " " + lc(s).replace(/[^\p{L}\p{N}&-]+/gu, " ") + " ";
const synHit = (pad, syn) => { const w = lc(syn), t = w.trim(); return !!t && pad.includes(" " + t + (w.endsWith(" ") ? " " : "")); };
const matcher = (ctx) => (ctx && typeof ctx.match === "function" ? ctx.match : (t, n) => synHit(padKw(t), n));
/* Regex-escape; a hyphen stays literal because it is used outside any class. */
const escRe = (s) => S(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/* One word or hyphenated phrase, not inside a longer word ("key" not in "keynote"). */
const wordRe = (w) => new RegExp("(?:^|[^\\p{L}-])" + escRe(w) + "(?:[^\\p{L}-]|$)", "iu");
/* A whole phrase at word boundaries, e.g. "business advisor" inside a headline. */
const hasPhrase = (text, phrase) => { const p = norm(phrase); return !!p && (" " + norm(text) + " ").includes(" " + p + " "); };

/* ------------------------------------------------------------------ fixed labels */

export const STEPS = Object.freeze([
  { id: "header", title: "1 Header" },
  { id: "headline", title: "2 Headline" },
  { id: "summary", title: "3 Summary" },
  { id: "experience", title: "4 Experience" },
  { id: "skills", title: "5 Skills & tools" },
  { id: "education", title: "6 Education" },
  { id: "languages", title: "7 Languages & references" },
  { id: "check", title: "8 Check & export" },
]);
const STEP_IDS = STEPS.map((s) => s.id);

/** Language levels: a fixed scale, strongest first, so "never lower" is an index compare. */
export const LEVELS = Object.freeze(["native", "fluent", "business", "conversational", "basic"]);
/* The Arabic, French and Spanish labels need a native speaker's review before an
   Arabic CV goes out (the arabic-design rule); they are labels, never candidate text. */
export const LEVEL_LABEL = Object.freeze({
  en: { native: "native", fluent: "fluent", business: "business fluent", conversational: "conversational", basic: "basic" },
  de: { native: "Muttersprache", fluent: "fließend", business: "verhandlungssicher", conversational: "gute Kenntnisse", basic: "Grundkenntnisse" },
  ar: { native: "لغة أم", fluent: "بطلاقة", business: "مستوى مهني", conversational: "مستوى محادثة", basic: "مستوى مبتدئ" },
  fr: { native: "langue maternelle", fluent: "courant", business: "niveau professionnel", conversational: "intermédiaire", basic: "notions" },
  es: { native: "lengua materna", fluent: "fluido", business: "nivel profesional", conversational: "intermedio", basic: "básico" },
});
/* How a level is written in a CV, read back onto the scale. Only the scale's own
   words (its labels in the five languages, and their plain spellings) map: once a
   row is changed the line prints the label, so a word that means something else
   ("bilingual", "advanced", "Muttersprachniveau", "sehr gute Kenntnisse") or a
   compound ("native / business") stays unrecognised and prints as written. */
const LEVEL_WORDS = [
  ["native", ["native", "native speaker", "mother tongue", "mothertongue", "first language", "muttersprache", "muttersprachlich", "langue maternelle", "lengua materna", "nativo", "nativa", "لغة أم", "اللغة الأم"]],
  ["fluent", ["fluent", "fluently", "fließend", "fliessend", "courant", "couramment", "fluido", "fluida", "بطلاقة"]],
  ["business", ["business fluent", "verhandlungssicher", "niveau professionnel", "nivel profesional", "مستوى مهني"]],
  ["conversational", ["conversational", "gute kenntnisse", "intermédiaire", "intermedio", "مستوى محادثة"]],
  ["basic", ["basic", "basics", "grundkenntnisse", "notions", "básico", "basico", "مستوى مبتدئ"]],
];
const CEFR = /^[abc][12]$/i;

/* Language names per document language, keyed by code. A name the table does not
   know is printed exactly as the candidate typed it. */
const LANG_NAMES = Object.freeze({
  en: { en: "English", de: "German", ar: "Arabic", fr: "French", es: "Spanish", it: "Italian", pt: "Portuguese", nl: "Dutch", tr: "Turkish", ru: "Russian" },
  de: { en: "Englisch", de: "Deutsch", ar: "Arabisch", fr: "Französisch", es: "Spanisch", it: "Italienisch", pt: "Portugiesisch", nl: "Niederländisch", tr: "Türkisch", ru: "Russisch" },
  ar: { en: "الإنجليزية", de: "الألمانية", ar: "العربية", fr: "الفرنسية", es: "الإسبانية", it: "الإيطالية", pt: "البرتغالية", nl: "الهولندية", tr: "التركية", ru: "الروسية" },
  fr: { en: "Anglais", de: "Allemand", ar: "Arabe", fr: "Français", es: "Espagnol", it: "Italien", pt: "Portugais", nl: "Néerlandais", tr: "Turc", ru: "Russe" },
  es: { en: "Inglés", de: "Alemán", ar: "Árabe", fr: "Francés", es: "Español", it: "Italiano", pt: "Portugués", nl: "Neerlandés", tr: "Turco", ru: "Ruso" },
});
/* Any of those names (and the page's LANG_CODE spellings) back to a code. */
const LANG_CODE = (() => {
  const m = { anglais: "en", englisch: "en", allemand: "de", arabisch: "ar", arabe: "ar", "französisch": "fr", spanisch: "es" };
  for (const names of Object.values(LANG_NAMES)) for (const [code, n] of Object.entries(names)) m[lc(n)] = code;
  return m;
})();

/* Section headings. The Arabic ones reuse the page's DOCL wording where it has one;
   the three new ones need native review. */
export const LABELS = Object.freeze({
  en: { profile: "Executive profile", core: "Core competencies", experience: "Experience", earlier: "Earlier career", education: "Education", technical: "Technical skills", languages: "Languages", references: "References", refs: "References available on request." },
  de: { profile: "Profil", core: "Kernkompetenzen", experience: "Berufserfahrung", earlier: "Frühere Stationen", education: "Ausbildung", technical: "EDV-Kenntnisse", languages: "Sprachen", references: "Referenzen", refs: "Referenzen auf Anfrage." },
  ar: { profile: "نبذة مهنية", core: "الكفاءات الأساسية", experience: "الخبرة العملية", earlier: "المسيرة المهنية السابقة", education: "المؤهلات العلمية", technical: "المهارات التقنية", languages: "اللغات", references: "المراجع", refs: "تتوفر المراجع عند الطلب." },
  fr: { profile: "Profil professionnel", core: "Compétences clés", experience: "Expérience professionnelle", earlier: "Parcours antérieur", education: "Formation", technical: "Compétences techniques", languages: "Langues", references: "Références", refs: "Références disponibles sur demande." },
  es: { profile: "Perfil profesional", core: "Competencias clave", experience: "Experiencia profesional", earlier: "Trayectoria anterior", education: "Formación", technical: "Competencias técnicas", languages: "Idiomas", references: "Referencias", refs: "Referencias disponibles a petición." },
});

/* The portal's vocabulary labels (apply.html TAG_LABEL). A parsed competency named
   exactly this is the portal's word, not the candidate's, until they confirm it. */
const VOCAB_LABEL = Object.freeze({ strategy: "Strategy", "business development": "Business Development", "market entry": "Market Entry", "market analysis": "Market Analysis", negotiation: "Negotiation", contracts: "Contracts", leadership: "Leadership", stakeholder: "Stakeholder Management", "p&l": "P&L", restructuring: "Restructuring", operations: "Operations", investor: "Investor Relations", "digital transformation": "Digital Transformation", ai: "AI", it: "IT", training: "Training", communication: "Communication", consulting: "Consulting", "real estate": "Real Estate", media: "Media", publishing: "Publishing", automotive: "Automotive", mobility: "Mobility", b2b: "B2B", trading: "Trading", construction: "Construction", logistics: "Logistics", germany: "Germany Market", gcc: "GCC Market", arabic: "Arabic", german: "German", english: "English", compliance: "Compliance", franchise: "Franchise", retail: "Retail", vip: "VIP Clients" });
const LANG_TAGS = ["arabic", "german", "english"];
const MARKET_TAGS = ["germany", "gcc"];

/* The writer's list of qualifiers a line may only keep if the candidate wrote it. */
export const QUALIFIERS = Object.freeze(["major", "significant", "extensive", "high-level", "world-class", "numerous", "key"]);
/* Adjectives the writer bans from a headline and summary, plus coach.js BUZZWORDS. */
export const BANNED = Object.freeze(uniq(["recognised", "recognized", "proven", "high-performing", "results-driven", "visionary", "major", "extensive", ...BUZZWORDS]));

/* A line that opens on an act (coach.js keeps its own copy private). */
const STRONG_VERB = /^(?:[a-z]+ed|led|ran|won|cut|grew|built|drove|set|sold|took|made|met|held|kept|saw|oversaw|began|brought|chose|left|führte|leitete|baute|gewann|senkte|steigerte|verhandelte)\b/i;
const PRONOUN = /(?:^|[^\p{L}])(?:i|my|me|ich|mein|meine|meiner)(?:[^\p{L}]|$)/iu;
/* Words that give a line its scope without a figure. */
const SCOPE = /\b(staff|employees|team|divisions?|stations?|branches|sites|founded|co-founded|promoted|board|mitarbeiter(?:n)?|gegründet|niederlassungen)\b/i;

const STOP = new Set(["and", "the", "for", "with", "of", "in", "on", "at", "to", "a", "an", "from", "by", "as", "or", "into", "across", "over", "per", "und", "der", "die", "das", "für", "mit", "von", "im", "am", "zum", "zur", "den", "dem", "des", "auf", "bei", "aus", "über", "sowie", "oder", "ein", "eine"]);

/* Places a role's " — <place>" suffix may name. Only then is the employer split. */
const PLACE = /\b(dubai|abu dhabi|sharjah|ajman|ras al khaimah|fujairah|uae|u\.a\.e\.|united arab emirates|qatar|doha|saudi arabia|ksa|riyadh|jeddah|dammam|bahrain|manama|kuwait|oman|muscat|gcc|gulf|mena|middle east|germany|deutschland|berlin|munich|münchen|hamburg|frankfurt|cologne|köln|hannover|hanover|düsseldorf|stuttgart|bremen|leipzig|dresden|austria|österreich|vienna|wien|switzerland|schweiz|zurich|zürich|geneva|london|manchester|birmingham|uk|united kingdom|england|scotland|ireland|dublin|france|paris|spain|madrid|barcelona|italy|milan|lebanon|beirut|egypt|cairo|jordan|amman|turkey|istanbul|europe|international|remote|worldwide)\b/i;

/* Nationality, date of birth, age, place of birth, religion, marital status and health
   come from personal-data.js, the scan CV Review runs, so both tabs read a line the
   same way. What it does not cover stays here, each pattern naming what it found.
   `hdr` ones are bare words that only count in header fields; a bare word may be a
   false positive, so it can be dismissed. The unscoped ones are labels or numbers,
   never a false positive, and the only ones read in the name and email fields. */
const PERSONAL = [
  [/\b(children|kinder)\s*:/i, "children"],
  [/\b(gender|geschlecht|sex)\s*:/i, "gender"],
  [/\b(male|female|männlich|weiblich)\b/i, "gender", "hdr"],
  [/\b(lichtbild|bewerbungsfoto)\b/i, "a photo"],
  [/\b(photo|photograph)\b/i, "a photo", "hdr"],
  [/\b(passport|reisepass|pass|emirates id|id card|personalausweis)\s*(no\.?|number|nr\.?|#)?\s*:?\s*[a-z]{0,2}\d[\d-]{5,}/i, "an ID or passport number"],
  [/\b784-?\d{4}-?\d{7}-?\d\b/, "an Emirates ID number"],
];
/* What a personal-data.js finding names, and the words that dismiss it (CV Review's). */
const PD_WHAT = { nationality: "nationality", dob: "date of birth", age: "age", date: "a full date", birthplace: "place of birth", religion: "religion", marital: "marital status", health: "a health detail" };
const PD_ACK = { nationality: "This names a market, a language or a company, not my nationality", dob: "This is not about me", birthplace: "This is not about me",
  age: "This is not my date of birth or my age", date: "This is not my date of birth or my age", religion: "This is not my religion", marital: "This is not my family status",
  health: "This is not about my health", other: "This is not about me" };
const BREAK_WORDS = /\b(career break|sabbatical|auszeit|berufliche pause|time off|gap year)\b/i;

/* Months as CVs write them, in the five document languages. */
const MONTHS = (() => {
  const m = {};
  const put = (names, i) => names.forEach((n) => { m[n] = i; });
  [["jan", "january", "januar", "jän", "jänner", "janv", "janvier", "ene", "enero"], ["feb", "february", "februar", "févr", "fév", "fev", "février", "febrero"],
   ["mar", "march", "mär", "mrz", "märz", "maerz", "mars", "marzo"], ["apr", "april", "avr", "avril", "abr", "abril"],
   ["may", "mai", "mayo"], ["jun", "june", "juni", "juin", "junio"], ["jul", "july", "juli", "juil", "juillet", "julio"],
   ["aug", "august", "août", "aout", "ago", "agosto"], ["sep", "sept", "september", "septembre", "septiembre", "set"],
   ["oct", "october", "okt", "oktober", "octobre", "octubre"], ["nov", "november", "novembre", "noviembre"],
   ["dec", "december", "dez", "dezember", "déc", "décembre", "dic", "diciembre"]].forEach((names, i) => put(names, i + 1));
  return m;
})();
const MONTH_OUT = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  de: ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"],
  fr: ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."],
  es: ["ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "sept.", "oct.", "nov.", "dic."],
};
export const PRESENT = Object.freeze({ en: "Present", de: "heute", ar: "حتى الآن", fr: "aujourd'hui", es: "actualidad" });
const PRESENT_WORDS = new Set(["present", "current", "now", "today", "ongoing", "date", "to date", "heute", "bis heute", "aktuell", "laufend", "jetzt", "aujourd'hui", "à ce jour", "actualidad", "la actualidad", "presente", "hoy", "حتى الآن", "الآن",
  /* The review engine's OPEN_WORDS, so both tabs read the same open end. */
  "currently", "derzeit", "actual", "oggi", "حاليا", "présent", "à présent"]);

/** Every fixed string the builder may print that the candidate did not type. */
export const FIXED_LABELS = Object.freeze([
  ...Object.values(LEVEL_LABEL).flatMap((t) => Object.values(t)),
  ...Object.values(LANG_NAMES).flatMap((t) => Object.values(t)),
  ...Object.values(PRESENT), ...Object.values(MONTH_OUT).flat(), "seit",
  /* Numeric months: a DACH or Arabic date prints the picked month as "03/2005". */
  ...Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0")),
  ...Object.values(LABELS).flatMap((t) => Object.values(t)),
]);

/* ------------------------------------------------------------------ dates */

/* One end of a range: "Mar 2005", "03/2005", "2005-03", "2005". Null when unread. */
function parsePoint(str) {
  const s = lc(str).trim().replace(/\s+/g, " ");
  let m;
  if ((m = s.match(/^(\d{1,2})\s*[/.]\s*(\d{4})$/)) && +m[1] >= 1 && +m[1] <= 12) return m[2] + "-" + String(+m[1]).padStart(2, "0");
  if ((m = s.match(/^(\d{4})-(\d{1,2})$/)) && +m[2] >= 1 && +m[2] <= 12) return m[1] + "-" + String(+m[2]).padStart(2, "0");
  if ((m = s.match(/^((?:19|20)\d{2})$/))) return m[1];
  if ((m = s.match(/^(\p{L}+)\.?,?\s+((?:19|20)\d{2})$/u)) && MONTHS[m[1]]) return m[2] + "-" + String(MONTHS[m[1]]).padStart(2, "0");
  return null;
}

/**
 * A dates string read into month/year fields. `ok` is true only when the whole
 * string was understood; anything else is kept verbatim by the caller and flagged.
 * A trailing parenthetical ("(alongside GTI)") comes back as `rest`, never dropped.
 * @returns {{from:string, to:string, now:boolean, ok:boolean, rest:string}}
 */
export function parseDates(d) {
  const out = { from: "", to: "", now: false, ok: false, rest: "" };
  let s = S(d).trim();
  if (!s) return out;
  const paren = s.match(/\s*\(([^()]*)\)\s*$/);
  if (paren) { out.rest = paren[1].trim(); s = s.slice(0, paren.index).trim(); }
  const since = s.match(/^(seit|since|depuis|desde|ab)\s+(.+)$/i);
  let a, b;
  if (since) { a = since[2]; b = "present"; }
  else {
    const parts = s.split(/\s*[–—]\s*|\s+-\s+|\s+(?:to|bis|until|till|à|au|a|hasta|al)\s+/i);
    if (parts.length === 2) [a, b] = parts;
    else { const m = s.match(/^(\d{4}|\d{1,2}[/.]\d{4})\s*-\s*(\d{4}|\d{1,2}[/.]\d{4})$/); if (m) { a = m[1]; b = m[2]; } }
  }
  if (a == null) { const one = parsePoint(s); if (one) out.from = one; return out; }
  const from = parsePoint(a);
  const bl = lc(b).trim().replace(/\s+/g, " ");
  const now = PRESENT_WORDS.has(bl);
  const to = now ? "" : parsePoint(b);
  if (from) out.from = from;
  if (to) out.to = to;
  out.now = now;
  out.ok = !!from && (now || !!to) && !out.rest;
  /* The end exactly as written, so a side the pickers cannot hold is never dropped. */
  if (!since) out.toRaw = S(b).trim();
  return out;
}

/* The dates part of a raw string was understood, even if a note in brackets follows
   ("Aug 2007 – 2012 (alongside GTI)"): only a string whose dates cannot be read is flagged. */
const datesReadable = (d) => { const pd = parseDates(d); return pd.ok || (!!pd.rest && !!pd.from && (pd.now || !!pd.to)); };
/* The picker values a raw string gives, its bracketed note set aside. Each side loads
   on its own, so a readable start survives an end no picker can hold ("Q1 2005"). */
const pickersOf = (d) => { const pd = parseDates(d); return { from: pd.from || "", to: pd.to || "", now: !!pd.now }; };
/* An end the candidate wrote that no picker can hold ("Q1 2018"): printed as written. */
const unreadEnd = (d) => { const pd = parseDates(d); return pd.toRaw && !pd.to && !pd.now ? pd.toRaw : ""; };

const monthsOf = (p, end) => {
  const m = S(p).match(/^(\d{4})(?:-(\d{2}))?$/);
  if (!m) return null;
  return +m[1] * 12 + (m[2] ? +m[2] - 1 : end ? 11 : 0);
};
/* The span a role covers, in months, from its picked fields or, failing that, its raw
   string read leniently. Year-only ends count as the whole year and say so. */
function spanOf(role, now) {
  const pd = role.dDirty && role.from ? { from: role.from, to: role.to, now: role.now } : parseDates(role.d);
  const from = monthsOf(pd.from, false);
  if (from == null) return null;
  const nowM = now ? now.getFullYear() * 12 + now.getMonth() : null;
  const to = pd.now ? nowM : monthsOf(pd.to, true);
  return { from, to, open: !!pd.now, coarse: !/-/.test(pd.from) || (!pd.now && !/-/.test(pd.to)) };
}

function fmtPoint(p, lang, market) {
  const m = S(p).match(/^(\d{4})(?:-(\d{2}))?$/);
  if (!m) return S(p);
  if (!m[2]) return m[1];
  if (market === "dach" || lang === "ar" || !MONTH_OUT[lang]) return m[2] + "/" + m[1];
  return MONTH_OUT[lang][+m[2] - 1] + " " + m[1];
}

/* The role's own dates string with its note, as it prints while the pickers are untouched. */
function rawDates(role) {
  /* Only the parts of the note the raw string does not already carry, so a note merged
     from "(alongside GTI)" never prints twice once those dates are typed again. */
  const d = S(role.d), n = S(role.note).split(/\s*;\s*/).filter((p) => p.trim() && !hasPhrase(d, p)).join("; ");
  return n ? (d ? d + " (" + n + ")" : n) : d;
}

/**
 * The dates a role prints. Until the candidate touches the pickers this is the string
 * they wrote, verbatim. After that it is built from their month and year, in the
 * document language: GCC/UK "Mar 2005 – Jan 2008", DACH "03/2005 – 01/2008" and
 * "seit 02/2012" in German. The note is appended so it is never lost.
 */
export function formatDates(role, lang = "en", market = "gcc") {
  if (!(role && role.dDirty && role.from)) return rawDates(role || {});
  const L = LEVEL_LABEL[lang] ? lang : "en";
  const from = fmtPoint(role.from, L, market);
  let out;
  if (role.now) out = L === "de" && market === "dach" ? "seit " + from : from + " – " + PRESENT[L];
  else if (role.to) out = from + " – " + fmtPoint(role.to, L, market);
  else { const end = unreadEnd(role.d); out = end ? from + " – " + end : from; }
  const n = S(role.note).trim();
  return n ? out + " (" + n + ")" : out;
}

/** How many years the record covers, from the role dates (the page's careerYears rule). */
export function careerYears(state, now) {
  const spans = (state.roles || []).map((r) => spanOf(r, now)).filter(Boolean);
  if (!spans.length) return 0;
  const start = Math.min(...spans.map((s) => s.from));
  const open = spans.some((s) => s.open);
  const end = open && now ? now.getFullYear() * 12 + now.getMonth() : Math.max(...spans.map((s) => (s.to == null ? s.from : s.to)));
  /* Calendar years between the first start and the last end, as the page counts them. */
  const y = Math.floor(end / 12) - Math.floor(start / 12);
  return y >= 2 && y <= 60 ? y : 0;
}

/* ------------------------------------------------------------------ languages */

/**
 * "German (native) · Arabic (native) · English (fluent)" read into rows. A level the
 * scale does not know stays null with its raw text kept, and is never guessed.
 * CEFR levels ("B1") are accepted and printed as written.
 */
export function parseLangs(str) {
  return S(str).split(/\s*[·,;|]\s*|\n+/).map((x) => x.trim()).filter(Boolean).map((raw) => {
    const m = raw.match(/^(.+?)\s*(?:\(\s*(.*?)\s*\)|[:–—-]\s*(.+))?$/u);
    const name = S(m && m[1]).trim();
    const lvlRaw = S(m && (m[2] || m[3])).trim();
    const code = LANG_CODE[lc(name)] || null;
    let level = null, cefr = "";
    /* Surrounding punctuation aside ("Native."), the whole phrase must be a level word. */
    const l = lc(lvlRaw).replace(/\s+/g, " ").replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
    if (CEFR.test(lvlRaw)) cefr = lvlRaw.toUpperCase();
    else if (l) level = (LEVEL_WORDS.find(([, ws]) => ws.includes(l)) || [null])[0];
    return { name, code, level, cefr, lvlRaw, raw };
  });
}

/** One languages line in a document language: fixed names and level labels, the
 *  candidate's own name when the table does not know the language. */
export function langsLine(langs, lang = "en") {
  const L = LEVEL_LABEL[lang] ? lang : "en";
  return (langs || []).map((r) => {
    const name = (r.code && LANG_NAMES[L][r.code]) || S(r.name).trim();
    const lvl = r.level ? LEVEL_LABEL[L][r.level] : r.cefr || S(r.lvlRaw).trim();
    return lvl ? name + " (" + lvl + ")" : name;
  }).filter(Boolean).join(" · ");
}

const langNamesFor = (row) => uniq([lc(row.name), ...Object.values(LANG_NAMES).map((t) => row.code && lc(t[row.code]))].filter(Boolean));

/* ------------------------------------------------------------------ tags and evidence */

/** The vocabulary tags a line carries, at word boundaries. Null when no vocabulary was given. */
export function tagsFor(text, ctx) {
  const v = ctx && ctx.vocab;
  if (!v || !Array.isArray(v.VOCAB)) return null;
  const m = matcher(ctx), SYN = v.SYN || {};
  return v.VOCAB.filter((t) => (SYN[t] || [t]).some((s) => m(S(text), s)));
}

/* A figure a recruiter can size the claim with, not a year or a product number. */
export function hasFigure(text) {
  const t = S(text).replace(/\b(?:19|20)\d{2}\b/g, " ").replace(/\b(?:office|microsoft|m)\s*365\b/gi, " ").replace(/\bwindows\s*\d+\b/gi, " ").replace(/\bs\/?4\s*hana\b/gi, " ");
  return FIGURE.test(t);
}

const allBullets = (state) => state.roles.flatMap((r) => r.bullets.map((b) => ({ r, b })));

/** The lines that prove a competency, recomputed from their TEXT (never parser tags). */
export function evidenceFor(state, comp, ctx) {
  const out = [];
  const name = S(comp && comp.n);
  for (const { r, b } of allBullets(state)) {
    const tags = tagsFor(b.x, ctx);
    if ((tags && comp.tag && tags.includes(comp.tag)) || (name && hasPhrase(b.x, name))) out.push({ rid: r.id, bid: b.id, x: b.x });
  }
  return out;
}

const isLangComp = (c) => LANG_TAGS.includes(lc(c.tag)) || !!LANG_CODE[lc(c.n)];
const isMarketComp = (c) => MARKET_TAGS.includes(lc(c.tag)) || /\bmarket$/i.test(S(c.n).trim());
const compOwned = (c) => c.prov !== "vocab" || c.confirmed;

/**
 * Tags a line proves that the competency list lacks. The name offered is the exact
 * phrase found in the candidate's line; the vocabulary term is only a hint.
 */
export function suggestComps(state, ctx) {
  const have = new Set(state.comps.map((c) => lc(c.tag)));
  const v = ctx && ctx.vocab;
  if (!v) return [];
  const found = new Map();
  for (const { r, b } of allBullets(state)) {
    for (const t of tagsFor(b.x, ctx) || []) {
      if (have.has(t) || LANG_TAGS.includes(t) || MARKET_TAGS.includes(t)) continue;
      if (!found.has(t)) found.set(t, { tag: t, label: phraseIn(b.x, (v.SYN || {})[t] || [t]), hint: VOCAB_LABEL[t] || t, evidence: [] });
      found.get(t).evidence.push({ rid: r.id, bid: b.id, x: b.x });
    }
  }
  return [...found.values()];
}
/* The candidate's own words where a synonym matched: from the match to the end of that word. */
function phraseIn(text, syns) {
  const t = S(text), low = lc(t);
  for (const s of syns) {
    const w = lc(s).trim();
    if (!w) continue;
    const re = new RegExp("(?:^|[^\\p{L}\\p{N}])(" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "u");
    const m = low.match(re);
    if (m) {
      const at = m.index + m[0].length - m[1].length;
      let end = at + m[1].length;
      while (end < t.length && /[\p{L}\p{N}&-]/u.test(t[end])) end++;
      return t.slice(at, end);
    }
  }
  return "";
}

/* ------------------------------------------------------------------ state from a profile */

/* Keys the builder adds to a P.experience entry. Every existing reader ignores them. */
export const BUILDER_KEYS = Object.freeze(["id", "o", "p", "g", "from", "to", "now", "note", "earlier"]);
/* P fields the built CV owns. The header stays with setProf / edits.prof. */
export const OWNED = Object.freeze(["title", "summary", "experience", "education", "competencies", "langs", "refs", "technical", "referee"]);
/* Caps from profile-merge.js, so a store stays small beside the rest of the edits. */
export const CAPS = Object.freeze({ roles: 14, bullets: 12, skills: 48, bulletChars: 400 });

const rest = (o, drop) => { const r = {}; if (isObj(o)) for (const k of Object.keys(o)) if (!drop.includes(k)) r[k] = clone(o[k]); return r; };

/* Split "Employer — Place" only on the portal's own join and only when the right side
   is a place; the join rebuilds the same string, so the round trip cannot drift. */
function splitPlace(c, city) {
  const s = S(c), at = s.lastIndexOf(" — ");
  if (at < 1) return { c: s, p: "" };
  const right = s.slice(at + 3);
  const cityHead = lc(S(city).split(",")[0]).trim();
  const placey = right.trim() && right.length <= 40 && !/\d/.test(right) && right.trim().split(/\s+/).length <= 5 &&
    (PLACE.test(right) || (cityHead && lc(right).includes(cityHead)));
  return placey ? { c: s.slice(0, at), p: right } : { c: s, p: "" };
}

/* Employer, parent group and place joined with the portal's own separators. */
const joinC = (r) => { const base = [S(r.c), S(r.g)].filter((x) => x !== "").join(", "); return S(r.p) ? (base ? base + " — " + S(r.p) : S(r.p)) : base; };
/* The dates a role exports to P: verbatim until the pickers are touched, then formatted
   in the CV's own language (DACH style for a German CV). */
const effD = (r, lang) => (r.dDirty && r.from ? formatDates(r, lang, lang === "de" ? "dach" : "gcc") : rawDates(r));

function uniqueId(base, used) {
  let id = base, n = 1;
  while (used.has(id)) id = base + "-" + ++n;
  used.add(id);
  return id;
}

/**
 * The builder state for a profile P (already carrying comps/prof/xp/ach edits).
 * Achievement bullets (b.ach, portal templates around the candidate's figure) are
 * left out: they are not the candidate's words and are regenerated by the page.
 */
export function fromProfile(P, ctx = {}) {
  const p = P || {};
  const used = new Set();
  const city = (ctx.header && ctx.header.city) || p.city;
  const roles = (Array.isArray(p.experience) ? p.experience : []).filter(isObj).map((e, i) => {
    const o = Number.isInteger(e.o) ? e.o : e.o === null ? null : i;
    /* A P the builder exported carries p and g beside the joined c: take them back off. */
    let c = S(e.c), pl = "", g = S(e.g);
    if (e.p) { pl = S(e.p); if (c.endsWith(" — " + pl)) c = c.slice(0, -(" — " + pl).length); }
    else ({ c, p: pl } = splitPlace(c, city));
    if (g && c.endsWith(", " + g)) c = c.slice(0, -(", " + g).length);
    const pd = pickersOf(e.d);
    const built = typeof e.from === "string";
    const id = uniqueId(typeof e.id === "string" && e.id ? e.id : "r" + fnv1a(o + "|" + S(e.t) + "|" + S(e.c)), used);
    const bused = new Set();
    const bullets = (Array.isArray(e.bullets) ? e.bullets : []).filter((b) => !(isObj(b) && b.ach)).map((b) => {
      const x = isObj(b) ? S(b.x) : S(b);
      return { id: uniqueId(id + "." + fnv1a(x), bused), x, tags: isObj(b) && Array.isArray(b.tags) ? [...b.tags] : [], ro: o, orig: x, extra: rest(b, ["x", "tags", "ach"]) };
    });
    return {
      id, o, t: S(e.t), c, g, p: pl,
      from: built ? S(e.from) : pd.from, to: built ? S(e.to) : pd.to, now: built ? !!e.now : pd.now,
      note: S(e.note), d: S(e.d), dDirty: false, earlier: !!e.earlier,
      tags: Array.isArray(e.tags) ? [...e.tags] : [], extra: rest(e, ["t", "c", "d", "tags", "bullets", ...BUILDER_KEYS]), bullets,
    };
  });
  const comps = (Array.isArray(p.competencies) ? p.competencies : []).map((c) => {
    const n = Array.isArray(c) ? S(c[0]) : S(c), tag = Array.isArray(c) ? S(c[1]) : lc(c);
    const vocab = !!ctx.real && VOCAB_LABEL[tag] && lc(VOCAB_LABEL[tag]) === lc(n);
    return { n, tag, printed: true, prov: vocab ? "vocab" : "own", confirmed: false };
  });
  const education = (Array.isArray(p.education) ? p.education : []).filter(isObj).map((e) => ({
    b: S(e.b), s: S(e.s), gloss: S(e.gloss), inst: S(e.inst), date: S(e.date), grade: S(e.grade), extra: rest(e, ["b", "s", "gloss", "inst", "date", "grade"]),
  }));
  const referee = isObj(p.referee) ? { name: S(p.referee.name), role: S(p.referee.role), org: S(p.referee.org), date: S(p.referee.date), reachable: !!p.referee.reachable, copy: !!p.referee.copy } : { name: "", role: "", org: "", date: "", reachable: false, copy: false };
  return {
    v: 1, seq: 0, lang: S(ctx.cvLang || p.cvLang || "en").toLowerCase(),
    headline: isObj(p.title) ? clone(p.title) : {}, summary: isObj(p.summary) ? clone(p.summary) : {},
    roles, comps, technical: S(p.technical), education,
    langs: parseLangs(p.langs), langsRaw: S(p.langs), langsDirty: false,
    refs: isObj(p.refs) ? clone(p.refs) : {}, referee, answers: {}, dismissed: [],
  };
}

/**
 * The P-shaped fields the rest of the portal reads. Shapes are unchanged; roles carry
 * the builder extras (id, o, ...), which vDraft, cvText, analyse and fitOf ignore.
 * Unprinted competencies stay in the state and are not exported.
 */
export function toProfile(state) {
  const st = state;
  const out = {
    title: clone(st.headline) || {},
    summary: clone(st.summary) || {},
    experience: st.roles.map((r) => {
      const e = { ...clone(r.extra || {}), t: r.t, c: joinC(r), d: effD(r, st.lang), tags: [...r.tags] };
      /* An empty line is still being written: it stays in the builder, never reaches P. */
      e.bullets = r.bullets.filter((b) => S(b.x).trim()).map((b) => ({ ...clone(b.extra || {}), x: b.x, tags: [...b.tags] }));
      e.id = r.id; e.o = r.o;
      for (const k of ["p", "g", "from", "to", "note"]) if (r[k]) e[k] = r[k];
      if (r.now) e.now = true;
      if (r.earlier) e.earlier = true;
      return e;
    }),
    education: st.education.map((e) => {
      const x = { ...clone(e.extra || {}), b: e.b, s: [e.gloss, e.inst, e.date, e.grade, e.s].map(S).filter((v) => v.trim() !== "").join(" · ") };
      if (!e.gloss && !e.inst && !e.date && !e.grade) x.s = e.s;
      for (const k of ["gloss", "inst", "date", "grade"]) if (e[k]) x[k] = e[k];
      return x;
    }),
    competencies: st.comps.filter((c) => c.printed).map((c) => [c.n, c.tag]),
    langs: st.langsDirty ? langsLine(st.langs, st.lang) : st.langsRaw,
    refs: clone(st.refs) || {},
  };
  if (S(st.technical)) out.technical = st.technical;
  const R = st.referee || {};
  if (R.name || R.role || R.org || R.date || R.reachable || R.copy) out.referee = clone(R);
  return out;
}

/** P with the builder extras taken off each role, for comparing with an unbuilt P. */
export function stripBuilderKeys(p) {
  const out = clone(p);
  if (out && Array.isArray(out.experience)) for (const e of out.experience) for (const k of BUILDER_KEYS) delete e[k];
  return out;
}

/** A new P whose owned fields are deep copies of the built ones. A field the build
 *  does not carry (a cleared technical line) is removed, not left stale. */
export function applyOwned(P, p) {
  const out = Object.assign({}, P);
  for (const k of OWNED) { if (p && k in p) out[k] = clone(p[k]); else if (k === "technical" || k === "referee") delete out[k]; }
  return out;
}

/* ------------------------------------------------------------------ the store */

/** The structural fields of a source profile, hashed to notice a re-upload or a seed correction. */
export function sourceHash(profile) {
  const p = profile || {};
  return fnv1a(JSON.stringify([
    (p.experience || []).map((e) => [S(e && e.t), S(e && e.c), S(e && e.d), ((e && e.bullets) || []).filter((b) => !(isObj(b) && b.ach)).map((b) => S(isObj(b) ? b.x : b))]),
    (p.education || []).map((e) => [S(e && e.b), S(e && e.s)]),
  ]));
}

/** Whose CV a store is, so one candidate's built CV is never applied to another's. */
export function ownerStamp(sourceProfile, real, key) {
  const p = sourceProfile || {};
  return { real: !!real, key: S(key), who: fnv1a(lc(S(p.name).trim()) + "|" + lc(S(p.email).trim())) };
}

const str = (v) => S(v);
const strArr = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === "string") : []);
const strMap = (m) => { const o = {}; if (isObj(m)) for (const k of Object.keys(m)) if (typeof m[k] === "string") o[k] = m[k]; return o; };

/* A state rebuilt key by key from untrusted JSON: unknown keys dropped, types coerced.
   Nothing the candidate wrote is cut here: the caps hold where content is added
   (addRole, addBullet, splitBullet, moveBulletToRole, restoreLine, makeOwnLine,
   addComp), and content already over them (a parsed upload) is flagged by validate(). */
function normalise(raw) {
  if (!isObj(raw) || !Array.isArray(raw.roles)) return null;
  const roles = raw.roles.filter(isObj);
  const st = {
    v: 1, seq: Number.isInteger(raw.seq) ? raw.seq : 0, lang: str(raw.lang) || "en",
    headline: strMap(raw.headline), summary: strMap(raw.summary),
    roles: roles.map((r) => {
      const bl = (Array.isArray(r.bullets) ? r.bullets : []).filter(isObj);
      return {
        id: str(r.id) || "r" + fnv1a(JSON.stringify(r)), o: Number.isInteger(r.o) ? r.o : null,
        t: str(r.t), c: str(r.c), g: str(r.g), p: str(r.p), from: str(r.from), to: str(r.to), now: !!r.now, note: str(r.note),
        d: str(r.d), dDirty: !!r.dDirty, earlier: !!r.earlier, tags: strArr(r.tags), extra: isObj(r.extra) ? clone(r.extra) : {},
        bullets: bl.map((b) => {
          const x = str(b.x);
          const nb = { id: str(b.id) || "b" + fnv1a(x), x, tags: strArr(b.tags), ro: Number.isInteger(b.ro) ? b.ro : null, orig: str(b.orig), extra: isObj(b.extra) ? clone(b.extra) : {} };
          if (b.own) nb.own = true;
          if (b.doc) nb.doc = true;
          if (b.achCopy) nb.achCopy = true;
          if (isObj(b.src)) nb.src = { kind: str(b.src.kind), file: str(b.src.file), h: str(b.src.h) };
          if (isObj(b.moved)) nb.moved = { from: str(b.moved.from), confirmed: !!b.moved.confirmed };
          return nb;
        }),
      };
    }),
    comps: (Array.isArray(raw.comps) ? raw.comps : []).filter(isObj)
      .map((c) => ({ n: str(c.n), tag: str(c.tag), printed: c.printed !== false, prov: c.prov === "vocab" ? "vocab" : "own", confirmed: !!c.confirmed })),
    technical: str(raw.technical),
    education: (Array.isArray(raw.education) ? raw.education : []).filter(isObj).map((e) => ({ b: str(e.b), s: str(e.s), gloss: str(e.gloss), inst: str(e.inst), date: str(e.date), grade: str(e.grade), extra: isObj(e.extra) ? clone(e.extra) : {} })),
    langs: (Array.isArray(raw.langs) ? raw.langs : []).filter(isObj).map((l) => ({ name: str(l.name), code: typeof l.code === "string" ? l.code : null, level: LEVELS.includes(l.level) ? l.level : null, cefr: CEFR.test(str(l.cefr)) ? str(l.cefr).toUpperCase() : "", lvlRaw: str(l.lvlRaw), raw: str(l.raw) })),
    langsRaw: str(raw.langsRaw), langsDirty: !!raw.langsDirty,
    refs: strMap(raw.refs),
    referee: isObj(raw.referee) ? { name: str(raw.referee.name), role: str(raw.referee.role), org: str(raw.referee.org), date: str(raw.referee.date), reachable: !!raw.referee.reachable, copy: !!raw.referee.copy } : { name: "", role: "", org: "", date: "", reachable: false, copy: false },
    answers: strMap(raw.answers), dismissed: strArr(raw.dismissed),
  };
  return st;
}

/**
 * The persisted store (edits.cvb). The state is canonical; doc.p is its exported form,
 * kept so the page can apply it synchronously before the module has loaded.
 * Nothing is cut: the whole state is stored.
 */
export function serialize(state, { at = "", src = "", owner = null } = {}) {
  const st = normalise(state);
  const { answers, dismissed, ...doc } = st;
  return { v: 1, at: S(at), src: S(src), owner: owner ? { real: !!owner.real, key: S(owner.key), who: S(owner.who) } : null, doc: { state: doc, p: toProfile(st) }, answers, dismissed };
}

/* A store read back: the state, its exported P, and whether p had to be rebuilt. */
function readStore(store) {
  if (!isObj(store)) return { ok: false, reason: "no store" };
  if (store.v !== 1) return { ok: false, reason: "unknown store version " + S(store.v) };
  if (!isObj(store.doc) || !isObj(store.doc.state)) return { ok: false, reason: "store has no built CV" };
  const cut = [];
  const st = normalise({ ...store.doc.state, answers: store.answers, dismissed: store.dismissed });
  if (!st) return { ok: false, reason: "built CV is malformed" };
  const p = toProfile(st);
  const rebuilt = !!store.doc.p && JSON.stringify(sortKeys(p)) !== JSON.stringify(sortKeys(store.doc.p));
  return { ok: true, state: st, p, rebuilt, cut };
}
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : isObj(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);

/** The state in a store, or null when it is missing or malformed. Never throws. */
export function deserialize(store) {
  try { const r = readStore(store); return r.ok ? r.state : null; } catch { return null; }
}
/** Future store versions are migrated here; v1 is current. */
export function migrate(store) { return isObj(store) && store.v === 1 ? store : null; }

/**
 * A built CV applied to P. Refused when the store belongs to another profile; applied
 * (with stale=true) when only the source changed, so nothing typed is lost.
 * @returns {{P:object, applied:boolean, stale:boolean, rebuilt:boolean, dropped:string[]}}
 */
export function applyStore(P, store, ctx = {}) {
  const res = { P, applied: false, stale: false, rebuilt: false, dropped: [] };
  try {
    const r = readStore(migrate(store) || store);
    if (!r.ok) { res.dropped.push(r.reason); return res; }
    if (ctx.owner) {
      const o = store.owner;
      if (!o || o.real !== !!ctx.owner.real || o.who !== ctx.owner.who) { res.dropped.push("This built CV belongs to another profile"); return res; }
    }
    res.stale = !!ctx.srcHash && !!store.src && store.src !== ctx.srcHash;
    res.rebuilt = r.rebuilt;
    res.dropped.push(...r.cut);
    res.P = applyOwned(P, r.p);
    res.applied = true;
  } catch (e) { res.dropped.push("built CV could not be read: " + S(e && e.message)); }
  return res;
}

/**
 * The index-based edits.xp folded into a copy of P, exactly as the page's applyXp
 * applies them, so the builder can start from them and the page can clear them.
 */
export function foldXp(P, xp) {
  const out = clone(P || {});
  const folded = [], skipped = [];
  for (const k of Object.keys(xp || {})) {
    const v = xp[k], p = k.split(".");
    if (p[0] === "edu") {
      if (out.education && out.education[0] && (p[1] === "b" || p[1] === "s")) { out.education[0][p[1]] = v; folded.push(k); } else skipped.push(k);
      continue;
    }
    const e = (out.experience || [])[+p[0]];
    if (!e || !/^\d+$/.test(p[0])) { skipped.push(k); continue; }
    if (p[1] === "b") { if (e.bullets && e.bullets[+p[2]]) { e.bullets[+p[2]].x = v; folded.push(k); } else skipped.push(k); }
    else if (["t", "c", "d"].includes(p[1])) { e[p[1]] = v; folded.push(k); }
    else skipped.push(k);
  }
  return { P: out, folded, skipped };
}

/** An edits.prof key the built CV owns from creation on. */
export const ownedProfKey = (k) => /^(title|summary|refs)\./.test(k) || k === "langs" || k === "technical" || k === "title" || k === "summary";

/**
 * What the first "Start my master CV" does to the edits object, as data, so the page
 * applies it in one place and "Undo build" can put everything back: the previous
 * index-based edits go to cvbPrev (kind 'pre-build'), the Draft-sheet overrides of
 * name/email/phone/city move into edits.prof.
 */
export function creationPlan(edits) {
  const e = edits || {};
  const prof = {};
  for (const k of Object.keys(e.prof || {})) if (ownedProfKey(k)) prof[k] = e.prof[k];
  const top = {};
  for (const k of ["name", "email", "phone", "city"]) if (typeof e[k] === "string") top[k] = e[k];
  return {
    cvbPrev: { kind: "pre-build", xp: clone(e.xp) || null, comps: clone(e.comps) || null, prof, top },
    deleteProf: Object.keys(prof), deleteTop: Object.keys(top), foldToProf: top,
  };
}

/* ------------------------------------------------------------------ operations */

const ok = (state) => ({ state, error: null });
const fail = (state, error, msg, extra = {}) => ({ state, error, msg, ...extra });
const roleIx = (st, rid) => st.roles.findIndex((r) => r.id === rid);
const nextId = (st, prefix) => { st.seq = (st.seq || 0) + 1; return prefix + "n" + st.seq; };
const employerOf = (r) => joinC(r) || r.t || "another role";

/* Tags after an edit: kept while the text is unchanged, then what the new text shows.
   With no vocabulary to hand the old tags stay (nothing to judge them by). */
function retag(b, x, ctx) {
  if (x === b.x) return b.tags;
  const t = tagsFor(x, ctx);
  return t == null ? b.tags : t;
}

/**
 * Set one field by path. Header fields are refused: they go through the page's
 * setProf so there is one writer per field. The market, the step and the preview
 * language are view state, kept outside the built CV.
 */
export function setField(state, path, value, ctx = {}) {
  const st = clone(state);
  const P = S(path), v = value;
  let m;
  if (/^(hdr\.|market$)/.test(P)) return fail(state, "not-here", P.startsWith("hdr.") ? "Header fields are saved through the Profile writer (setProf)." : "The market is a preview setting, not part of your CV.");
  if ((m = P.match(/^(headline|summary|refs)\.([a-z]{2})$/))) { const key = m[1] === "headline" ? "headline" : m[1]; st[key][m[2]] = S(v); return ok(st); }
  if (P === "technical") { st.technical = S(v); return ok(st); }
  if ((m = P.match(/^referee\.(name|role|org|date|reachable|copy)$/))) { st.referee[m[1]] = m[1] === "reachable" || m[1] === "copy" ? v === true || v === "true" || v === "on" : S(v); return ok(st); }
  if ((m = P.match(/^answer:(.+)$/))) { st.answers[m[1]] = S(v); return ok(st); }
  if ((m = P.match(/^role:([^.]+)\.(t|c|g|p|from|to|now|note|earlier|d)$/))) {
    const i = roleIx(st, m[1]);
    if (i < 0) return fail(state, "no-role", "That role no longer exists.");
    const r = st.roles[i], k = m[2];
    if (k === "from" || k === "to") {
      const s = S(v).trim();
      if (s && !/^\d{4}(-(0[1-9]|1[0-2]))?$/.test(s)) return fail(state, "format", "Pick a month and a year.");
      r[k] = s;
    } else if (k === "now" || k === "earlier") r[k] = v === true || v === "true" || v === "on";
    else if (k === "d") {
      /* The raw dates string typed again: pickers re-read from it, nothing is reformatted. */
      r.d = S(v); r.dDirty = false;
      Object.assign(r, pickersOf(r.d));
      return ok(st);
    } else r[k] = S(v);
    if ((k === "from" || k === "to" || k === "now") && !r.dDirty) {
      r.dDirty = true;
      /* A note that lived in the raw string moves to the note field, so it still prints;
         a note the candidate already typed keeps its place and the raw one follows it. */
      const pd = parseDates(r.d), n = S(r.note).trim();
      /* A typed part the raw note already holds ("GTI" beside "alongside GTI") is not repeated. */
      if (pd.rest && !hasPhrase(n, pd.rest)) r.note = [...n.split(/\s*;\s*/).filter((p) => p && !hasPhrase(pd.rest, p)), pd.rest].join("; ");
    }
    return ok(st);
  }
  if ((m = P.match(/^bullet:([^:]+):(.+)$/))) {
    const i = roleIx(st, m[1]);
    const b = i < 0 ? null : st.roles[i].bullets.find((x) => x.id === m[2]);
    if (!b) return fail(state, "no-bullet", "That line no longer exists.");
    const x = S(v);
    b.tags = retag(b, x, ctx);
    b.x = x;
    return ok(st);
  }
  if ((m = P.match(/^edu:(\d+)\.(b|s|gloss|inst|date|grade)$/))) {
    const e = st.education[+m[1]];
    if (!e) return fail(state, "no-edu", "That entry no longer exists.");
    e[m[2]] = S(v);
    return ok(st);
  }
  return fail(state, "unknown-path", "Unknown field " + P);
}

/** A new, empty role. Every field stays empty until the candidate types it. */
export function addRole(state, at = 0) {
  if (state.roles.length >= CAPS.roles) return fail(state, "cap", `At most ${CAPS.roles} roles — older ones can print as one “Earlier career” line.`);
  const st = clone(state);
  const r = { id: nextId(st, "r"), o: null, t: "", c: "", g: "", p: "", from: "", to: "", now: false, note: "", d: "", dDirty: false, earlier: false, tags: [], extra: {}, bullets: [] };
  st.roles.splice(Math.max(0, Math.min(at, st.roles.length)), 0, r);
  return { ...ok(st), id: r.id };
}

/** Removing a role needs the candidate's confirmation; "Earlier career" is offered instead. */
export function removeRole(state, rid, { confirm = false } = {}) {
  const i = roleIx(state, rid);
  if (i < 0) return fail(state, "no-role", "That role no longer exists.");
  if (!confirm) return fail(state, "confirm", `Remove "${state.roles[i].t || "this role"}"? Older roles can print as a one-line "Earlier career" entry instead.`);
  const st = clone(state);
  st.roles.splice(i, 1);
  return ok(st);
}

export function moveRole(state, rid, delta) {
  const i = roleIx(state, rid), j = i + (delta | 0);
  if (i < 0) return fail(state, "no-role", "That role no longer exists.");
  if (j < 0 || j >= state.roles.length || j === i) return { ...ok(clone(state)), noop: true };
  const st = clone(state);
  const [r] = st.roles.splice(i, 1);
  st.roles.splice(j, 0, r);
  return ok(st);
}

/** Reverse-chronological: open roles first, then by end, then by start. Undated roles keep their order at the end. */
export function sortRolesByDate(state, now) {
  const st = clone(state);
  const key = (r) => { const s = spanOf(r, now); return s ? [s.open ? 1e9 : s.to == null ? s.from : s.to, s.from] : null; };
  const dated = st.roles.map((r, i) => ({ r, i, k: key(r) }));
  const withK = dated.filter((x) => x.k).sort((a, b) => b.k[0] - a.k[0] || b.k[1] - a.k[1] || a.i - b.i);
  st.roles = [...withK, ...dated.filter((x) => !x.k)].map((x) => x.r);
  return ok(st);
}

/** An empty line the candidate writes themselves (own:true). */
/* A role already holding CAPS.bullets lines takes no more; nothing is cut to make room. */
const fullRole = (state, i, what = "add a line") => state.roles[i].bullets.length >= CAPS.bullets
  ? fail(state, "cap", `${state.roles[i].t || "This role"} has ${state.roles[i].bullets.length} lines — ${CAPS.bullets} is the limit. Delete or merge one before you ${what}.`)
  : null;

export function addBullet(state, rid, at, text = "", ctx = {}) {
  const i = roleIx(state, rid);
  if (i < 0) return fail(state, "no-role", "That role no longer exists.");
  const full = fullRole(state, i);
  if (full) return full;
  const st = clone(state), r = st.roles[i];
  const x = S(text);
  const b = { id: nextId(st, r.id + "."), x, tags: tagsFor(x, ctx) || [], ro: null, orig: "", own: true, extra: {} };
  const pos = at == null ? r.bullets.length : Math.max(0, Math.min(at, r.bullets.length));
  r.bullets.splice(pos, 0, b);
  return { ...ok(st), id: b.id };
}

export function removeBullet(state, rid, bid) {
  const i = roleIx(state, rid);
  const k = i < 0 ? -1 : state.roles[i].bullets.findIndex((b) => b.id === bid);
  if (k < 0) return fail(state, "no-bullet", "That line no longer exists.");
  const st = clone(state);
  st.roles[i].bullets.splice(k, 1);
  return ok(st);
}

export function moveBullet(state, rid, bid, delta) {
  const i = roleIx(state, rid);
  const k = i < 0 ? -1 : state.roles[i].bullets.findIndex((b) => b.id === bid);
  if (k < 0) return fail(state, "no-bullet", "That line no longer exists.");
  const j = k + (delta | 0);
  if (j < 0 || j >= state.roles[i].bullets.length || j === k) return { ...ok(clone(state)), noop: true };
  const st = clone(state), bl = st.roles[i].bullets;
  const [b] = bl.splice(k, 1);
  bl.splice(j, 0, b);
  return ok(st);
}

/**
 * Moving a line to another role changes which employer the claim is made for, so it
 * needs the candidate's confirmation naming both, and stays flagged in step 8.
 */
export function moveBulletToRole(state, rid, bid, toRid, at, { confirm = false } = {}) {
  const i = roleIx(state, rid), j = roleIx(state, toRid);
  const k = i < 0 ? -1 : state.roles[i].bullets.findIndex((b) => b.id === bid);
  if (k < 0 || j < 0) return fail(state, "no-bullet", "That line or role no longer exists.");
  if (i === j) return { ...ok(clone(state)), noop: true };
  const full = fullRole(state, j, "move a line there");
  if (full) return full;
  const from = employerOf(state.roles[i]), to = employerOf(state.roles[j]);
  if (!confirm) return fail(state, "confirm", `Move this line from ${from} to ${to}? It will then read as work you did at ${to}.`);
  const st = clone(state);
  const [b] = st.roles[i].bullets.splice(k, 1);
  const target = st.roles[j];
  if (!b.own && !b.doc && b.ro !== target.o) b.moved = { from, confirmed: true };
  if (b.ro === target.o) delete b.moved;
  const pos = at == null ? target.bullets.length : Math.max(0, Math.min(at, target.bullets.length));
  target.bullets.splice(pos, 0, b);
  return ok(st);
}

/** Where "Split at ;" / sentence ends may cut a line: after "; " or ". ". */
export function splitPoints(text) {
  const out = [], t = S(text);
  const re = /[;.]\s+(?=\S)/g;
  let m;
  while ((m = re.exec(t))) out.push(m.index + m[0].length);
  return out;
}

/**
 * One line cut into two at `at`. Both halves are exact substrings; only the separator
 * ("; " or trailing whitespace) is dropped. Refused when a side would be empty.
 */
export function splitBullet(state, rid, bid, at, ctx = {}) {
  const i = roleIx(state, rid);
  const k = i < 0 ? -1 : state.roles[i].bullets.findIndex((b) => b.id === bid);
  if (k < 0) return fail(state, "no-bullet", "That line no longer exists.");
  const b = state.roles[i].bullets[k];
  if (b.ach) return fail(state, "ach", "This line is written from your figure answer; make it your own line first.");
  const n = Math.trunc(Number(at));
  if (!Number.isFinite(n)) return fail(state, "empty-side", "Split where both parts keep some text.");
  /* Never inside a word: "Bu" + "ilt" would be two words the candidate never wrote. */
  if (/[\p{L}\p{N}]/u.test(b.x[n - 1] || "") && /[\p{L}\p{N}]/u.test(b.x[n] || "")) return fail(state, "mid-word", "Split between two words.");
  const left = b.x.slice(0, n).trim().replace(/[;,]$/, "").trim(), right = b.x.slice(n).trim();
  if (!left || !right) return fail(state, "empty-side", "Split where both parts keep some text.");
  const full = fullRole(state, i, "split a line");
  if (full) return full;
  const st = clone(state), bl = st.roles[i].bullets, src = bl[k];
  const half = (x, id) => {
    const t = tagsFor(x, ctx);
    const nb = { ...clone(src), id, x, tags: t && t.length ? t : [...src.tags] };
    return nb;
  };
  bl.splice(k, 1, half(left, src.id), half(right, nextId(st, st.roles[i].id + ".")));
  return ok(st);
}

/**
 * A line joined with the next one: "a; b", keeping a's words and dropping only its
 * closing full stop. Tags are the union. Achievement lines are refused.
 */
export function mergeBullets(state, rid, bid) {
  const i = roleIx(state, rid);
  const k = i < 0 ? -1 : state.roles[i].bullets.findIndex((b) => b.id === bid);
  if (k < 0) return fail(state, "no-bullet", "That line no longer exists.");
  const bl0 = state.roles[i].bullets;
  if (k + 1 >= bl0.length) return fail(state, "no-next", "There is no line below this one to merge with.");
  if (bl0[k].ach || bl0[k + 1].ach) return fail(state, "ach", "Lines written from your figure answers cannot be merged.");
  if (achTemplate(bl0[k]) || achTemplate(bl0[k + 1])) return fail(state, "ach", "Rewrite the line made from your figure answer in your own words first.");
  const st = clone(state), r = st.roles[i], a = r.bullets[k], b = r.bullets[k + 1];
  const x = a.x.replace(/[\s.;]+$/, "") + "; " + b.x.trim();
  const merged = { ...a, x, tags: uniq([...a.tags, ...b.tags]), orig: [a.orig, b.orig].filter(Boolean).join("; "), ro: r.o, extra: { ...b.extra, ...a.extra } };
  if (!(a.own && b.own)) delete merged.own;
  if (a.moved || b.moved) merged.moved = a.moved || b.moved; else delete merged.moved;
  if (a.doc || b.doc) merged.doc = true;
  r.bullets.splice(k, 2, merged);
  return ok(st);
}

/** Lines from the source profile that are no longer on the CV, to restore verbatim. */
export function restoreCandidates(state, ctx = {}) {
  const src = ctx.source;
  if (!src || !Array.isArray(src.experience)) return [];
  const have = new Set(allBullets(state).flatMap(({ b }) => [norm(b.x), norm(b.orig)]).filter(Boolean));
  const out = [];
  src.experience.forEach((e, o) => (e.bullets || []).forEach((b) => {
    if (isObj(b) && b.ach) return;
    const x = S(isObj(b) ? b.x : b);
    if (x && !have.has(norm(x))) out.push({ kind: "cv", o, c: S(e.c), t: S(e.t), text: x });
  }));
  return out;
}

/**
 * A line put back verbatim. From the uploaded CV ({kind:'cv', o, text}) it must be a
 * line that is really there; put into a role other than its own it needs the
 * candidate's confirmation. From a document ({kind:'doc', file, text, letterLike})
 * it is labelled with its file, and a letter or posting needs an extra confirmation.
 */
export function restoreLine(state, rid, src, { confirm = false, ctx = {} } = {}) {
  const i = roleIx(state, rid);
  if (i < 0) return fail(state, "no-role", "That role no longer exists.");
  const s = src || {};
  const x = S(s.text).trim();
  if (!x) return fail(state, "empty", "Nothing to restore.");
  const target = state.roles[i];
  const full = fullRole(state, i);
  if (full) return full;
  let b;
  if (s.kind === "cv") {
    const P = ctx.source;
    const role = P && P.experience && P.experience[s.o];
    const there = role && (role.bullets || []).some((bb) => !(isObj(bb) && bb.ach) && norm(isObj(bb) ? bb.x : bb) === norm(x));
    if (!there) return fail(state, "not-found", "That line is not in your uploaded CV.");
    if (s.o !== target.o && !confirm) return fail(state, "confirm", `This line comes from ${S(role.c) || S(role.t)}. Put it under ${employerOf(target)}? It will then read as work you did there.`);
    b = { x, tags: tagsFor(x, ctx) || (role.bullets.find((bb) => norm(bb.x) === norm(x)) || {}).tags || [], ro: s.o, orig: x, src: { kind: "cv", file: "", h: fnv1a(norm(x)) }, extra: {} };
    if (s.o !== target.o) b.moved = { from: S(role.c) || S(role.t), confirmed: true };
  } else if (s.kind === "doc") {
    if (s.letterLike && !confirm) return fail(state, "confirm", `${S(s.file) || "This file"} looks like a letter or a posting. Only add lines that describe what you did, in your words.`);
    b = { x, tags: tagsFor(x, ctx) || [], ro: null, orig: x, doc: true, src: { kind: "doc", file: S(s.file), h: fnv1a(norm(x)) }, extra: {} };
  } else return fail(state, "bad-source", "Unknown source.");
  const st = clone(state);
  b.id = nextId(st, target.id + ".");
  st.roles[i].bullets.push(b);
  return { ...ok(st), id: b.id };
}

/**
 * "Make this my line": a filled achievement bullet copied into an own line the
 * candidate then edits. The page clears the edits.ach key it names.
 */
/* A "Make this my line" copy still in the template's words: a piece of it left by a
   split, or a line that still carries most of the template's own wording, judged by
   its word 3-grams with the figures left out, so one word added, one dropped or the
   clauses swapped is still the template. `orig` holds the template output it was made from. */
const wordsNoFig = (s) => norm(s).split(" ").filter((x) => x && !/\p{N}/u.test(x));
const grams3 = (w) => new Set(w.slice(2).map((_, i) => w.slice(i, i + 3).join(" ")));
const achTemplate = (b) => {
  const x = norm(b.x);
  if (!b.achCopy || !x) return false;
  if (norm(b.orig).includes(x)) return true;
  const tw = wordsNoFig(b.orig), lw = wordsNoFig(b.x);
  /* A template of fewer than three words has no 3-grams: its words are compared, and
     the line is the template while at least half of its words are the template's. */
  if (tw.length < 3) { const t = new Set(tw), l = new Set(lw); return t.size > 0 && [...l].filter((w) => t.has(w)).length * 2 >= l.size; }
  const tpl = grams3(tw), line = grams3(lw);
  const shared = [...tpl].filter((g) => line.has(g)).length;
  /* Most of the template kept, or a piece of it that is mostly the template's wording
     (a split half with a word added), judged against the piece itself. */
  return tpl.size > 0 && (shared * 2 > tpl.size || (line.size > 0 && shared * 2 > line.size));
};

export function makeOwnLine(state, rid, text, achKey) {
  const r = addBullet(state, rid, undefined, text);
  if (r.error) return r;
  /* Still the portal's wording until the candidate edits it: step 8 says so. */
  const b = r.state.roles[roleIx(r.state, rid)].bullets.find((x) => x.id === r.id);
  b.achCopy = true; b.orig = S(text);
  return { ...r, clearAch: S(achKey) };
}

export function addComp(state, name, tag, ctx = {}) {
  const n = S(name).trim();
  if (!n) return fail(state, "empty", "Type the skill as you would name it.");
  const st = clone(state);
  const t = S(tag).trim() || (tagsFor(n, ctx) || [])[0] || lc(n);
  if (st.comps.length >= CAPS.skills) return fail(state, "cap", `At most ${CAPS.skills} skills.`);
  st.comps.push({ n, tag: t, printed: true, prov: "own", confirmed: true });
  return ok(st);
}
export function removeComp(state, i) {
  if (!state.comps[i]) return fail(state, "no-comp", "That skill no longer exists.");
  const st = clone(state); st.comps.splice(i, 1); return ok(st);
}
export function moveComp(state, i, delta) { return moveIn(state, "comps", i, delta); }
export function setCompPrinted(state, i, on) {
  if (!state.comps[i]) return fail(state, "no-comp", "That skill no longer exists.");
  const st = clone(state); st.comps[i].printed = !!on; if (on) st.comps[i].confirmed = true; return ok(st);
}
/** A rename is the candidate's own word, so the skill counts as theirs from then on. */
export function renameComp(state, i, name) {
  if (!state.comps[i]) return fail(state, "no-comp", "That skill no longer exists.");
  const n = S(name).trim();
  if (!n) return fail(state, "empty", "A skill needs a name.");
  const st = clone(state); st.comps[i].n = n; st.comps[i].confirmed = true; return ok(st);
}
export function confirmComp(state, i) {
  if (!state.comps[i]) return fail(state, "no-comp", "That skill no longer exists.");
  const st = clone(state); st.comps[i].confirmed = true; return ok(st);
}
/** The explicit "hide skills no line proves" action; never run on its own. */
export function hideUnevidenced(state, ctx) {
  const st = clone(state);
  st.comps.forEach((c) => { if (c.printed && !evidenceFor(st, c, ctx).length) c.printed = false; });
  return ok(st);
}

function moveIn(state, key, i, delta) {
  const a = state[key], j = i + (delta | 0);
  if (!a || !a[i]) return fail(state, "no-item", "That entry no longer exists.");
  if (j < 0 || j >= a.length || j === i) return { ...ok(clone(state)), noop: true };
  const st = clone(state);
  const [x] = st[key].splice(i, 1);
  st[key].splice(j, 0, x);
  if (key === "langs") st.langsDirty = true;
  return ok(st);
}

export function addEdu(state, at) {
  const st = clone(state);
  const e = { b: "", s: "", gloss: "", inst: "", date: "", grade: "", extra: {} };
  st.education.splice(at == null ? st.education.length : Math.max(0, Math.min(at, st.education.length)), 0, e);
  return ok(st);
}
export function removeEdu(state, i) {
  if (!state.education[i]) return fail(state, "no-edu", "That entry no longer exists.");
  const st = clone(state); st.education.splice(i, 1); return ok(st);
}
export function moveEdu(state, i, delta) { return moveIn(state, "education", i, delta); }

export function addLang(state) {
  const st = clone(state);
  st.langs.push({ name: "", code: null, level: null, cefr: "", lvlRaw: "", raw: "" });
  st.langsDirty = true;
  return ok(st);
}
export function removeLang(state, i) {
  if (!state.langs[i]) return fail(state, "no-lang", "That language no longer exists.");
  const st = clone(state); st.langs.splice(i, 1); st.langsDirty = true; return ok(st);
}
export function moveLang(state, i, delta) { return moveIn(state, "langs", i, delta); }
/** A language's name (candidate text) and level (the fixed scale, or a CEFR level as written). */
export function setLang(state, i, { name, level } = {}) {
  if (!state.langs[i]) return fail(state, "no-lang", "That language no longer exists.");
  const st = clone(state), r = st.langs[i];
  if (name != null) { r.name = S(name).trim(); r.code = LANG_CODE[lc(r.name)] || null; }
  if (level != null) {
    const l = S(level).trim();
    if (LEVELS.includes(l)) { r.level = l; r.cefr = ""; }
    else if (CEFR.test(l)) { r.level = null; r.cefr = l.toUpperCase(); }
    else return fail(state, "level", "Choose a level from the list.");
    r.lvlRaw = "";
  }
  st.langsDirty = true;
  return ok(st);
}

export function dismiss(state, hintId) {
  const st = clone(state);
  if (!st.dismissed.includes(hintId)) st.dismissed.push(S(hintId));
  return ok(st);
}

/* ------------------------------------------------------------------ hints */

/* German text, or a German noun-style Stichpunkt ("Leitung von …", "Aufbau der …"),
   which opens on a noun by convention and is never told to open with a verb. */
const DE_NOUN_OPENER = /^\p{Lu}\p{L}*(?:ung|heit|keit|schaft|tion|bau|aufbau|ausbau)\s+(?:von|der|des|die|das|mit|für|eines|einer|im|am|zum|zur)\b/u;
const detectDe = (t) => (S(t).match(/\b(und|der|die|das|für|von|mit|des|im|zur|zum)\b/gi) || []).length >= 2 || /[äöüß]/i.test(S(t)) || DE_NOUN_OPENER.test(S(t).trim());

/**
 * Rule hints on one line. They warn; they never rewrite. `origin` is the text the line
 * came from, so a qualifier the candidate wrote themselves is said to be theirs.
 */
export function bulletHints(text, { origin = "", lang = "" } = {}) {
  const x = S(text).trim(), out = [];
  if (!x) return out;
  const de = lang === "de" || detectDe(x);
  const first = lc(x).replace(/^[^\p{L}]+/u, "").split(/\s+/)[0] || "";
  if (WEAK_OPENERS.some((re) => re.test(x))) out.push({ kind: "verb", msg: "Opens with the job description. A stronger verb is your call: “participated” does not become “led”." });
  else if (!de && !STRONG_VERB.test(first) && !/^[a-z]+s$/i.test(first)) out.push({ kind: "verb", msg: "Does not open with a verb. Start with what you did, in your own words." });
  if (x.length > 180) out.push({ kind: "length", msg: `${x.length} characters — about two printed lines is the limit (180).` });
  for (const q of QUALIFIERS) {
    if (wordRe(q).test(x)) {
      const theirs = !!origin && wordRe(q).test(origin);
      out.push({ kind: "qualifier", word: q, msg: theirs ? `“${q}” is in your original — keep it only if you can back it up.` : `“${q}” — keep only if your own CV says so.` });
    }
  }
  const low = " " + lc(x) + " ";
  const buzz = BUZZWORDS.filter((w) => low.includes(" " + w + " ") || low.includes(" " + w + ",") || low.includes(" " + w + "."));
  if (buzz.length) out.push({ kind: "buzz", msg: `A claim nobody can check: ${buzz.join(", ")}.` });
  if (PRONOUN.test(x)) out.push({ kind: "pronoun", msg: "A CV leaves out “I” and “my”." });
  if (!hasFigure(x)) out.push({ kind: "figure", msg: "No figure. If your record has one, what number sizes this — team, budget, sites, contracts, revenue? A figure is optional; none is added for you." });
  return out;
}

/** The candidate's own strings a headline can be built from. Only their words. */
export function headlineChips(state, ctx = {}) {
  const titles = uniq(state.roles.map((r) => S(r.t).trim()).filter(Boolean));
  const fields = uniq(state.comps.filter((c) => c.printed && compOwned(c) && !isLangComp(c) && evidenceFor(state, c, ctx).length).map((c) => c.n));
  const city = ctx.header && S(ctx.header.city).trim();
  const places = uniq([...state.roles.map((r) => S(r.p).trim()), city].filter(Boolean));
  return { titles, fields, places };
}

/** A chip inserted at the caret, with the separator the field already uses. */
export function chipInsert(text, chip, at) {
  const t = S(text), c = S(chip);
  const sep = t.includes(" · ") ? " · " : t.includes(" | ") ? " | " : " | ";
  const n = at == null ? t.length : Math.max(0, Math.min(at, t.length));
  const before = t.slice(0, n).replace(/[\s|·]+$/, ""), after = t.slice(n).replace(/^[\s|·]+/, "");
  const out = [before, c, after].filter(Boolean).join(sep);
  return { text: out, caret: (before ? before.length + sep.length : 0) + c.length };
}

const wordsOf = (s) => S(s).split(/[^\p{L}\p{N}&'-]+/u).map((w) => lc(w).replace(/^['-]+|['-]+$/g, "")).filter(Boolean);
const agencyOrConfidential = (co) => /\b(confidential|undisclosed|anonymous|recruit|recruitment|staffing|headhunt|talent|executive search|personnel|hays|michael page|robert walters|adecco|randstad|manpower)\b/i.test(S(co));

/* Words the candidate has written about themselves, for the "unsourced term" test. */
function ownWords(state, ctx) {
  const src = ctx.source || {};
  const texts = [
    ...state.roles.flatMap((r) => [r.t, r.p, ...r.bullets.map((b) => b.x)]),
    ...state.comps.filter(compOwned).map((c) => c.n),
    ...Object.values(isObj(src.title) ? src.title : {}),
    ctx.header && ctx.header.city,
  ];
  return new Set(texts.flatMap(wordsOf));
}

/* The listings' role titles that would claim a posting's job: whole phrases of two
   or more words, skipping any phrase inside the candidate's own titles or headline. */
function postingRoleIn(text, state, ctx) {
  const own = [...state.roles.map((r) => r.t), ...state.roles.map((r) => r.c), ...Object.values((ctx.source && ctx.source.title) || {})].map(norm).join(" | ");
  if (ctx.targetRole && hasPhrase(text, ctx.targetRole) && !own.includes(norm(ctx.targetRole))) return { phrase: ctx.targetRole, exact: true };
  for (const j of ctx.jobs || []) {
    const r = S(j && j.r).trim();
    if (!r || norm(r).split(" ").length < 2 || own.includes(norm(r))) continue;
    if (hasPhrase(text, r)) return { phrase: r, exact: false };
  }
  return null;
}

/** What a headline claims that the candidate's record does not show. */
export function headlineCheck(text, state, ctx = {}) {
  const t = S(text);
  const have = ownWords(state, ctx);
  const unsourced = uniq(wordsOf(t).filter((w) => w.replace(/[^\p{L}]/gu, "").length >= 3 && !STOP.has(w) && !have.has(w)));
  const pr = postingRoleIn(t, state, ctx);
  const low = " " + lc(t) + " ";
  const banned = BANNED.filter((w) => wordRe(w).test(low));
  return { unsourced, postingRole: pr ? pr.phrase : null, postingExact: !!(pr && pr.exact), long: t.length > 90, banned };
}

/** Words and sentences, for the summary counters. */
export function summaryStats(text) {
  const t = S(text).trim();
  if (!t) return { words: 0, sentences: 0 };
  const words = t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  const sentences = t.split(/(?<=[.!?])\s+(?=[\p{Lu}\p{N}])/u).filter((s) => /[\p{L}\p{N}]/u.test(s)).length;
  return { words, sentences };
}

/* A native language called fluent: the level word before a list of languages ("fluent
   in English and Arabic", "courant en arabe") or after one ("Arabic (fluent)",
   "Arabisch und Englisch verhandlungssicher"), in either word order, when the list
   names a native language. Returns that row's name, code and the words that said it. */
const FLUENT_WORD = "(?:fluent|fluently|business fluent|verhandlungssicher(?:e|en|er|es)?|flie(?:ß|ss)end(?:e|en|er|es)?|courant|courants|courante|couramment|fluido|fluidos|fluida|fluidas|con fluidez)";
const LIST_SEP = "(?:\\s*[,/&]\\s*|\\s+(?:and|und|sowie|et|y|e|or|oder)\\s+)";
/* Before a later name, a preposition or article ("et en allemand", "l'allemand"); after
   one, the German compound ("Englisch- und Deutschkenntnisse"). */
const LANG_LEAD = "(?:(?:in|auf|en)\\s+)?(?:l['’]\\s*|el\\s+)?";
/* A name ends a word: "Deutschkenntnisse" and "Englisch- und …" are the language, but
   a hyphen and a word after it ("German-speaking markets", "German-owned") are not, nor
   is a name joined by "/" or "&" to one ("German/English-speaking"). A name followed by
   its own native level ("… / German native") is not in the list. */
const NATIVE_WORD = "(?:native|natively|mother tongue|first language|muttersprach\\p{L}*|langue maternelle|lengua materna|nativ[oa]|لغة أم)";
const LANG_TAIL = "(?:kenntnissen?|-kenntnissen?|-(?![\\p{L}]))?(?![\\p{L}]|-\\p{L}|\\s*[/&]\\s*\\p{L}+-\\p{L})(?!\\s*[(:–-]?\\s*" + NATIVE_WORD + "(?![\\p{L}]))";
const LIST_FILLER = new Set(["and", "und", "sowie", "et", "y", "e", "or", "oder", "in", "auf", "en", "l", "el"]);
/* The clauses a level word reaches: the text cut at sentence marks and commas, except
   that a comma piece naming only languages ("English, Arabic and German fluent") joins
   its neighbour. Two pieces that each carry their own words ("Fluent English, German
   mother tongue") never share a level word. [start, end) offsets into the text. */
function langClauses(text, nameWords) {
  const t = S(text), out = [];
  const bare = (s) => lc(s).split(/[^\p{L}]+/u).filter(Boolean).every((w) => nameWords.has(w) || LIST_FILLER.has(w) || nameWords.has(w.replace(/kenntnissen?$/u, "")));
  let cur = null, start = 0;
  for (let i = 0; i <= t.length; i++) {
    if (i < t.length && !/[,;.!?\n]/.test(t[i])) continue;
    const own = !bare(t.slice(start, i));
    if (cur && t[start - 1] === "," && !(cur.own && own)) { cur.end = i; cur.own = cur.own || own; }
    else { cur = { start, end: i, own }; out.push(cur); }
    start = i + 1;
  }
  return out;
}
function nativeCalledFluent(text, state) {
  const t = S(text);
  /* German first: when one phrase names it beside another native language, the must-fix wins. */
  const natives = state.langs.filter((r) => r.level === "native").sort((a, b) => (b.code === "de") - (a.code === "de"));
  if (!natives.length) return null;
  const all = uniq([...state.langs.map((r) => lc(r.name)), ...Object.values(LANG_NAMES).flatMap((x) => Object.values(x).map(lc))].filter(Boolean));
  const names = "(?:" + [...all].sort((a, b) => b.length - a.length).map(escRe).join("|") + ")" + LANG_TAIL;
  const list = names + "(?:" + LIST_SEP + LANG_LEAD + names + ")*";
  const res = [
    /* "Fluent in English", and "Fluent: German and English" with the level word as a label. */
    new RegExp("(?:^|[^\\p{L}])(" + FLUENT_WORD + "(?:\\s*:\\s*|\\s+)" + LANG_LEAD + "(" + list + "))(?=[^\\p{L}]|$)", "giu"),
    new RegExp("(?:^|[^\\p{L}])((" + list + ")[\\s(:–-]*" + FLUENT_WORD + ")(?=[^\\p{L}]|$)", "giu"),
  ];
  const hits = langClauses(t, new Set(all.flatMap((n) => n.split(/[^\p{L}]+/u)))).flatMap((c) =>
    res.flatMap((re) => [...t.slice(c.start, c.end).matchAll(re)].map((m) => ({ m, at: c.start + m.index + m[0].length - m[1].length }))));
  for (const row of natives) for (const { m, at } of hits) {
    const said = lc(m[2]).replace(/kenntnissen?(?=[^\p{L}]|$)/gu, "");
    if (!langNamesFor(row).some((n) => new RegExp("(?:^|[^\\p{L}])" + escRe(n) + "(?:[^\\p{L}]|$)", "u").test(said))) continue;
    /* The candidate's words verbatim, the bracket closed when the level word sat in one. */
    let end = at + m[1].length;
    if ((m[1].match(/\(/g) || []).length > (m[1].match(/\)/g) || []).length) { const c = t.slice(end).match(/^\s*\)/); if (c) end += c[0].length; }
    return { name: row.name || langNamesFor(row)[0], code: row.code, said: t.slice(at, end) };
  }
  return null;
}

/* Numbers in a headline or summary that no line of the record carries. */
function untracedNumbers(text, state, years) {
  const record = [...state.roles.flatMap((r) => [r.t, r.c, r.d, ...r.bullets.map((b) => b.x)]), ...state.education.flatMap((e) => [e.b, e.s])].join(" ");
  const nums = uniq((S(text).match(/\d[\d.,]*/g) || []).map((n) => n.replace(/[.,]$/, "")));
  return nums.filter((n) => !/^(19|20)\d{2}$/.test(n) && !new RegExp("(?:^|[^\\d])" + n.replace(/[.]/g, "\\.") + "(?:[^\\d]|$)").test(record) && +n !== years && !(years && +n <= years && new RegExp("(more than|over|über|mehr als|plus de|más de)\\s+" + n).test(lc(text))));
}

/** The summary's checks, as items for step 3. */
export function summaryCheck(text, state, ctx = {}, code = "en") {
  const t = S(text), out = [];
  const add = (kind, id, msg) => out.push({ kind, id: "summary." + code + "." + id, step: "summary", path: "summary." + code, msg, fix: "jump" });
  if (!t.trim()) return out;
  const st = summaryStats(t);
  if (st.words < 60 || st.words > 90) add("warning", "words", `${st.words} words — the writer's range is 60–90.`);
  if (st.sentences < 3 || st.sentences > 4) add("warning", "sentences", `${st.sentences} sentence${st.sentences === 1 ? "" : "s"} — 3 or 4 read best.`);
  const low = " " + lc(t) + " ";
  const banned = BANNED.filter((w) => wordRe(w).test(low));
  if (banned.length) add("warning", "banned", `Words that claim without showing: ${banned.join(", ")}.`);
  if (/\bfocus for\b/i.test(t)) add("error", "focus", "“Focus for …” belongs in a letter, not in your master CV.");
  const own = state.roles.map((r) => norm(r.c)).join(" | ");
  for (const j of ctx.jobs || []) {
    const co = S(j && j.co).trim();
    if (!co || agencyOrConfidential(co) || own.includes(norm(co)) || norm(co).length < 3) continue;
    if (hasPhrase(t, co)) { add("warning", "employer", `Names ${co}, an employer from your listings — your master CV names no target.`); break; }
  }
  const pr = postingRoleIn(t, state, ctx);
  if (pr) add(pr.exact ? "error" : "warning", "role", `“${pr.phrase}” is a posting's title you have not held.`);
  const nat = nativeCalledFluent(t, state);
  /* German called fluent is the owner's standing rule, so it blocks; another native
     language is the candidate's call, asked with both lines named. */
  if (nat && nat.code === "de") add("error", "native", `${nat.name} is your native language — never “fluent” or “verhandlungssicher”. This summary says “${nat.said}”.`);
  else if (nat) add("warning", "native", `This summary says “${nat.said}”, while your languages line says ${nat.name} is native. Which is right? Nothing is changed for you.`);
  const years = careerYears(state, ctx.now);
  const m = lc(t).match(/(?:(more than|over|über|mehr als)\s+)?(\d{1,2})\+?\s*(years|jahre|jahren|ans|años)/);
  if (m && years && +m[2] > years) add("warning", "years", `Says ${m[2]} years; your dates show ${years}.`);
  const nums = untracedNumbers(t, state, years);
  if (nums.length) add("warning", "trace", `${nums.join(", ")} — check each against a line of your experience; none carries it.`);
  if (t.length >= 590 && !/[.!?)]\s*$/.test(t)) add("warning", "cut", "This looks cut off — check it against your CV.");
  return out;
}

/* ------------------------------------------------------------------ timeline */

/** Roles that ended more than `years` ago and could print as one line. Only offered. */
export function earlierCandidates(state, ctx = {}, years = 15) {
  const now = ctx.now;
  if (!now) return [];
  const cut = now.getFullYear() * 12 + now.getMonth() - years * 12;
  return state.roles.filter((r) => !r.earlier).filter((r) => { const s = spanOf(r, now); return s && !s.open && s.to != null && s.to < cut; }).map((r) => r.id);
}

/** Gaps of more than six months between roles, shown neutrally with no explanation offered. */
export function gaps(state, now) {
  const sp = state.roles.map((r) => ({ r, s: spanOf(r, now) })).filter((x) => x.s && x.s.to != null).sort((a, b) => a.s.from - b.s.from);
  const out = [];
  let end = null, last = null;
  for (const x of sp) {
    if (end != null) {
      const months = x.s.from - end - 1;
      const limit = x.s.coarse || last.s.coarse ? 12 : 6;
      if (months > limit) out.push({ afterRid: last.r.id, beforeRid: x.r.id, months });
    }
    if (end == null || x.s.to > end) { end = x.s.to; last = x; }
  }
  return out;
}

const hasNote = (r) => !!S(r.note).trim() || !!parseDates(r.d).rest;
/** Pairs of roles held at the same time without a note saying so. */
export function overlaps(state, now) {
  const sp = state.roles.map((r) => ({ r, s: spanOf(r, now) })).filter((x) => x.s && x.s.to != null);
  const out = [];
  for (let i = 0; i < sp.length; i++) for (let j = i + 1; j < sp.length; j++) {
    const a = sp[i], b = sp[j];
    const ov = Math.min(a.s.to, b.s.to) - Math.max(a.s.from, b.s.from);
    const tol = a.s.coarse || b.s.coarse ? 12 : 1;
    if (ov > tol && !hasNote(a.r) && !hasNote(b.r)) out.push([a.r.id, b.r.id]);
  }
  return out;
}

/* ------------------------------------------------------------------ validation */

const item = (step, id, path, msg, extra = {}) => ({ id, step, path, msg, fix: "jump", ...extra });
const empty = () => ({ errors: [], warnings: [], questions: [], info: [] });
const docCodes = (ctx) => uniq((ctx.docLangs && ctx.docLangs.length ? ctx.docLangs : ["EN"]).map((c) => lc(c)));
const langName = (code) => LANG_NAMES.en[code] || S(code).toUpperCase();

/* Spans of a text that are a place or one of the candidate's employers, so "Saudi
   Arabia" or "Deutsche Bank" is never read as a nationality (CV Review masks them too). */
const PLACE_G = new RegExp(PLACE.source, "gi");
function maskFor(t, employers) {
  const out = [...t.matchAll(PLACE_G)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
  const low = lc(t);
  for (const n of employers) for (let i = low.indexOf(lc(n)); n && i >= 0; i = low.indexOf(lc(n), i + 1)) out.push({ start: i, end: i + n.length });
  return out;
}
/* The employers and places a profile's own lines name. */
const employersOf = (state) => (state ? uniq(state.roles.flatMap((r) => [S(r.c).trim(), S(r.g).trim()]).filter((x) => x.length > 2)) : []);
/* An address or a link is an identifier: "german.lopez@…", "dob.smith@…", "…/in/max-born". */
const ID_TOKEN = /[^\s,;|·]*[@/][^\s,;|·]*|[^\s,;|·]+\.[^\s,;|·]+/g;

/**
 * Every printed personal detail in one field: [{what, kind, text, index, label, dismissable}].
 * `zone` "header" for a header field or the headline, "text" for running text; `key` the
 * header field. A name, an address or a link is the candidate's own identifier
 * ("Christian Weber", "Ahmed Al Kuwaiti"), so only labels and birth or age statements
 * count there. A city skips bare religion and gender words ("Christchurch", "Male,
 * Maldives"); the availability line skips a bare date (it is the start date).
 */
function personalFinds(text, { zone = "text", key = "", nationality = "", employers = [] } = {}) {
  let t = S(text);
  if (!t.trim()) return [];
  const own = key === "name" || key === "email" || key === "links";
  if (key === "email" || key === "links") t = t.replace(ID_TOKEN, (m) => "_".repeat(m.length));
  const out = findPersonalData(t, { zone, workRights: key === "workRights", nationality, mask: maskFor(t, employers), employers })
    .filter((h) => h.label || !((own && !["dob", "age", "birthplace"].includes(h.kind)) || (key === "city" && h.kind === "religion") || (key === "availability" && h.kind === "date")))
    .map((h) => ({ ...h, what: PD_WHAT[h.kind] }));
  for (const [re, what, scope] of PERSONAL) {
    if ((own && scope) || (scope === "hdr" && (zone !== "header" || (key === "city" && what === "gender")))) continue;
    const m = re.exec(t);
    if (m) out.push({ kind: "other", what, text: m[0], index: m.index, label: !scope, dismissable: !!scope });
  }
  return out;
}
/* The key a dismissed finding is stored under: the field, the kind and the field's
   exact text, so an edit to the field asks again. */
const pdHint = (path, v, h) => "pd." + path + "." + h.kind + "." + fnv1a(S(v) + "|" + h.index + "|" + h.text);

/** Whether a header or CV value names a protected characteristic; returns what it names. */
export function personalHit(text, { header = false, labelled = false } = {}) {
  return (personalFinds(text, { zone: header ? "header" : "text", key: labelled ? "name" : "" })[0] || {}).what || null;
}

/** Every protected characteristic a value names, each once, so one field carrying a
 *  whole personal-details block ("Born … Married … Nationality: …") reports them all. */
export function personalHits(text, { header = false } = {}) {
  return uniq(personalFinds(text, { zone: header ? "header" : "text" }).map((h) => h.what));
}

/**
 * A header value checked before it is saved. `blocked` values are quarantined by the
 * page (edits.prof['blocked.<key>']) and never reach P or the preview. A finding that
 * may be a false positive (a demonym, a bare date) carries `hint` and `ack`: once the
 * candidate dismisses it (state.dismissed holds the hint), the value is no longer blocked.
 * A label ("Nationality:", "DOB") is never dismissable.
 */
export function headerGuard(key, value, { dismissed = [], nationality = "", employers = [] } = {}) {
  /* Trimmed, as the header prints it, so a dismissal holds however the value was saved. */
  const v = S(value).trim();
  if (key === "nationality") return { ok: true, stored: true, msg: "Stored, never printed." };
  const d = new Set(dismissed || []);
  const open = personalFinds(v, { zone: "header", key, nationality, employers }).filter((h) => !d.has(pdHint("hdr." + key, v, h)));
  const h = open.find((x) => !x.dismissable) || open[0];
  if (h) {
    const msg = h.kind === "nationality" ? `This stays off your CV (nationality: “${h.text}”). Write your work rights instead, e.g. “EU passport · UAE residence visa”.` : `This stays off your CV (${h.what}: “${h.text}”).`;
    const out = { ok: false, blocked: true, what: h.what, kind: h.kind, text: h.text, msg };
    return h.dismissable ? { ...out, dismissable: true, hint: pdHint("hdr." + key, v, h), ack: PD_ACK[h.kind] } : out;
  }
  if (key === "workRights" && demonymUses(v, { nationality }).some((x) => x.use === "workRights"))
    return { ok: true, warn: true, msg: "Names a nationality through your passport. Keep it only if you want employers to see it." };
  return { ok: true };
}
/* The guard with what the state and context know: dismissals, the stored nationality, the employers. */
export const guardOf = (state, ctx) => (key, value) => headerGuard(key, value, { dismissed: state.dismissed, nationality: S(ctx.header && ctx.header.nationality), employers: employersOf(state) });

function vHeader(state, ctx, out) {
  const h = ctx.header;
  if (!h) return;
  const add = (b, id, key, msg) => out[b].push(item("header", "hdr." + id, "hdr." + key, msg));
  if (!S(h.name).trim()) add("errors", "name", "name", "Your name is missing.");
  if (!S(h.phone).trim() && !S(h.email).trim()) add("errors", "contact", "email", "Add a phone number or an email address.");
  if (S(h.email).trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(S(h.email).trim())) add("errors", "email", "email", "This email address does not look complete.");
  if (S(h.phone).trim() && !/\d/.test(h.phone)) add("errors", "phone", "phone", "The phone number has no digits.");
  if (ctx.market === "gcc" && S(h.phone).trim() && !/^\s*(\+|00)/.test(h.phone)) add("warnings", "intl", "phone", "GCC employers expect the international form, e.g. +971 …");
  if (!S(h.city).trim()) add("warnings", "city", "city", "Add the city you work from.");
  else if (!/,/.test(h.city)) out.info.push(item("header", "hdr.country", "hdr.city", "“City, Country” reads best for an employer abroad."));
  const guard = guardOf(state, ctx);
  for (const k of ["name", "city", "phone", "email", "workRights", "availability"]) {
    const g = guard(k, h[k]);
    if (g.blocked) out.errors.push(item("header", "hdr.personal." + k, "hdr." + k, g.msg, { kind: g.kind, quote: g.text, label: !g.dismissable, ...(g.dismissable ? { dismissable: true, hint: g.hint, ack: g.ack } : {}) }));
    else if (g.warn && !state.dismissed.includes("hdr.nat")) add("warnings", "nat", k, g.msg);
  }
  for (const [i, l] of (Array.isArray(h.links) ? h.links : [h.links]).filter(Boolean).entries())
    if (!/^(https?:\/\/)?[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(S(l).trim())) add("warnings", "link" + i, "links", `“${l}” does not look like a web address.`);
  if (ctx.real && S(h.nationality).trim()) out.info.push(item("header", "hdr.nationality", "hdr.nationality", "Your nationality is stored, never printed."));
}

function vHeadline(state, ctx, out) {
  const codes = docCodes(ctx), main = state.lang;
  for (const code of uniq([main, ...codes])) {
    const v = S(state.headline[code]).trim();
    const path = "headline." + code;
    if (code === main && !v) { out.errors.push(item("headline", "headline.missing", path, `Your ${langName(code)} headline is empty — the CV would print your latest title instead.`)); continue; }
    if (code !== main && (!v || v === S(state.headline[main]).trim())) { out.info.push(item("headline", "headline.write." + code, path, `Write your ${langName(code)} headline yourself — nothing is translated.`)); continue; }
    const c = headlineCheck(v, state, ctx);
    if (c.long) out.warnings.push(item("headline", "headline.long." + code, path, `${v.length} characters — about 90 is the limit.`));
    if (c.banned.length) out.warnings.push(item("headline", "headline.banned." + code, path, `No adjectives: ${c.banned.join(", ")}.`));
    if (c.unsourced.length) out.warnings.push(item("headline", "headline.unsourced." + code, path, `Not found in your titles, skills, places or lines: ${c.unsourced.join(", ")}.`));
    if (c.postingRole) out[c.postingExact ? "errors" : "warnings"].push(item("headline", "headline.posting." + code, path, `“${c.postingRole}” is a posting's title you have not held — name the role in the letter instead.`));
    /* German called fluent is the owner's standing rule here as in the summary. */
    const nat = nativeCalledFluent(v, state);
    if (nat && nat.code === "de") out.errors.push(item("headline", "headline.native." + code, path, `${nat.name} is your native language — never “fluent” or “verhandlungssicher”. This headline says “${nat.said}”.`));
  }
}

function vSummary(state, ctx, out) {
  const codes = uniq([state.lang, ...docCodes(ctx)]);
  for (const code of codes) {
    const t = S(state.summary[code]);
    if (!t.trim()) { out.warnings.push(item("summary", "summary.empty." + code, "summary." + code, `No ${langName(code)} summary — nothing is translated for you.`)); continue; }
    for (const it of summaryCheck(t, state, ctx, code)) out[it.kind === "error" ? "errors" : "warnings"].push(item("summary", it.id, it.path, it.msg));
  }
  const n = +ctx.sumOverrides || 0;
  if (n) out.info.push(item("summary", "summary.overrides", "summary." + state.lang, `${n} application draft${n === 1 ? " keeps its" : "s keep their"} own summary edit and override this one.`));
}

/* Bullet caps from the writer: the latest role 4-6, the next two 2-4, older ones 1-2. */
function capsByRole(state, now) {
  const order = sortRolesByDate({ ...state, roles: state.roles.filter((r) => !r.earlier) }, now).state.roles.map((r) => r.id);
  const caps = {};
  order.forEach((id, i) => { caps[id] = i === 0 ? [4, 6] : i <= 2 ? [2, 4] : [1, 2]; });
  return caps;
}

function vExperience(state, ctx, out) {
  const now = ctx.now;
  const caps = capsByRole(state, now);
  const qs = [];
  state.roles.forEach((r, i) => {
    const p = "role:" + r.id;
    const name = r.t || r.c || `Role ${i + 1}`;
    if (!S(r.t).trim()) out.errors.push(item("experience", p + ".t.missing", p + ".t", `Role ${i + 1}: the job title is missing.`));
    if (!S(r.c).trim()) out.errors.push(item("experience", p + ".c.missing", p + ".c", `${name}: the employer is missing.`));
    if (!S(r.d).trim() && !r.from) out.errors.push(item("experience", p + ".d.missing", p + ".from", `${name}: the start date is missing.`));
    if (r.dDirty) {
      if (!r.from) out.errors.push(item("experience", p + ".from.missing", p + ".from", `${name}: pick the start month and year.`));
      if (!r.to && !r.now && unreadEnd(r.d)) out.info.push(item("experience", p + ".to.raw", p + ".to", `${name}: the end prints as you wrote it (“${unreadEnd(r.d)}”) — pick it to format it.`));
      else if (!r.to && !r.now) out.errors.push(item("experience", p + ".to.missing", p + ".to", `${name}: pick the end date or tick Present.`));
    } else if (S(r.d).trim() && !datesReadable(r.d)) out.info.push(item("experience", p + ".d.raw", p + ".from", `${name}: “${r.d}” prints as you wrote it — set the dates with the pickers to format them.`));
    const s = spanOf(r, now);
    if (s && s.to != null && s.to < s.from) out.errors.push(item("experience", p + ".order", p + ".to", `${name}: the end date is before the start date.`));
    const n = r.bullets.length;
    const cap = caps[r.id];
    if (cap && !r.earlier && (n < cap[0] || n > cap[1])) out.warnings.push(item("experience", p + ".count", p, `${name}: ${n} line${n === 1 ? "" : "s"} — ${cap[0]}–${cap[1]} suit this role's place in your record.`));
    const noFig = r.bullets.filter((b) => !hasFigure(b.x) && S(b.x).trim());
    if (noFig.length) qs.push(item("experience", "q.fig." + r.id, p, `${name}: optional — if you have one, what number sizes this role (team, budget, sites, contracts, revenue)?`, { qid: "fig." + r.id, lines: noFig.map((b) => b.x), answer: S(state.answers["fig." + r.id]) }));
    r.bullets.forEach((b) => { if (!S(b.x).trim()) out.errors.push(item("experience", p + ".b." + b.id + ".empty", "bullet:" + r.id + ":" + b.id, `${name}: an empty line — write it or delete it.`)); });
    /* Over the caps (a parsed upload can be): flagged, never cut. */
    if (n > CAPS.bullets) out.warnings.push(item("experience", p + ".cap", p, `${name}: ${n} lines — ${CAPS.bullets} is the most a role holds. Delete or merge some; nothing is cut for you.`));
    r.bullets.forEach((b) => { const len = S(b.x).length; if (len > CAPS.bulletChars) out.warnings.push(item("experience", p + ".b." + b.id + ".long", "bullet:" + r.id + ":" + b.id, `${name}: a line of ${len} characters — ${CAPS.bulletChars} is the limit. Split it where a sentence ends.`)); });
  });
  for (const g of gaps(state, now)) {
    const id = "gap." + g.afterRid + "." + g.beforeRid;
    if (!state.dismissed.includes(id)) out.info.push(item("experience", id, "role:" + g.beforeRid, `${g.months} months between two roles.`));
  }
  for (const [a, b] of overlaps(state, now)) {
    const ra = state.roles.find((r) => r.id === a), rb = state.roles.find((r) => r.id === b);
    out.warnings.push(item("experience", "overlap." + a + "." + b, "role:" + b + ".note", `${ra.t || ra.c} and ${rb.t || rb.c} overlap — held in parallel? Add a note.`));
  }
  for (const rid of earlierCandidates(state, ctx)) {
    const r = state.roles.find((x) => x.id === rid);
    if (!state.dismissed.includes("earlier." + rid)) out.info.push(item("experience", "earlier." + rid, "role:" + rid + ".earlier", `${r.t || r.c} ended more than 15 years ago — it could print as one “Earlier career” line.`));
  }
  if (state.roles.length > CAPS.roles) out.warnings.push(item("experience", "roles.cap", "experience", `${state.roles.length} roles — ${CAPS.roles} is the most a CV holds. Remove some or mark older ones as “Earlier career”; nothing is cut for you.`));
  const sorted = sortRolesByDate(state, now).state.roles.map((r) => r.id).join();
  if (sorted !== state.roles.map((r) => r.id).join()) out.warnings.push(item("experience", "order", "experience", "Your roles are not in date order, newest first."));
  const prec = state.roles.map((r) => (r.dDirty ? r.from : parseDates(r.d).from)).filter(Boolean).map((f) => (f.includes("-") ? "m" : "y"));
  if (prec.includes("m") && prec.includes("y")) out.info.push(item("experience", "precision", "experience", "Some roles give month and year, others the year only."));
  out.questions.push(...qs);
}

function vSkills(state, ctx, out) {
  const printed = state.comps.filter((c) => c.printed);
  const seen = new Map();
  state.comps.forEach((c, i) => {
    const p = "comp:" + i;
    if (isLangComp(c)) { out.errors.push(item("skills", "comp.lang." + i, p, `“${c.n}” is a language — languages go in step 7. It is not printed here.`)); return; }
    if (isMarketComp(c)) out.warnings.push(item("skills", "comp.market." + i, p, `“${c.n}” is a place, not a skill.`));
    if (c.prov === "vocab" && !c.confirmed) out.warnings.push(item("skills", "comp.vocab." + i, p, `“${c.n}” is the portal's word, not yours — confirm it or rename it before it prints on your master CV.`));
    if (c.printed && ctx.vocab && !evidenceFor(state, c, ctx).length) out.warnings.push(item("skills", "comp.noevidence." + i, p, `No line of yours shows “${c.n}” — keep it off the CV, or add the line that proves it.`));
    const k = lc(c.tag);
    if (seen.has(k)) out.warnings.push(item("skills", "comp.dup." + i, p, `“${c.n}” and “${seen.get(k)}” are the same skill.`)); else seen.set(k, c.n);
  });
  const pl = state.comps.find((c) => lc(c.tag) === "p&l" && c.printed);
  if (pl && !allBullets(state).some(({ b }) => /p&l|\b(profit|budget|gewinn)/i.test(b.x)))
    out.questions.push(item("skills", "q.pl", "comp:" + state.comps.indexOf(pl), `Did you hold formal P&L responsibility? No line of yours says so — until you confirm, name the skill with words from your lines.`, { qid: "pl", answer: S(state.answers.pl) }));
  const n = printed.filter((c) => !isLangComp(c)).length;
  if (n > 10) out.warnings.push(item("skills", "comp.many", "skills", `${n} skills print — 8 to 10 read best.`));
  if (n < 6) out.warnings.push(item("skills", "comp.few", "skills", `${n} skill${n === 1 ? "" : "s"} print — 6 to 10 give an ATS enough to match.`));
  if (!S(state.technical).trim()) out.questions.push(item("skills", "q.technical", "technical", "Which tools do you use — exactly as you name them (e.g. Microsoft Office 365)?", { qid: "technical", answer: S(state.answers.technical) }));
}

const GERMAN_CREDENTIAL = /\b(kauf(mann|frau)|ausbildung|abschluss|diplom|meister|fachwirt|betriebswirt|studium|hochschule|ihk|hwk|berufsschule|abitur|staatsexamen|zeugnis|bachelor of arts \(b\.a\.\))\b|[äöüß]/i;
const ENGLISH_WORDS = /\b(the|and|of|merchant|trade|degree|certificate|graduate|diploma in|management|business|school|university|college)\b/i;

function vEducation(state, ctx, out) {
  const en = docCodes(ctx).includes("en") || state.lang === "en";
  state.education.forEach((e, i) => {
    const p = "edu:" + i;
    if (!S(e.b).trim()) out.errors.push(item("education", "edu.b." + i, p + ".b", `Education ${i + 1}: the credential is missing.`));
    const s = S(e.s);
    if (s.length >= 150 && s.length <= 160 && /\p{L}$/u.test(s)) out.warnings.push(item("education", "edu.cut." + i, p + ".s", "This looks cut off — check it against your CV."));
    if (en && GERMAN_CREDENTIAL.test(e.b) && !S(e.gloss).trim() && !ENGLISH_WORDS.test(s))
      out.info.push(item("education", "edu.gloss." + i, p + ".gloss", "An English reader needs a gloss — write it yourself."));
  });
}

function vLanguages(state, ctx, out) {
  const src = ctx.source ? parseLangs(ctx.source.langs) : [];
  const seen = new Set();
  state.langs.forEach((r, i) => {
    const p = "lang:" + i;
    if (!S(r.name).trim()) out.errors.push(item("languages", "lang.name." + i, p, `Language ${i + 1}: the name is missing.`));
    else if (!r.level && !r.cefr) out.errors.push(item("languages", "lang.level." + i, p, `${r.name}: choose a level${r.lvlRaw ? ` (your CV says “${r.lvlRaw}”)` : ""}.`));
    const was = src.find((s) => (s.code && s.code === r.code) || lc(s.name) === lc(r.name));
    /* German called fluent or verhandlungssicher is the owner's standing rule: a must-fix. */
    if (was && was.level === "native" && r.code === "de" && (r.level === "fluent" || r.level === "business")) out.errors.push(item("languages", "lang.native." + i, p, `Your ${ctx.real ? "uploaded CV" : "built-in profile"} says ${r.name} is native — never “fluent” or “verhandlungssicher”. Set it back to native.`));
    else if (was && was.level === "native" && r.level && r.level !== "native") out.info.push(item("languages", "lang.native." + i, p, `Your ${ctx.real ? "uploaded CV" : "built-in profile"} says ${r.name} is native.`));
    const k = r.code || lc(r.name);
    if (k && seen.has(k)) out.warnings.push(item("languages", "lang.dup." + i, p, `${r.name} is listed twice.`)); else seen.add(k);
  });
  const R = state.referee || {};
  if (S(R.name).trim() && !R.reachable) out.warnings.push(item("languages", "referee.reach", "referee.reachable", "Tick “confirmed reachable” before a referee's name prints. It is not printed until then."));
  if (S(R.name).trim() && !R.reachable) out.questions.push(item("languages", "q.referee", "referee.reachable", `Is ${R.name} reachable today, and has agreed to be named?`, { qid: "referee", answer: S(state.answers.referee) }));
}

/* Every field that prints, for the whole-CV scan in step 8, with how it reads: the
   headline sits in the header, as CV Review reads it; the rest is running text. */
function printedFields(state) {
  const f = [];
  for (const [k, v] of Object.entries(state.headline)) f.push(["headline." + k, v, "header"]);
  for (const [k, v] of Object.entries(state.summary)) f.push(["summary." + k, v]);
  state.roles.forEach((r) => {
    f.push(["role:" + r.id + ".t", r.t], ["role:" + r.id + ".c", joinC(r)], ["role:" + r.id + ".note", r.note], ["role:" + r.id + ".d", r.dDirty && r.from ? "" : r.d]);
    r.bullets.forEach((b) => f.push(["bullet:" + r.id + ":" + b.id, b.x]));
  });
  state.education.forEach((e, i) => f.push(["edu:" + i + ".b", e.b], ["edu:" + i + ".s", [e.gloss, e.inst, e.date, e.grade, e.s].join(" ")]));
  state.comps.forEach((c, i) => { if (c.printed && compOwned(c) && !isLangComp(c)) f.push(["comp:" + i, c.n]); });
  for (const [k, v] of Object.entries(state.refs)) f.push(["refs." + k, v]);
  const R = state.referee || {};
  if (R.reachable) for (const k of ["name", "role", "org", "date"]) f.push(["referee." + k, R[k]]);
  f.push(["technical", state.technical], ["langs", state.langsDirty ? langsLine(state.langs, "en") : state.langsRaw]);
  return f.filter(([, v]) => S(v).trim());
}

/* Printed personal data is a must-fix. A finding that may be a false positive can be
   dismissed with the words that fit it; a label cannot. */
function vPersonal(state, ctx, out, path, v, zone) {
  const d = new Set(state.dismissed || []);
  let n = 0;
  for (const h of personalFinds(v, { zone, nationality: S(ctx.header && ctx.header.nationality), employers: employersOf(state) })) {
    const hint = pdHint(path, v, h);
    if (h.dismissable && d.has(hint)) continue;
    n++;
    const extra = { kind: h.kind, quote: h.text, label: h.label, ...(h.dismissable ? { dismissable: true, hint, ack: PD_ACK[h.kind] || PD_ACK.other } : {}) };
    out.errors.push(item("check", h.dismissable ? hint : "personal." + path + "." + h.what, path, `${h.what} — “${h.text}” stays off your CV. Delete it from this field${h.dismissable ? ", or say it is not about you" : ""}.`, extra));
  }
  return n;
}

function vCheck(state, ctx, out) {
  for (const [path, v, zone] of printedFields(state)) {
    if (vPersonal(state, ctx, out, path, v, zone || "text")) continue;
    if (BREAK_WORDS.test(v)) out.warnings.push(item("check", "break." + path, path, "A gap needs no explanation on the CV itself."));
  }
  for (const r of state.roles) for (const b of r.bullets) {
    if (b.moved) out.warnings.push(item("check", "moved." + b.id, "bullet:" + r.id + ":" + b.id, `A line moved from ${b.moved.from} to ${employerOf(r)} — make sure it is work you did there.`));
    /* Filed under Experience so the jump lands on the line itself. */
    if (achTemplate(b)) out.errors.push(item("experience", "achcopy." + b.id, "bullet:" + r.id + ":" + b.id, "This line is the portal's achievement template around your figure, not your words. Rewrite it in your own words — export waits until it no longer reads as the template."));
    if (b.doc) out.info.push(item("check", "doc." + b.id, "bullet:" + r.id + ":" + b.id, `A line added from ${(b.src && b.src.file) || "one of your documents"}.`));
  }
  const seen = new Map();
  for (const { r, b } of allBullets(state)) {
    const k = norm(b.x);
    if (!k) continue;
    if (seen.has(k)) out.warnings.push(item("check", "dup." + b.id, "bullet:" + r.id + ":" + b.id, "The same line appears twice.")); else seen.set(k, b.id);
  }
  const h = ctx.header || {};
  if (!S(h.workRights).trim()) {
    out.questions.push(item("header", "q.visa", "hdr.workRights", "What should your visa / residency line say?", { qid: "visa", answer: S(state.answers.visa) }));
    out.questions.push(item("header", "q.licence", "hdr.workRights", "Do you hold a UAE driving licence, and may it be printed?", { qid: "licence", answer: S(state.answers.licence) }));
  }
  if (ctx.header && !S(h.availability).trim()) out.questions.push(item("header", "q.notice", "hdr.availability", "What is your notice period or earliest start date?", { qid: "notice", answer: S(state.answers.notice) }));
  const codes = docCodes(ctx);
  if (codes.includes("ar") && !S(state.summary.ar).trim()) out.questions.push(item("summary", "q.arabic", "summary.ar", "Will you write your Arabic CV yourself, or have a native speaker review it? Nothing is translated.", { qid: "arabic", answer: S(state.answers.arabic) }));
  /* The quoted line is about Arabic and English: asked only while the languages line
     still calls one of them native. One the candidate set away from native is answered. */
  const named = state.langs.filter((l) => l.level === "native" && (l.code === "ar" || l.code === "en")).map((l) => LANG_NAMES.en[l.code]);
  if (!ctx.real && codes.includes("de") && named.length)
    out.questions.push(item("languages", "q.langline", "langs", `Your German CVs have said “Arabisch und Englisch verhandlungssicher” while ${named.join(" and ")} ${named.length > 1 ? "are" : "is"} native. Which is right for the German line?`, { qid: "langline", answer: S(state.answers.langline) }));
}

const STEP_V = { header: vHeader, headline: vHeadline, summary: vSummary, experience: vExperience, skills: vSkills, education: vEducation, languages: vLanguages, check: vCheck };

/**
 * One step's findings. Errors block export; warnings, questions and info do not.
 * @returns {{errors:Item[], warnings:Item[], questions:Item[], info:Item[]}}
 */
export function validate(state, stepId, ctx = {}) {
  const out = empty();
  if (STEP_V[stepId]) STEP_V[stepId](state, ctx, out);
  const d = new Set(state.dismissed || []);
  out.warnings = out.warnings.filter((w) => !d.has(w.id));
  return out;
}

export function validateAll(state, ctx = {}) {
  const out = empty();
  for (const id of STEP_IDS) { const v = validate(state, id, ctx); for (const k of Object.keys(out)) out[k].push(...v[k]); }
  return out;
}

export const canExport = (state, ctx = {}) => validateAll(state, ctx).errors.length === 0;

/** The questions for the candidate, all steps. Answers are shown back, never printed. */
export const questions = (state, ctx = {}) => validateAll(state, ctx).questions;

/** Lines with a figure or a scope word, for the summary's "Your proof points" list. */
export function proofPoints(state) {
  return allBullets(state).filter(({ b }) => hasFigure(b.x) || SCOPE.test(b.x)).map(({ r, b }) => ({ rid: r.id, bid: b.id, x: b.x }));
}

/* ------------------------------------------------------------------ preview */

function headlineFor(state, lang) {
  const T = state.headline || {};
  return S(T[lang] || T[state.lang] || T.en || T.de || (state.roles[0] || {}).t);
}

/* How much of a preview in `lang` is still in the CV's own language: role titles and
   lines always are; the headline and summary count when written in `lang`. */
export function foreignShare(state, lang) {
  if (lang === state.lang) return 0;
  const lines = state.roles.reduce((n, r) => n + 1 + r.bullets.length, 0);
  const own = (S(state.headline[lang]).trim() ? 1 : 0) + (S(state.summary[lang]).trim() ? 1 : 0);
  const total = lines + 2;
  return Math.round(((total - own) / total) * 100);
}

/**
 * The printable master CV as plain data, in the shape cv-text-pdf readSheet returns.
 * Missing-field markers come back separately (`missing`) for an overlay OUTSIDE the
 * sheet, so they can never be read into the PDF. Nationality is never read.
 */
export function previewModel(state, header = {}, lang = "en", market = "gcc", ctx = {}) {
  const L = LABELS[lang] || LABELS.en;
  const h = header || {};
  const guard = guardOf(state, { header: h });
  const safe = (k) => { const v = S(h[k]).trim(); return v && !guard(k, v).blocked ? v : ""; };
  const links = (Array.isArray(h.links) ? h.links : [h.links]).map(S).map((s) => s.trim()).filter(Boolean).filter((v) => !guard("links", v).blocked);
  const clean = (x) => S(x).trim().replace(/\.\s*$/, "");
  const model = {
    name: safe("name"),
    headline: headlineFor(state, lang),
    contact: [safe("city"), safe("phone"), safe("email"), safe("workRights"), safe("availability"), ...links].filter(Boolean),
    sections: [],
    rtl: lang === "ar",
  };
  const sum = S(state.summary[lang] || state.summary[state.lang] || Object.values(state.summary).find((v) => S(v).trim()));
  if (sum.trim()) model.sections.push({ title: L.profile, lines: [{ text: sum.trim() }] });
  const comps = state.comps.filter((c) => c.printed && compOwned(c) && !isLangComp(c)).map((c) => c.n);
  if (comps.length) model.sections.push({ title: L.core, items: comps });
  const job = (r, withBullets) => ({ t: r.t, d: formatDates(r, lang, market), c: joinC(r), bullets: withBullets ? r.bullets.map((b) => clean(b.x)).filter(Boolean) : [] });
  const main = state.roles.filter((r) => !r.earlier), old = state.roles.filter((r) => r.earlier);
  if (main.length) model.sections.push({ title: L.experience, jobs: main.map((r) => job(r, true)) });
  if (old.length) model.sections.push({ title: L.earlier, jobs: old.map((r) => job(r, false)) });
  const edu = state.education.filter((e) => S(e.b).trim() || S(e.s).trim());
  if (edu.length) model.sections.push({ title: L.education, lines: edu.flatMap((e) => {
    const s = [e.gloss, e.inst, e.date, e.grade, e.s].map(S).map((x) => x.trim()).filter(Boolean).join(" · ");
    return [S(e.b).trim() && { text: S(e.b).trim(), bold: true }, s && { text: s }].filter(Boolean);
  }) });
  if (S(state.technical).trim()) model.sections.push({ title: L.technical, lines: [{ text: S(state.technical).trim() }] });
  const langs = !state.langsDirty && lang === state.lang ? state.langsRaw : langsLine(state.langs, lang);
  if (S(langs).trim()) model.sections.push({ title: L.languages, lines: [{ text: S(langs).trim() }] });
  const R = state.referee || {};
  /* A referee's name prints only once the candidate confirms they are reachable;
     contact details are never stored, so they can never print. */
  const ref = R.name && R.reachable ? [R.name, R.role, R.org, R.date].map(S).map((x) => x.trim()).filter(Boolean).join(", ") : S(state.refs[lang]) || L.refs;
  model.sections.push({ title: L.references, lines: [{ text: ref }] });
  model.missing = validateAll(state, { ...ctx, market }).errors.map((e) => ({ for: e.path, msg: e.msg, step: e.step }));
  model.foreign = foreignShare(state, lang);
  return model;
}

/* A measure stub for layoutCv: Noto Sans averages about half an em per character. */
const MM_PT = 25.4 / 72;
const stubWidth = (t, pt, bold) => S(t).length * pt * MM_PT * (bold ? 0.56 : 0.52);
const stubMeasure = {
  width: stubWidth,
  split: (t, pt, bold, max) => {
    const out = [];
    let line = "";
    for (const w of S(t).split(/\s+/).filter(Boolean)) {
      const next = line ? line + " " + w : w;
      if (line && stubWidth(next, pt, bold) > max) { out.push(line); line = w; } else line = next;
    }
    if (line) out.push(line);
    return out.length ? out : [""];
  },
};
/** Pages the text PDF would take, from the real A4 layout with a width estimate. */
export function estimatePages(model) {
  try { return layoutCv(model, stubMeasure).pages || 0; } catch { return 0; }
}

/* ------------------------------------------------------------------ what changed */

/**
 * Every added, removed, moved and edited line against the source profile, matched by
 * text, and the roles added, removed or reordered — for the sign-off in step 8 and the
 * "Show what changed" banner after a re-upload.
 */
export function diff(state, source) {
  const src = source || {};
  const sRoles = (src.experience || []).map((e, o) => ({ o, t: S(e.t), c: S(e.c), d: S(e.d), bullets: (e.bullets || []).filter((b) => !(isObj(b) && b.ach)).map((b) => S(isObj(b) ? b.x : b)) }));
  const out = { roles: { added: [], removed: [], edited: [], reordered: false }, lines: { added: [], removed: [], edited: [], moved: [] } };
  const byO = new Map(sRoles.map((r) => [r.o, r]));
  const kept = state.roles.filter((r) => r.o != null && byO.has(r.o));
  out.roles.added = state.roles.filter((r) => r.o == null || !byO.has(r.o)).map((r) => r.t || r.c || "(new role)");
  out.roles.removed = sRoles.filter((s) => !state.roles.some((r) => r.o === s.o)).map((s) => s.t || s.c);
  out.roles.reordered = kept.map((r) => r.o).join() !== [...kept.map((r) => r.o)].sort((a, b) => a - b).join();
  for (const r of kept) {
    const s = byO.get(r.o);
    const changed = [];
    if (r.t !== s.t) changed.push("t");
    if (effD(r, state.lang) !== s.d) changed.push("d");
    if (joinC(r) !== s.c) changed.push("c");
    if (changed.length) out.roles.edited.push({ role: r.t || s.t, fields: changed });
  }
  const srcAll = new Map();
  sRoles.forEach((s) => s.bullets.forEach((x) => srcAll.set(norm(x), s.o)));
  const seen = new Set();
  for (const r of state.roles) for (const b of r.bullets) {
    const k = norm(b.x);
    if (srcAll.has(k)) { seen.add(k); if (srcAll.get(k) !== r.o) out.lines.moved.push({ x: b.x, to: r.t || r.c }); continue; }
    if (b.orig && srcAll.has(norm(b.orig))) { seen.add(norm(b.orig)); out.lines.edited.push({ from: b.orig, to: b.x }); continue; }
    if (b.orig && b.orig.includes("; ")) { const parts = b.orig.split("; ").map(norm).filter((p) => srcAll.has(p)); if (parts.length) { parts.forEach((p) => seen.add(p)); out.lines.edited.push({ from: b.orig, to: b.x }); continue; } }
    out.lines.added.push({ x: b.x, to: r.t || r.c });
  }
  for (const s of sRoles) for (const x of s.bullets) if (!seen.has(norm(x)) && !allBullets(state).some(({ b }) => norm(b.orig).includes(norm(x)) && norm(x))) out.lines.removed.push({ x, from: s.t || s.c });
  return out;
}

/** A fresh state from the source profile, for "Reset to my uploaded CV / the built-in profile". */
export const resetFrom = (source, ctx = {}) => fromProfile(clone(source), ctx);
