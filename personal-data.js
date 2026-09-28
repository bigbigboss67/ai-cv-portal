/**
 * Printed personal data: what a CV must never carry, found in any text field.
 *
 * Shared by the CV Builder and the CV Review so both tabs read a line the same
 * way. Pure: text in, hits out. No DOM, no network, no clock, nothing generated.
 *
 * findPersonalData(text, opts) -> [{ kind, label, text, index, dismissable }]
 *   kind:  "nationality" | "dob" | "age" | "date" | "birthplace" | "religion" | "marital" | "health"
 *   label: true when an explicit label prints ("Date of birth:", "DOB",
 *          "Nationality:", "Religion:", "Marital status"). A label is never a
 *          false positive, so a labelled hit is never dismissable.
 *   text, index: the matched span of the input, verbatim.
 *   dismissable: !label. A pattern match may be a market, a language, a company
 *          or someone else's birthday; the candidate can say so.
 * opts: {
 *   zone: "header" for a contact or headline field (every demonym that is not a
 *         market, a language or a work-rights statement counts; so does a bare
 *         date or a bare "45 ans" segment), anything else for running text
 *         (only a self-description counts). Default: running text.
 *   workRights: true for the work-rights line itself: "German passport (EU)" is
 *         the candidate's chosen work-rights wording there, not a self-description.
 *   nationality: the stored nationality; its demonyms join the list.
 *   mask: [{start, end}] spans of the text to skip (places, employer names).
 *   employers: employer names; a "born" statement about one is not the candidate's.
 * }
 *
 * demonymUses(text, opts) -> [{ start, end, word, use }] with use one of
 *   "language" | "market" | "workRights" | "labelled" | "self" | "unknown".
 *
 * No regex here uses lookbehind (older Safari). JS \b is ASCII-only, so word
 * boundaries are checked by hand.
 */

const str = (v) => (v === undefined || v === null ? "" : String(v));
const low = (v) => str(v).toLowerCase();
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const WORDCH = /[\p{L}\p{N}\p{M}]/u;
const bound = (t, s, e) => !(s > 0 && WORDCH.test(t[s - 1])) && !(e < t.length && WORDCH.test(t[e]));

/* Eastern Arabic and Persian digits become 0-9 (built from code points). */
export function asciiDigits(s) {
  let out = "";
  for (const ch of str(s)) {
    const c = ch.codePointAt(0);
    out += c >= 0x660 && c <= 0x669 ? String(c - 0x660) : c >= 0x6f0 && c <= 0x6f9 ? String(c - 0x6f0) : ch;
  }
  return out;
}

/* Whole-word, case-insensitive list matching, longest item first. */
function wordList(list) {
  const alts = [...new Set(list.map((w) => low(w).trim()).filter(Boolean))].sort((a, b) => b.length - a.length)
    .map((w) => escRe(w).replace(/\s+/g, "\\s+"));
  const re = new RegExp(alts.join("|"), "giu");
  return (text) => {
    const t = str(text), out = [];
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(t))) {
      const s = m.index, e = s + m[0].length;
      if (!m[0].length) { re.lastIndex = s + 1; continue; }
      if (bound(t, s, e)) out.push({ start: s, end: e, word: m[0] }); else re.lastIndex = s + 1;
    }
    return out;
  };
}

/* Blank out spans with "_" (same length, so indices stay valid; "_" is not a letter). */
const maskSpans = (t, spans) => { for (const { start, end } of spans || []) if (end > start) t = t.slice(0, start) + "_".repeat(end - start) + t.slice(end); return t; };

/* ---------- vocabularies ---------- */

export const DEMONYMS = ["german", "lebanese", "emirati", "saudi", "british", "american", "indian", "pakistani", "egyptian", "jordanian", "syrian",
  "palestinian", "iraqi", "iranian", "turkish", "french", "italian", "spanish", "dutch", "russian", "filipino", "chinese", "canadian", "australian",
  "irish", "polish", "swiss", "austrian", "moroccan", "tunisian", "algerian", "sudanese", "yemeni", "omani", "qatari", "kuwaiti", "bahraini",
  "nigerian", "kenyan", "south african", "sri lankan", "bangladeshi", "nepali", "afghan", "ethiopian", "ghanaian", "brazilian", "mexican",
  "argentinian", "colombian", "japanese", "korean", "vietnamese", "malaysian", "indonesian", "singaporean", "greek", "portuguese", "belgian",
  "swedish", "norwegian", "danish", "finnish", "romanian", "bulgarian", "ukrainian", "hungarian", "czech", "serbian", "croatian", "armenian",
  "azerbaijani", "kazakh", "uzbek", "libyan", "somali", "eritrean", "deutsch", "deutsche", "deutscher", "libanesisch", "libanese", "libanesin",
  "britisch", "französisch", "türkisch", "syrisch", "ägyptisch", "jordanisch", "allemand", "allemande", "libanais", "libanaise", "alemán", "alemana",
  "libanés", "libanesa"];
