/**
 * Listing text → fields. Pure: no DOM, no network, no clock.
 *
 * Everything here reads what the listing actually prints. A field the text does
 * not state comes back empty for the person to fill in — never guessed. That
 * matters most for the email: only an address literally present in the text is
 * returned, filtered through the same junk rules the address finder uses.
 */
import { harvest } from "./fetch-address.js";

/* ---------- ids ---------- */

/** 32-bit FNV-1a, hex. Small, dependency-free, stable across browsers and Node. */
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (const ch of String(str)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const normUrl = (u) => String(u || "").trim().toLowerCase()
  .replace(/^https?:\/\/(www\.)?/, "").replace(/#.*$/, "").replace(/\/+$/, "");
const normText = (t) => String(t || "").toLowerCase().replace(/\s+/g, " ").trim();

/** Keyed to the listing, not to an array position, so saved edits never move. */
export function listingId({ url = "", text = "" } = {}) {
  return "u-" + fnv1a(url ? normUrl(url) : normText(text));
}

/* ---------- languages and levels (shared with intake-fit.js) ---------- */

export const LANGUAGES = {
  german: ["german", "deutsch"], english: ["english", "englisch"], arabic: ["arabic", "arabisch"],
  french: ["french", "französisch"], spanish: ["spanish", "spanisch"], russian: ["russian", "russisch"],
  hindi: ["hindi"], urdu: ["urdu"], chinese: ["chinese", "mandarin", "chinesisch"],
};
const langRe = (names) => new RegExp(`(?:^|[^\\p{L}])(?:${names.join("|")})`, "iu");
const LANG_RES = Object.entries(LANGUAGES).map(([k, names]) => [k, langRe(names)]);

/** Highest first, so "very good" is tested before "good". */
export const LEVELS = [
  [5, /\b(?:native|mother tongue)\b|muttersprach/i],
  [4, /\b(?:fluent|fluency|business[- ]fluent|excellent|proficient|proficiency)\b|verhandlungssicher|fließend|exzellent/i],
  [3, /\b(?:very good|strong)\b|sehr gut/i],
  [2, /\b(?:good|working knowledge|solid)\b|\bgute?\b/i],
  [1, /\bbasic\b|grundkenntnis/i],
];
export function levelRank(s) {
  for (const [rank, re] of LEVELS) if (re.test(String(s || ""))) return rank;
  return 0;
}
function levelWord(s) {
  for (const [, re] of LEVELS) { const m = String(s).match(re); if (m) return m[0].toLowerCase(); }
  return "";
}

/* ---------- app chrome ---------- */

const NAV = /^(?:\s*(?:for you|network|home|my network|post|notifications|jobs|messaging)\s*)+$/i;
const UI = /^(?:…|\.\.\.)?\s*(?:see more|more|see translation|show translation|follow|\+\s*follow|connect|like|comment|repost|send|promoted|we are hiring!?|we['’]re hiring!?|we are|hiring)$/i;
const STATUS = /^\d{1,2}:\d{2}(?:\s+[\d%]+)*\s*$/;
const COUNTS = /^(?:\d[\d,.]*\s*k?\s*(?:comments?|reactions?|reposts?|likes?|views?|followers?)\s*[·•,]?\s*)+$/i;
const AGE = /^(\d{1,2})\s*(mo|m|h|d|w|y)\b\s*[^\p{L}\p{N}]{0,6}$/iu;

function ageText(n, unit) {
  const u = unit.toLowerCase();
  if (u === "m" || u === "h") return "today";
  const word = { d: "day", w: "week", mo: "month", y: "year" }[u];
  return `${+n} ${word}${+n === 1 ? "" : "s"} ago`;
}

/* ---------- headings ---------- */

const REQ_HEAD = /^(?:your profile|profile|requirements|qualifications|what you bring|what we are looking for|who you are|about you|knowledge and expertise|skills and experience|to be successful in this role.*|ihr profil(?:\s*\/\s*voraussetzungen)?|anforderungen|voraussetzungen|das bringen sie mit|was sie mitbringen)$/i;
const OTHER_HEAD = /^(?:your responsibilities|responsibilities(?: and what to expect)?|key responsibilities|your tasks|your role|the role|your duties.*|duties.*|what we offer|we offer|benefits|about us|about the (?:company|role)|about [a-z][\w&' -]{1,40}|job description|ihre aufgaben|aufgaben|wir bieten|über uns|how to apply|apply(?: now)?|share this job|similar jobs)$/i;

function headingOf(text) {
  const bare = String(text).replace(/\s*:\s*$/, "").trim();
  if (!bare || bare.length > 110) return null;
  if (REQ_HEAD.test(bare)) return "req";
  if (OTHER_HEAD.test(bare)) return "other";
  return null;
}

/* A PDF text layer arrives as one long line per page, headings included. Break
   the known headings onto their own lines. Case-sensitive on purpose: "Your
   Profile" is a heading, "…processes and requirements." is not. */
const INLINE_HEADS = ["Responsibilities and What to Expect", "Your Responsibilities", "Key Responsibilities",
  "Your Profile", "Your Tasks", "Requirements", "Qualifications", "Knowledge and Expertise", "What We Offer",
  "What we offer", "Ihre Aufgaben", "Ihr Profil", "Wir bieten", "Voraussetzungen", "Anforderungen"];
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function splitInlineHeadings(text) {
  let t = text;
  for (const h of INLINE_HEADS) {
    t = t.replace(new RegExp(`([^\\n])[ \\t]+(${reEsc(h)})[ \\t]*:?[ \\t]+(?=[A-ZÄÖÜ])`, "g"), "$1\n$2:\n");
  }
  return t;
}

/* ---------- line preparation ---------- */

/* OCR and narrow screens wrap one sentence over several lines. A line joins the
   one above it when that line has not ended a sentence and this one plainly
   continues it — starts in lower case, or follows a trailing comma or a word like
   "and" / "with". A blank line always ends the block, and a bullet list whose
   lines start with capitals stays one requirement per line. */
const CONTINUES = /(?:,|\b(?:and|or|with|of|for|to|the|a|an|in|on|at|by|from|as|und|oder|mit|für|von|zu|der|die|das|den|dem|des|im|auf|bei|als))$/i;

function prepare(text) {
  const raw = splitInlineHeadings(String(text || "").replace(/\r/g, "")).split("\n");
  const lines = [];
  let posted = "", author = "", joinable = false;
  for (const r of raw) {
    const l = r.replace(/ /g, " ").replace(/^[\s•\-–—*·▪●◦]+/, "").replace(/\s+/g, " ").trim();
    if (!l) { joinable = false; continue; }
    const age = l.match(AGE);
    if (age) {
      posted = posted || ageText(age[1], age[2]);
      if (lines.length && !author) author = lines.pop();   // the post author sits just above the age
      joinable = false;
      continue;
    }
    if (STATUS.test(l) || NAV.test(l) || UI.test(l) || COUNTS.test(l)) { joinable = false; continue; }
    const prev = lines[lines.length - 1];
    // Not digits: "10–15 years…" is the next bullet, not the end of the one above.
    if (joinable && prev && !/[.!?:;]$/.test(prev) && !headingOf(prev) && (/^[a-zäöüß(]/.test(l) || CONTINUES.test(prev))) {
      lines[lines.length - 1] = `${prev} ${l}`;
    } else {
      lines.push(l);
    }
    joinable = true;
  }
  return { lines, posted, author };
}

/* The one OCR confusion that breaks a link outright: LinkedIn's "lnkd.in" read with a capital I. */
const repairLink = (u) => u.replace(/^(https?:\/\/)Inkd\.in\//, "$1lnkd.in/");

const sentencesOf = (line) => line.split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ„"(])/).map((s) => s.trim()).filter(Boolean);

/* ---------- single fields ---------- */

const GENDER = /\((?:m\/f\/d|m\/w\/d|f\/m\/d|w\/m\/d|m\/f\/x|d\/f\/m|all genders)\)/i;
const ROLE_WORD = /\b(?:intern|trainee|manager|director|head|officer|specialist|engineer|consultant|advisor|adviser|assistant|coordinator|executive|analyst|representative|administrator|supervisor|architect|accountant|controller|chief|praktikant(?:in)?|leiter(?:in)?|referent(?:in)?|sachbearbeiter(?:in)?|berater(?:in)?|geschäftsführer(?:in)?)\b/i;

function findTitle(lines, flat) {
  const a = flat.match(/\blooking for an? ([^.!?]{3,90}?\((?:m\/f\/d|m\/w\/d|f\/m\/d|w\/m\/d|m\/f\/x)\))/i);
  if (a) return a[1].trim();
  for (const l of lines) {
    const m = l.match(/^(?:job title|position|role|stelle|stellenbezeichnung)\s*:\s*(.{3,120})$/i);
    if (m) return m[1].trim();
  }
  const g = lines.find((l) => GENDER.test(l) && l.length <= 140);
  if (g) return g;
  const r = lines.find((l) => l.length <= 140 && ROLE_WORD.test(l) && !/[.!?]$/.test(l) && !/:/.test(l));
  return r ? r.replace(/\s+at\s+(?:the\s+)?[A-Z].*$/, "").trim() : "";
}

function findCompany(flat, lines, author) {
  const hiring = String.raw`\s*\(([A-Z]{2,6})\)\s+(?:is|are)\s+(?:looking|hiring|seeking|searching|recruiting)\b`;
  let m = flat.match(new RegExp(String.raw`\b[Tt]he\s+([A-Z][\w&.,'’ -]{2,90}?)` + hiring))
       || flat.match(new RegExp(String.raw`\b([A-Z][\w&.,'’ -]{2,90}?)` + hiring));
  if (m) return `${m[1].trim()} (${m[2]})`;
  m = flat.match(/\bat\s+(?:the\s+)?([A-Z][\w&.,'’ -]{2,90}?\s*\([A-Z]{2,6}\))/);
  if (m) return m[1].trim();
  for (const l of lines) {
    const c = l.match(/^(?:company|employer|unternehmen|arbeitgeber)\s*:\s*(.{2,90})$/i);
    if (c) return c[1].trim();
  }
  // The line above the age marker is the poster — unless it is feed activity ("Anna shared a post").
  if (!author || /\b(?:shared|reposted|likes?|liked|commented|celebrat\w*|follows|posted)\b/i.test(author)) return "";
  return author.replace(/\s*(?:\.{3}|…)$/, "").trim();
}

const COUNTRIES = new Set(["UAE", "United Arab Emirates", "Qatar", "Saudi Arabia", "Bahrain", "Kuwait",
  "Oman", "Germany", "Deutschland", "Austria", "Switzerland"]);
function findCity(flat, places) {
  const hits = places
    .map((p) => ({ p, i: flat.search(new RegExp(`\\b${reEsc(p)}\\b`, "i")) }))
    .filter((h) => h.i >= 0)
    .sort((a, b) => a.i - b.i);
  const city = hits.find((h) => !COUNTRIES.has(h.p));
  return (city || hits[0] || { p: "" }).p;
}

const DE_W = /\b(?:und|der|die|das|mit|für|sie|wir|ihre?|von|zu|auf|ist|eine?n?|bei|im|des|dem|den|sind|oder|über)\b/gi;
const EN_W = /\b(?:and|the|with|for|you|we|your|our|of|to|on|is|a|an|at|are|or|will)\b/gi;
const langOf = (flat) => ((flat.match(DE_W) || []).length > (flat.match(EN_W) || []).length ? "DE" : "EN");

function findStart(flat) {
  const pats = [
    // "\d{3} ?\d": PDF text layers split years ("202 6"); the space is removed below.
    /\bstarting(?: on| from)?\s+(\d{1,2}(?:st|nd|rd|th)?\s+[A-Z][a-z]+\s+\d{3} ?\d)\b/,
    /\bstart(?:ing)?\s+date\s*:?\s*(\d{1,2}(?:st|nd|rd|th)?\s+[A-Z][a-z]+\s+\d{4}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|immediately|asap)/i,
    /\b(?:zum|ab dem|ab)\s+(\d{1,2}\.\s*[A-ZÄÖÜ][a-zäöü]+\s+\d{4}|\d{1,2}\.\d{1,2}\.\d{2,4}|sofort)\b/,
  ];
  for (const p of pats) { const m = flat.match(p); if (m) return m[1].replace(/(\d{3}) (\d)$/, "$1$2"); }
  return "";
}

function findPosted(flat) {
  const m = flat.match(/\b(?:job published|published|posted(?: on)?|veröffentlicht(?: am)?)\s*:?\s*(\d{1,2}[-./]\d{1,2}[-./]\d{2,4}|\d{1,2}\s+[A-Z][a-z]+\s+\d{4})/i);
  return m ? m[1] : "";
}

/* ---------- requirements ---------- */

const CUE = /\b(?:looking for (?:someone|a candidate|a person) with|you (?:have|bring|should have|will have)|must|required|essential|at least|minimum|degree|experience (?:in|with)|knowledge of|skills|voraussetzung|anforderungen|sie bringen mit|sie verfügen)\b/i;
const LEAD = /^(?:we(?: are|['’]re) looking for (?:someone|a candidate|a person) with|the ideal candidate (?:has|brings|will have)|sie bringen mit:?)\s*/i;
const HEAD_NOUN = /\b(?:experience|knowledge|skills?|degree|years?|ability|understanding|proficiency|background|expertise|track record|kenntnisse|erfahrung|studium|ausbildung)\b/i;
const NICE = /\b(?:a plus|an? (?:additional )?advantage|advantageous|preferred|preferably|desirable|nice to have|an? (?:additional )?asset|beneficial|not mandatory)\b|von vorteil|wünschenswert|idealerweise|gerne gesehen/i;
const LANG_CONTEXT = /language|sprach|skills|kenntnisse|speak|spoken|written|fluen|native|mother tongue|muttersprach|verhandlungssicher|fließend|proficien/i;
const YEARS = /\b(?:(?:at least|minimum(?: of)?|min\.?|more than|over|mindestens)\s+)?(\d{1,2})\s*\+?\s*(?:(?:to|-|–|—|bis)\s*\d{1,2}\s*\+?\s*)?(?:years?|yrs?|jahre?n?)\b/i;
const DEGREE = /\b(?:degree|bachelor(?:['’]s)?|master(?:['’]s)?|mba|university|studium|hochschulabschluss|diplom\w*)\b/i;
const LOCATION = /\b(?:based in|relocat\w*|residence in|resident in|willing(?:ness)? to travel|travel (?:frequently|mainly|regularly)|frequent travel)\b|reisebereitschaft/i;
const NATIONALITY = /\b(omani|emirati|uae|saudi|qatari|kuwaiti|bahraini|gcc)\s+nationals?\b|\b(?:nationals only|emiratisation|emiratization)\b/i;

/** A run-on list after "looking for someone with" becomes one requirement per item. */
function itemsOf(sentence) {
  const body = sentence.replace(/\s+/g, " ").trim().replace(/[.;:]+$/, "");
  const lead = body.match(LEAD);
  const parts = lead ? body.slice(lead[0].length).split(/\s*[,;]\s*/) : body.split(/\s*;\s*/);
  const out = [];
  for (let p of parts) {
    p = p.replace(/^(?:and|or|und|oder)\s+/i, "").trim();
    if (p.length < 3) continue;
    if (lead && out.length && !HEAD_NOUN.test(p)) {
      // "experience in A, B or C": B carries no noun of its own, so it inherits "experience in".
      const prev = out[out.length - 1].match(/^(.*?\b(?:in|of|im|with)\s)/i);
      if (prev) p = prev[1] + p;
    }
    out.push(p);
  }
  return out;
}

function typeItem(text) {
  const core = text.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();  // "(MBA preferred)" must not make the degree optional
  const strength = NICE.test(core) ? "nice" : "must";
  const langs = LANG_RES.filter(([, re]) => re.test(core)).map(([k]) => k);
  const firstWord = core.split(/\s+/)[0] || "";
  if (langs.length && (LANG_CONTEXT.test(core) || levelRank(core) || LANG_RES.some(([, re]) => re.test(firstWord)))) {
    const level = levelWord(core);
    return langs.map((language) => ({ text, strength, type: "language", language, level }));
  }
  const y = core.match(YEARS);
  if (y) {
    const rest = core.slice(y.index + y[0].length);
    const f = rest.match(/\b(?:of|in|im|within|as)\s+(.+)$/i);
    return [{ text, strength, type: "years", years: +y[1], field: f ? f[1].trim() : "" }];
  }
  if (DEGREE.test(core)) {
    const f = core.match(/\b(?:degree|bachelor(?:['’]s)?|master(?:['’]s)?|studium|diplom\w*)\s+(?:degree\s+)?(?:in|of|der|des|im)\s+(.+)$/i);
    return [{ text, strength, type: "degree", field: f ? f[1].trim() : "" }];
  }
  if (LOCATION.test(core)) return [{ text, strength, type: "location" }];
  return [{ text, strength, type: "skill", field: core }];
}

/* ---------- application instructions ---------- */

const INSTR = [
  ["salary", /\b(?:salary expectations?|expected salary|desired salary)\b|gehaltsvorstellung|gehaltswunsch/i],
  ["start", /\b(?:earliest (?:possible )?start(?:ing)? date|availability date|notice period)\b|eintrittstermin|frühestmögliche[nr]? eintritt/i],
  ["reference", /\b(?:reference (?:number|no\.?|code)|job[- ]?id|ref\.?\s*(?:no\.?|nr\.?|#))|kennziffer|referenznummer/i],
  ["attachments", /\b(?:include (?:your )?(?:cv|resume|cover letter|certificates|portfolio)|attach (?:your )?(?:cv|resume|certificates))\b|anlagen|zeugnisse/i],
];
const APPLY_VERB = /\b(?:send|submit|include|attach|apply|application|email)\b|bewerbung|senden|schicken|richten|beifügen/i;
/* "Please send your full application to:" is how to apply, not something to have. */
const APPLY_LINE = /\b(?:send|submit|forward|e-?mail)\b[^.]*\b(?:application|applications|cv|resume|résumé)\b|\bapply (?:now|here|via|through|online)\b|bewerbung(?:sunterlagen)?[^.]*\b(?:an|per|über)\b/i;
const ADDRESS_OR_LINK = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|\bhttps?:\/\/\S+/g;
function instructionsOf(sentence) {
  return INSTR
    .filter(([kind, re]) => re.test(sentence) && (kind === "reference" || APPLY_VERB.test(sentence)))
    .map(([kind]) => ({ kind, text: sentence }));
}

/* ---------- entry point ---------- */

/**
 * @param {string} text
 * @param {{readAt?: string, places?: string[]}} [opt]
 */
export function parseListing(text, { readAt = "", places = [] } = {}) {
  const { lines, posted: age, author } = prepare(text);
  const flat = lines.join(" ");
  const requirements = [], duties = [], instructions = [];
  const seen = new Set();
  const addReq = (r) => {
    const k = [r.type, r.language || r.nationality || "", r.text].join("|");
    if (!seen.has(k)) { seen.add(k); requirements.push(r); }
  };

  let section = null;   // null = no heading seen yet; cues decide. "req" / "other" = a heading decides.
  for (let line of lines) {
    const whole = headingOf(line);
    if (whole) { section = whole; continue; }
    const lab = line.match(/^([^:]{3,110}):\s+(.+)$/);
    if (lab && headingOf(lab[1])) { section = headingOf(lab[1]); line = lab[2]; }

    for (const sentence of sentencesOf(line)) {
      const ins = instructionsOf(sentence);
      if (ins.length) {
        for (const x of ins) if (!instructions.some((y) => y.kind === x.kind)) instructions.push(x);
        continue;
      }
      // Addresses and links are read separately; left in, "Arabic would be a plus. hr@…" becomes one requirement.
      const s = sentence.replace(ADDRESS_OR_LINK, " ").replace(/\s+/g, " ").replace(/^[\s.,;:]+|[\s,;:]+$/g, "").trim();
      if (!s || /^[.!?]+$/.test(s)) continue;
      if (APPLY_LINE.test(s)) { duties.push(s); continue; }
      if (section === "req" || (section === null && CUE.test(s))) {
        for (const item of itemsOf(s)) for (const r of typeItem(item)) addReq(r);
      } else {
        duties.push(s);
      }
    }
  }

  // A nationality restriction binds wherever it is printed, title included.
  for (const l of lines) {
    const n = l.match(NATIONALITY);
    if (n) addReq({ text: l, strength: "must", type: "nationality", nationality: (n[1] || "local").toLowerCase() });
  }

  const title = findTitle(lines, flat);
  return {
    looksLikeListing: !!title || requirements.some((r) => r.type !== "location"),
    title,
    company: findCompany(flat, lines, author),
    city: findCity(flat, places),
    lang: langOf(flat),
    emails: harvest(String(text || ""), ""),
    links: [...new Set((String(text || "").match(/\bhttps?:\/\/[^\s<>"'()\]]+/gi) || []).map((u) => repairLink(u.replace(/[.,;:]+$/, ""))))],
    start: findStart(flat),
    posted: age || findPosted(flat),
    readAt,
    duties,
    requirements,
    instructions,
  };
}