/* Names that are only ever a language: a list holding one is a language list. */
const LANGS = ["english", "arabic", "hindi", "urdu", "farsi", "persian", "tagalog", "mandarin", "cantonese", "malayalam", "tamil", "telugu",
  "bengali", "punjabi", "gujarati", "marathi", "kannada", "swahili", "hebrew", "latin", "englisch", "arabisch", "spanisch", "italienisch",
  "russisch", "chinesisch", "japanisch", "anglais", "arabe", "français", "espagnol", "inglés", "ingles", "árabe", "francés", "español",
  "inglese", "arabo", "tedesco"];
/* Places that contain a demonym: "Saudi Arabia" names no nationality. */
const DEMONYM_PLACES = wordList(["saudi arabia", "saudi-arabien", "indian ocean", "british columbia", "british isles"]);
/* A demonym before one of these names a market or a thing: "German & GCC markets", "German GAAP". */
const THING = new Set(["market", "markets", "company", "companies", "client", "clients", "clientele", "customer", "customers", "firm", "firms",
  "sme", "smes", "subsidiary", "subsidiaries", "operation", "operations", "brand", "brands", "gaap", "hgb", "ifrs", "law", "laws", "trade",
  "trading", "industry", "industries", "sector", "sectors", "economy", "government", "authorities", "ministry", "embassy", "consulate", "chamber",
  "council", "association", "institute", "university", "school", "college", "network", "networks", "partner", "partners", "principals",
  "supplier", "suppliers", "distributor", "distributors", "manufacturer", "manufacturers", "retailer", "retailers", "bank", "banks", "banking",
  "finance", "product", "products", "export", "exports", "import", "imports", "investment", "investments", "project", "projects", "account",
  "accounts", "portfolio", "team", "teams", "staff", "employees", "workforce", "colleagues", "office", "offices", "headquarters", "entity",
  "entities", "unit", "units", "division", "divisions", "standard", "standards", "regulation", "regulations", "tax", "accounting", "businesses",
  "group", "groups", "holding", "holdings", "airline", "airlines", "airways", "telecom", "petroleum", "insurance", "capital", "development",
  "properties", "cuisine", "food", "cars", "car", "rental", "real", "property", "engineering", "automotive", "stakeholders", "shareholders",
  "buyers", "developers", "contractors", "delegation", "delegations", "counterparts", "tourists", "tourism", "charity", "charities", "community",
  "communities", "church", "churches", "mosque", "mosques", "hospital", "hospitals", "mittelstand", "unternehmen", "markt", "märkte", "kunden",
  "firmen", "tochtergesellschaften", "niederlassungen", "recht", "handel", "industrie", "marché", "marchés", "entreprises", "mercado",
  "mercados", "empresas", "clientes"]);
/* A demonym before one of these (singular) describes a person: the candidate. */
const PERSON = new Set(["national", "citizen", "native", "owner", "co-owner", "entrepreneur", "businessman", "businesswoman", "executive",
  "professional", "expat", "expatriate", "man", "woman", "gentleman", "lady", "founder", "co-founder", "consultant", "advisor", "adviser",
  "engineer", "manager", "director", "leader", "specialist", "expert", "lawyer", "accountant", "banker", "investor", "officer", "analyst",
  "trader", "ceo", "cfo", "coo", "cto", "graduate", "origin", "descent", "heritage", "roots", "background", "born", "unternehmer",
  "unternehmerin", "geschäftsmann", "geschäftsfrau", "staatsbürger", "staatsbürgerin", "herkunft", "abstammung", "ressortissant",
  "ciudadano", "ciudadana"]);
/* A field before a person noun is a job title: "Lebanese finance manager", "Emirati banking
   professional", "German industry veteran" describe the person. Other things stay markets
   before one ("Saudi market specialist", "German-GCC trade advisor"). */
const FIELD = new Set(["finance", "banking", "accounting", "project", "engineering", "investment", "real", "industry", "group"]);
/* After a field, PERSON's words that name an origin are no job ("German engineering background"),
   and two more nouns are ("real estate developer", "industry veteran"; "a Chinese developer" alone is a company). */
const ORIGIN = new Set(["origin", "descent", "heritage", "roots", "background", "born", "herkunft", "abstammung"]);
const FIELD_PERSON = new Set(["developer", "veteran"]);
/* Only these stand between a field and its person noun ("real estate developer", "finance and accounts
   professional"); any other word makes a thing ("German finance team as director", "German accounting standards specialist"). */
const FIELD_JOIN = new Set(["and", "estate", "accounts"]);
/* A first-person statement before a demonym: "I am Lebanese", "I'm German", "Proud Emirati". */
const SELF_BEFORE = /(?:^|[^\p{L}])(?:i\s+am|i['’]m|ich\s+bin|je\s+suis|soy|proud)\s+(?:an?\s+)?$/iu;
/* Right after a demonym, these make it a noun standing for the candidate: "German with …", "Lebanese by birth". */
const STOP_FIRST = new Set(["with", "who", "based", "living", "residing", "from", "of", "by", "in", "at", "since", "mit", "aus", "seit", "wohnhaft"]);
/* Later in the phrase they end it. */
const STOP_ANY = new Set(["with", "who", "based", "in", "at", "for", "to", "of", "on", "by", "from", "since", "the", "a", "an", "is", "was", "and"]);

const LANG_BEFORE = /(?:^|[^\p{L}])(?:in|auf|en|speaks?|speaking|spricht|sprechen|native|natively|fluent|fluently|languages?|sprachen|langues?|idiomas?)\s*:?\s*$/iu;
const LANG_AFTER = /^(?:[\s\-‐]*(?:speakers?|speaking|languages?|sprachen?|muttersprach\p{L}*|sprachig\p{L}*|native speakers?|mother tongue)|\s*\(\s*(?:native|fluent|mother tongue|muttersprach\p{L}*|bilingual|business|conversational|basic|advanced|intermediate|professional|full|limited|elementary|working|verhandlungssicher|fließend|gut|sehr gut|grundkenntnisse|langue maternelle|lengua materna|nativ[oa]|[abc][12]))(?![\p{L}])/iu;
/* "German passport", "Lebanese citizen": a work-rights statement. "German national" is the nationality itself. */
const WR_AFTER = /^[\s\-‐]*(?:passports?|reisepass|pass|citizen|citizenship|staatsangehöriger|staatsangehörige|staatsbürger|staatsbürgerin|staatsbürgerschaft|blue card|blaue karte)(?![\p{L}])/iu;
const WR_BEFORE = /(?:passport|reisepass|pass|citizen|citizenship|staatsbürgerschaft)\s*[(:]\s*$/iu;
const ALONE = /^\s*(?:[,.;:!?)|·•–—]|$)/u;

/* Labels. `colon`: a word that is a label only when a colon follows ("Citizenship: …");
   `textColon`: in running text it needs the colon ("the birthplace of …" is not one). */
const LABELS = [
  { kind: "nationality", m: wordList(["nationality", "nationalität", "staatsangehörigkeit", "nationalité", "nacionalidad", "nazionalità", "الجنسية"]) },
  { kind: "nationality", colon: true, m: wordList(["citizenship", "staatsbürgerschaft", "citoyenneté", "ciudadanía"]) },
  { kind: "dob", m: wordList(["date of birth", "birth date", "birthdate", "dob", "d.o.b.", "d.o.b", "geburtsdatum", "date de naissance", "fecha de nacimiento", "data di nascita", "تاريخ الميلاد", "تاريخ الولادة"]) },
  { kind: "birthplace", textColon: true, m: wordList(["place of birth", "birthplace", "geburtsort", "lieu de naissance", "lugar de nacimiento", "luogo di nascita", "مكان الولادة", "مكان الميلاد"]) },
  { kind: "religion", m: wordList(["religion", "konfession", "religionszugehörigkeit", "glaubensbekenntnis", "religious affiliation", "الديانة"]) },
  { kind: "marital", m: wordList(["marital status", "familienstand", "état civil", "situation familiale", "estado civil", "stato civile", "الحالة الاجتماعية"]) },
];
/* In running text a `textColon` label also counts when it opens the line or a sentence
   and a capitalised place follows: "Place of birth Beirut", "Geburtsort - Beirut". */
const LABEL_OPENS = /(?:^|[.!?;:|·•])\s*$/u;
const PLACE_NEXT = /^\s*[-‐–—]?\s*\p{Lu}/u;
const NAT_LABEL_BEFORE = /(?:nationality|nationalität|staatsangehörigkeit|nationalité|nacionalidad|nazionalità|citizenship|staatsbürgerschaft)\s*[:\-–]?\s*$/iu;
const RELIGION_LABEL_BEFORE = /(?:religion|konfession|religionszugehörigkeit|glaubensbekenntnis|religious affiliation)\s*[:\-–]?\s*$/iu;

const RELIGION = wordList(["muslim", "christian", "catholic", "protestant", "jewish", "hindu", "buddhist", "sikh", "evangelisch", "katholisch",
  "muslimisch", "jüdisch", "sunni", "shia", "مسلم", "مسيحي"]);
const MARITAL_WORDS = new Set(["married", "single", "divorced", "widowed", "verheiratet", "ledig", "geschieden", "verwitwet", "marié", "mariée",
  "célibataire", "casado", "casada", "soltero", "soltera", "متزوج", "أعزب"]);
const MARITAL_SELF = /(?:^|[^\p{L}])((?:i am|i'm|i’m|am|happily|glücklich|ich bin|je suis|estoy)\s+(?:married|verheiratet|divorced|geschieden|widowed|verwitwet|marié|mariée|casad[oa])|(?:married|verheiratet|marié|mariée|casad[oa])\s*(?:with|mit|avec|con|and|und|,)\s*(?:\d+|one|two|three|four|five|a|ein|eine|zwei|drei|vier|un|une|deux|trois|dos|tres)\s+(?:children|child|kids|sons?|daughters?|kindern?|enfants?|hijos?)|(?:father|mother|vater|mutter|père|mère|padre|madre)\s+(?:of|von|de)\s+(?:\d+|two|three|four|five|zwei|drei|vier|deux|trois|dos|tres)(?:\s+(?:children|kids|kindern|enfants|hijos))?)(?![\p{L}])/giu;
/* Running text: a bare status opening a sentence or segment, "Married.", "Divorced.", "Married, based in Dubai." */
const MARITAL_ALONE = new RegExp(`(?:^\\s*|[.!?;:|·•]\\s*)(${[...MARITAL_WORDS].map(escRe).join("|")})(?=\\s*(?:[.,;!?|·•]|$))`, "giu");
const CHILDREN_RE = /(?:^|[^\p{L}\d])((?:\d+|one|two|three|four|five|ein|eine|zwei|drei|vier|fünf|un|deux|trois)\s+(?:children|child|kids|kinder|kind|enfants?))(?![\p{L}])/giu;
/* Health conditions: never "health and safety" or "healthcare". */
const HEALTH = wordList(["health reasons", "health recovery", "health issue", "health issues", "health condition", "health problems",
  "medical leave", "medical reasons", "illness", "chronic illness", "disability", "sick leave", "burnout", "burn-out", "krankheit", "erkrankung",
  "gesundheitliche gründe", "behinderung", "schwerbehindert", "genesung", "maladie", "enfermedad"]);

/* ---------- dates of birth, ages, places of birth ---------- */

const MONTH_WORDS = ["jan", "january", "jän", "januar", "jänner", "janv", "janvier", "ene", "enero", "gen", "gennaio", "يناير",
  "feb", "february", "februar", "févr", "fév", "février", "febrero", "febbraio", "فبراير", "شباط",
  "mar", "march", "mär", "märz", "mrz", "mars", "marzo", "مارس", "آذار",
  "apr", "april", "avr", "avril", "abr", "abril", "aprile", "أبريل", "ابريل", "نيسان",
  "may", "mai", "mayo", "mag", "maggio", "مايو", "أيار",
  "jun", "june", "juni", "juin", "junio", "giu", "giugno", "يونيو", "حزيران",
  "jul", "july", "juli", "juil", "juillet", "julio", "lug", "luglio", "يوليو", "تموز",
  "aug", "august", "août", "ago", "agosto", "أغسطس", "اغسطس", "آب",
  "sep", "sept", "september", "septembre", "septiembre", "set", "settembre", "سبتمبر", "أيلول",
  "oct", "october", "okt", "oktober", "octobre", "octubre", "ott", "ottobre", "أكتوبر", "اكتوبر",
  "nov", "november", "novembre", "noviembre", "نوفمبر",
  "dec", "december", "dez", "dezember", "déc", "décembre", "dic", "diciembre", "dicembre", "ديسمبر"];
const MONTH_SET = new Set(MONTH_WORDS);
const MON_ALT = MONTH_WORDS.slice().sort((a, b) => b.length - a.length).map(escRe).join("|");
/* Case spelled out for the first letter, so the "born" regexes need no i flag. */
const MON_CI = MONTH_WORDS.slice().sort((a, b) => b.length - a.length).map((k) => escRe(k).replace(/^\p{Ll}/u, (x) => `[${x}${x.toUpperCase()}]`)).join("|");
const ORD = "(?:\\.|st|nd|rd|th|er|º)?";
/* A full date with a day: what a header carries when it prints a birthday. */
const FULL_DATE = new RegExp(`\\b\\d{1,2}[./]\\d{1,2}[./]\\d{4}\\b|\\b\\d{1,2}${ORD}\\s+(?:of\\s+)?(?:${MON_ALT})\\.?,?\\s+\\d{4}|\\b\\d{1,2}\\s+de\\s+(?:${MON_ALT})\\s+del?\\s+\\d{4}`, "giu");
const DOB_DATE = `(?:\\d{1,2}[./-]\\d{1,2}[./-]\\d{2,4}|\\d{1,2}${ORD}\\s+de\\s+(?:${MON_CI})\\s+del?\\s+\\d{4}|\\d{1,2}${ORD}\\s+(?:of\\s+)?(?:${MON_CI})\\.?,?\\s+\\d{4}|(?:${MON_CI})\\.?\\s+(?:the\\s+)?\\d{1,2}${ORD},?\\s+\\d{4}|(?:${MON_CI})\\.?\\s+\\d{4}|(?:19|20)\\d{2}|['’‘]\\d{2})(?!\\d)`;
/* born / geboren / geb. / né(e) / nacido / nato / Jahrgang / Jg. / مواليد, optionally
   "in <Place>," and up to two of on / the / am / le / el, then a date or a year.
   Case is spelled out (no i flag) so "in <Place>" needs a capitalised place, and a
   hyphen before it ("digital-born") does not count. */
const BORN_WORD = "(?:[Bb]orn|BORN|[Gg]eboren|GEBOREN|[Gg]eb\\.|[Nn]ée?|NÉE?|[Nn]acid[oa]|NACID[OA]|[Nn]at[oa]|[Jj]ahrgang|JAHRGANG|[Jj]g\\.|مواليد|ولد|ولدت)";
const BORN_PLACE = "(?:\\s+(?:in|at|en|in der|à)\\s+(?:the\\s+)?\\p{Lu}[\\p{L}'’.-]*(?:\\s+\\p{Lu}[\\p{L}'’.-]*){0,2}\\s*,?)?";
const BORN_PREP = "(?:\\s*[:,]?\\s*(?:on|in|am|im|le|en|el|il|the|عام|سنة|في)(?![\\p{L}])){0,2}";
const BORN_RE = new RegExp(`(?:^|[^\\p{L}\\-‐])(${BORN_WORD}${BORN_PLACE}${BORN_PREP}\\s*:?\\s*${DOB_DATE})`, "gu");
/* "1972-born". */
const YEAR_BORN_RE = /(?:^|[^\p{L}\p{N}])((?:19|20)\d{2}[-‐]born)(?![\p{L}])/gu;
/* "Beirut-born": a place of birth. A demonym before it is a nationality ("Lebanese-born"),
   a lower-case word a kind of thing ("digital-born"); a few capitalised words are no place. */
const PLACE_BORN_RE = /(?:^|[^\p{L}\p{N}\-‐])((\p{Lu}[\p{L}'’]*)[-‐]born)(?![\p{L}])/gu;
const NOT_PLACE = new Set(["first", "native", "natural", "free", "high", "well", "still"]);
/* "Born in Beirut" with no date: a place of birth. */
const BIRTHPLACE_RE = /(?:^|[^\p{L}\-‐])((?:[Bb]orn|BORN|[Gg]eboren|GEBOREN|[Nn]ée?|NÉE?|[Nn]acid[oa])(?:\s+(?:and|&)\s+raised|\s+und\s+aufgewachsen)?\s+(?:in|at|en|à|in der)\s+(?:the\s+)?(\p{Lu}[\p{L}'’.-]*)(?:\s+\p{Lu}[\p{L}'’.-]*){0,2})/gu;
/* Arabic has no capitals: "ولد في بيروت", "مواليد بيروت". */
const AR_BIRTHPLACE_RE = /(?:^|[^\p{L}])((?:ولد|ولدت)\s+في\s+(\p{L}+)|مواليد\s+(\p{L}+))/gu;
const AR_NOT_PLACE = new Set(["عام", "سنة", "العام"]);
/* "a retail brand born in 2015", "The company, born in Dubai": the birth of a company or a product. */
const BORN_SUBJ = /(?:^|[^\p{L}])(?:compan(?:y|ies)|brands?|products?|apps?|start-?ups?|business(?:es)?|firms?|ventures?|platforms?|agenc(?:y|ies)|labels?|projects?|ideas?|concepts?|initiatives?|unternehmen|marke|firma|produkt|entreprise|marque|empresa|marca)\s*(?:,\s*|\s+(?:(?:that|which|die|das|der)\s+)?(?:was|is|wurde|ist)\s+|\s+)$/iu;
const THING_AFTER = /^\s+(?:compan|brands?|products?|apps?|start-?ups?|business|firms?|ventures?|platforms?|agenc|labels?|projects?)/iu;
/* Ages. "Age: 45" is a label; "aged 45", "45 years old", "j'ai 45 ans" are statements.
   A bare "20 ans" or "15 años" in running text is a length of experience, never an age. */
const AGE_LABEL_RE = /(?:^|[^\p{L}])((?:age|alter|âge|edad|età|العمر)\s*:\s*\d{2})(?!\d)/giu;
const AGE_RE = /(?:^|[^\p{L}\d])((?:aged?|âgée?\s+de|agée?\s+de|alter|edad|età)\s+\d{2}(?!\d|\s*[-‐–]\s*\d)|\d{2}(?:\s+|[-‐])(?:years?(?:\s+|[-‐])old|years of age|jahre alt)|(?:j['’]ai|tengo|ho|ich bin)\s+\d{2}\s+(?:ans|años|anni|jahre)(?:\s+alt)?)(?![\p{L}\d])/giu;
/* In a header a segment that is only "45 ans" is an age. */
const AGE_SEG_RE = /^\s*(\d{2}\s+(?:ans|años|anni|jahre))\s*$/iu;

/* ---------- demonyms ---------- */

const MCACHE = new Map();
/* Every item a list of nationalities or languages can hold, as one regex:
   group 1 a demonym, group 2 a language-only name, group 3 a masked span. */
function itemRe(extra) {
  const key = extra.join("|");
  if (MCACHE.has(key)) return MCACHE.get(key);
  const alt = (l) => [...new Set(l)].sort((a, b) => b.length - a.length).map((w) => escRe(w).replace(/\s+/g, "\\s+")).join("|");
  const re = new RegExp(`(${alt([...DEMONYMS, ...extra])})|(${alt(LANGS)})|(_+)`, "giu");
  if (MCACHE.size > 50) MCACHE.clear();
  MCACHE.set(key, re);
  return re;
}
/* What joins two list items: "&", "/", ",", "-", "and", "und", "et", "y", or nothing but space. */
const SEP_FULL = /^(?:\s*(?:&|\+|\/|,|-|‐)\s*(?:(?:and|und|et|y|e|or|oder|ou|o)\s+)?|\s+(?:and|und|et|y|e|or|oder|ou|o)\s+|\s*)$/iu;

/* The stored nationality's own words that no list holds but read as one ("Ruritanian"). */
function storedTokens(nat) {
  const out = [];
  for (const w of low(nat).match(/\p{L}[\p{L}\p{M}'’-]*/gu) || []) {
    if (DEMONYMS.includes(w)) continue;
    if (w.length >= 4 && /(?:ian|ese|ish|ean|ani|i|ic|ch|ss|ot|kh|ek)$/u.test(w) && !["passport", "citizen", "dual", "national"].includes(w)) out.push(w);
  }
  return out;
}

/* How the words after a demonym (or a list of them) read. */
function classifyAfter(after, runCap, zone) {
  let a = after;
  const hy = /^[-‐](\p{L}+)/u.exec(a);
  if (hy) {
    const w = low(hy[1]);
    if (["born", "bürtig", "stämmig", "origin"].includes(w)) return "self";
    a = a.slice(hy[0].length);                      // "German-owned company": a compound modifier
  }
  if (ALONE.test(a)) return "self";
  const re = /(\p{L}[\p{L}\p{M}'’&-]*)|(\d+)|([,.;:!?()|·•–—/])/gu;
  let m, i = 0, field = false;
  while ((m = re.exec(a)) && i < 4) {
    if (!m[1]) break;
    const tok = m[1], w = low(tok).replace(/['’]s$/u, "");
    /* After a field word, a person noun makes a job title; another field or FIELD_JOIN carries on. */
    if (field) {
      if ((PERSON.has(w) && !ORIGIN.has(w)) || FIELD_PERSON.has(w)) return "self";
      if (!FIELD.has(w) && !FIELD_JOIN.has(w)) break;
      i++;
      continue;
    }
    if (i === 0 && STOP_FIRST.has(w) && /^\s/u.test(a)) return "self";
    if (FIELD.has(w) && !hy) { field = true; i++; continue; }
    if (THING.has(w) || THING.has(w.split(/[-‐]/).pop())) return "market";
    if (PERSON.has(w)) return "self";
    /* Running text: a capitalised word right after names something ("American Express", "Christian Dior"). */
    if (i === 0 && zone !== "header" && runCap && /^\p{Lu}/u.test(tok)) return "market";
    if (i > 0 && STOP_ANY.has(w)) break;
    i++;
  }
  return field ? "market" : "unknown";
}

/**
 * Every demonym in a text with how it is used. Items joined by "&", "and", ","
 * are read as one list ("German, Austrian and Swiss operations"), and masked
 * places count as items ("German & GCC markets").
 */
export function demonymUses(text, opts = {}) {
  const t0 = str(text);
  const t = maskSpans(maskSpans(t0, opts.mask), DEMONYM_PLACES(t0));
  const re = itemRe(storedTokens(opts.nationality));
  const items = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(t))) {
    const s = m.index, e = s + m[0].length;
    if (!m[0].length) { re.lastIndex = s + 1; continue; }
    if (!m[3] && !bound(t, s, e)) { re.lastIndex = s + 1; continue; }
    items.push({ start: s, end: e, word: t0.slice(s, e), type: m[1] ? "dem" : m[2] ? "lang" : "mask" });
  }
  /* Items joined by separators form one list. */
  const runs = [];
  for (const it of items) {
    const last = runs[runs.length - 1];
    if (last && SEP_FULL.test(t.slice(last[last.length - 1].end, it.start))) last.push(it); else runs.push([it]);
  }
  const out = [];
  for (const run of runs) {
    const dems = run.filter((x) => x.type === "dem");
    if (!dems.length) continue;
    const before = t.slice(0, run[0].start), after = t.slice(run[run.length - 1].end);
    let use;
    if (NAT_LABEL_BEFORE.test(before)) use = "labelled";
    else if (run.some((x) => x.type === "lang") || LANG_BEFORE.test(before) || LANG_AFTER.test(after)) use = "language";
    else if (WR_BEFORE.test(before) || WR_AFTER.test(after)) use = "workRights";
    else use = classifyAfter(after, /^\p{Lu}/u.test(dems[0].word), opts.zone);
    if (use === "unknown" && SELF_BEFORE.test(before)) use = "self";
    for (const d of dems) out.push({ start: d.start, end: d.end, word: d.word, use });
  }
  return out;
}

/* ---------- the scan ---------- */

const hit = (kind, t, s, e, label) => ({ kind, label: !!label, text: t.slice(s, e), index: s, dismissable: !label });

/* A "born" statement about a company or an employer, not the candidate. */
function aboutCompany(before, employers) {
  if (BORN_SUBJ.test(before)) return true;
  const pre = before.replace(/\s*(?:,|\s(?:(?:that|which)\s+)?(?:was|is))?\s*$/iu, "");
  return employers.some((n) => low(pre).endsWith(low(n)) && bound(pre, pre.length - n.length, pre.length));
}

/** Every printed personal detail in one text field. See the header. */
export function findPersonalData(text, opts = {}) {
  const t = asciiDigits(str(text));
  if (!t.trim()) return [];
  const header = opts.zone === "header";
  const employers = (opts.employers || []).map(str).map((x) => x.trim()).filter(Boolean);
  const out = [];
  const scan = (re, fn) => { re.lastIndex = 0; let m; while ((m = re.exec(t))) { fn(m); if (!m[0].length) re.lastIndex++; } };
  const g1 = (m) => [m.index + m[0].length - m[1].length, m.index + m[0].length];

  /* Labels. */
  for (const L of LABELS) for (const h of L.m(t)) {
    const colon = /^\s*:/.test(t.slice(h.end));
    if (L.colon && !colon) continue;
    if (L.textColon && !header && !colon && !(LABEL_OPENS.test(t.slice(0, h.start)) && PLACE_NEXT.test(t.slice(h.end)))) continue;
    let end = h.end;
    /* "Date of birth: 12 March 1975", "Marital status: married" are one statement each. */
    const d = L.kind === "dob" ? new RegExp(`^\\s*[:\\-–]?\\s*${DOB_DATE}`, "u").exec(t.slice(end)) : /^\s*:[^|·,;/—–•\n]*/u.exec(t.slice(end));
    if (d) end += d[0].replace(/\s+$/u, "").length;
    out.push(hit(L.kind, t, h.start, end, true));
  }

  /* Nationality. */
  const wrOk = header && opts.workRights;
  for (const d of demonymUses(t, opts)) {
    const flag = header ? d.use === "self" || d.use === "unknown" || (d.use === "workRights" && !wrOk) : d.use === "self" || d.use === "workRights";
    if (flag) out.push(hit("nationality", t, d.start, d.end));
  }

  /* Religion, read like a demonym: "Christian" alone is a self-description, "Christian Dior" a name. */
  const rt = maskSpans(t, opts.mask);
  for (const h of RELIGION(rt)) {
    if (RELIGION_LABEL_BEFORE.test(rt.slice(0, h.start))) continue;
    const use = classifyAfter(rt.slice(h.end), /^\p{Lu}/u.test(h.word), opts.zone);
    if (use === "self" || (header && use === "unknown")) out.push(hit("religion", t, h.start, h.end));
  }

  /* Date of birth: "born" + a date or a year, never about a company. */
  scan(BORN_RE, (m) => { const [s, e] = g1(m); if (!aboutCompany(t.slice(0, s), employers)) out.push(hit("dob", t, s, e)); });
  scan(YEAR_BORN_RE, (m) => { const [s, e] = g1(m); if (!THING_AFTER.test(t.slice(e))) out.push(hit("dob", t, s, e)); });

  /* Place of birth with no date. */
  scan(BIRTHPLACE_RE, (m) => {
    const [s, e] = g1(m);
    if (MONTH_SET.has(low(m[2])) || aboutCompany(t.slice(0, s), employers)) return;
    const d = new RegExp(BORN_RE.source, "gu");
    d.lastIndex = Math.max(0, s - 1);
    const x = d.exec(t);
    if (x && x.index + x[0].length - x[1].length === s) return;   // "Born in Beirut in 1975" is a date of birth
    out.push(hit("birthplace", t, s, e));
  });
  scan(PLACE_BORN_RE, (m) => {
    const w = low(m[2]), [s, e] = g1(m);
    if (DEMONYMS.includes(w) || storedTokens(opts.nationality).includes(w) || NOT_PLACE.has(w) || MONTH_SET.has(w) || THING_AFTER.test(t.slice(e))) return;
    out.push(hit("birthplace", t, s, e));
  });
  scan(AR_BIRTHPLACE_RE, (m) => {
    const w = m[2] || m[3];
    if (AR_NOT_PLACE.has(w) || MONTH_SET.has(w)) return;
    const [s, e] = g1(m);
    out.push(hit("birthplace", t, s, e));
  });

  /* Age. */
  scan(AGE_LABEL_RE, (m) => { const [s, e] = g1(m); out.push(hit("age", t, s, e, true)); });
  scan(AGE_RE, (m) => { const [s, e] = g1(m); out.push(hit("age", t, s, e)); });

  /* Header segments: a bare age, a bare marital status, a count of children, a full date. */
  if (header) {
    const re = /[^|·,;/—–•]+/g;
    let m;
    while ((m = re.exec(t))) {
      const seg = m[0].replace(/^[^:]*:/, ""), off = m.index + (m[0].length - seg.length);
      const w = seg.trim(), s = off + seg.indexOf(w);
      if (MARITAL_WORDS.has(low(w))) out.push(hit("marital", t, s, s + w.length));
      const a = AGE_SEG_RE.exec(seg);
      if (a) out.push(hit("age", t, s, s + a[1].length));
    }
    scan(CHILDREN_RE, (m) => { const [s, e] = g1(m); out.push(hit("marital", t, s, e)); });
    scan(FULL_DATE, (m) => out.push(hit("date", t, m.index, m.index + m[0].length)));
  } else {
    scan(MARITAL_SELF, (m) => { const [s, e] = g1(m); out.push(hit("marital", t, s, e)); });
    scan(MARITAL_ALONE, (m) => { const [s, e] = g1(m); out.push(hit("marital", t, s, e)); });
  }

  /* Health conditions, anywhere. */
  for (const h of HEALTH(t)) out.push(hit("health", t, h.start, h.end));

  /* One statement, one hit: a label wins over what it labels; a date inside a
     date-of-birth or age statement is that statement. */
  const kept = [];
  const over = (a, b) => a.index < b.index + b.text.length && b.index < a.index + a.text.length;
  for (const h of out.slice().sort((a, b) => (b.label - a.label) || (a.kind === "date") - (b.kind === "date") || a.index - b.index)) {
    if (kept.some((k) => over(k, h) && (k.kind === h.kind || h.kind === "date" || (k.label && k.kind === "dob" && h.kind === "age")))) continue;
    kept.push(h);
  }
  return kept.sort((a, b) => a.index - b.index || b.text.length - a.text.length);
}

/* Kinds in the order a reader meets them. */
export const KINDS = ["nationality", "dob", "age", "date", "birthplace", "religion", "marital", "health"];
