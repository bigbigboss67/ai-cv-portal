/**
 * A board title is not a job title, and a poster is not always the employer.
 *
 * Job boards print the whole ad in the title line: the role, the sector, the
 * location, the gender marker, and the screening criteria. Taken literally, a CV
 * headline ends up reading "General Manager (P&L) – Oilfield Engineering,
 * Manufacturing & Services (Oil & Gas) (Upstream)", and a covering letter opens
 * "regarding the MD - Investments (UAE National) position".
 *
 * Nothing here is thrown away. What comes off the title comes back as `context`
 * (what the role covers) or `qualifiers` (what the posting demands of the
 * applicant), and the portal shows the qualifiers where a screening criterion
 * belongs — in the review, not in the headline.
 *
 * Pure: no DOM, no network, so the Node tests run what the page runs.
 */

/* The gender markers a German or Austrian ad is required to print, and their
   English hybrids. They say nothing about the job. */
const GENDER = /\s*[([]?\s*\b(m\s*\/\s*w\s*\/\s*d|w\s*\/\s*m\s*\/\s*d|d\s*\/\s*m\s*\/\s*w|m\s*\/\s*f\s*\/\s*d|m\s*\/\s*f\s*\/\s*x|f\s*\/\s*m\s*\/\s*d|all genders|m\/f)\b\s*[)\]]?/gi;

/* What the posting demands of the applicant. These are real requirements and
   they matter — they are simply not part of the role's name. */
const QUALIFIER = [
  [/\b(uae|emirati|saudi|qatari|kuwaiti|bahraini|omani|gcc)\s+nationals?\b/gi, (m) => m.trim()],
  [/\b(emirati|emiratis)\b(?!\s*\w)/gi, () => "Emirati national"],
  [/\b(arabic|german|french|spanish|mandarin|russian|english)[- ]speak(?:er|ing)s?\b/gi, (m) => m.trim()],
  [/\bnative\s+(arabic|german|french|english)\s+speakers?\b/gi, (m) => m.trim()],
  [/\bbilingual\b/gi, () => "Bilingual"],
  [/\b(female|male)\s+(?:candidates?|applicants?|only)\b/gi, (m) => m.trim()],
  [/\bimmediate\s+join(?:er|ing)\b/gi, () => "Immediate joiner"],
  [/\bown\s+visa\b/gi, () => "Own visa"],
];

/* Board chrome: urgency, application verbs, and the emoji recruiters decorate
   with. None of it describes the work. */
/* Not a bare "immediate": it would eat the first half of "Immediate Joiner" and
   leave "Joiner" behind as if it were the job. */
const NOISE = /\s*[([]?\s*\b(urgent(?:ly)?(?: hiring| required)?|hiring now|we are hiring|now hiring|apply now|hot job|remote ok)\b\s*[)\]]?/gi;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2190}-\u{21FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}️]/gu;

/* A head that names a role can carry the rest as context. Without one of these
   words the split would cut a title in half — "MD - Investments" is the role. */
const ROLE_NOUN = /\b(director|manager|officer|head|lead(?:er)?|chief|president|partner|principal|supervisor|engineer|analyst|consultant|controller|advisor|adviser|executive|specialist|coordinator|administrator|architect|accountant|ceo|cfo|coo|cto|cmo|md|gm|vp)\b/i;

/* Where a title stops being a title. An en dash, an em dash, a spaced hyphen, a
   pipe or a comma — in that order of confidence. */
const SPLIT = /\s+[–—]\s+|\s+-\s+|\s*\|\s*|,\s+/;

/** Past this many characters a title has stopped being a headline. */
export const HEADLINE_MAX = 45;

const tidy = (s) => String(s || "")
  .replace(/\s+/g, " ")
  .replace(/\(\s*\)|\[\s*\]/g, " ")
  .replace(/\s+([,.;:])/g, "$1")
  .replace(/^[\s\-–—|,.:;/]+|[\s\-–—|,.:;/]+$/g, "")
  .replace(/\s+/g, " ")
  .trim();

/**
 * @param {string} raw      the title as the board printed it
 * @param {{company?:string, city?:string}} [opt]
 * @returns {{title:string, context:string, qualifiers:string[], raw:string}}
 */
export function roleTitle(raw, opt = {}) {
  const original = String(raw == null ? "" : raw).replace(/\s+/g, " ").trim();
  let s = original.replace(EMOJI, " ");
  const qualifiers = [];

  s = s.replace(GENDER, " ");
  s = s.replace(NOISE, " ");
  for (const [rx, label] of QUALIFIER) {
    s = s.replace(rx, (m) => {
      const q = label(m);
      if (q && !qualifiers.some((x) => x.toLowerCase() === q.toLowerCase())) qualifiers.push(q);
      return " ";
    });
  }

  /* The poster's own name and the city, tacked onto the end. "General Manager -
     ISBA by Bagatelle" keeps its tail: only an exact echo of the company or the
     city comes off. */
  const city = String(opt.city || "").trim();
  const tails = [opt.company, city, ...city.split(",")]
    .map((w) => String(w || "").trim())
    .filter((w) => w.length >= 3);
  /* "Finance Director | Dubai, United Arab Emirates" sheds its location one
     segment at a time, so the pass repeats until nothing more comes off. */
  for (let pass = 0; pass < 3; pass++) {
    const before = s;
    for (const w of tails) {
      const rx = new RegExp("\\s*[-–—|,]\\s*" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*$", "i");
      s = s.replace(rx, "");
    }
    if (s === before) break;
  }

  s = tidy(s);

  /* Still a paragraph? Keep the head that names the role and hand the rest to
     context, where the sector and the scope can be read without crowding the
     headline. */
  let context = "";
  if (s.length > HEADLINE_MAX) {
    const m = SPLIT.exec(s);
    if (m && m.index > 1) {
      const head = tidy(s.slice(0, m.index));
      const rest = tidy(s.slice(m.index + m[0].length));
      if (ROLE_NOUN.test(head) && head.length >= 3 && rest) {
        s = head;
        context = rest;
      }
    }
  }

  return { title: s || original, context, qualifiers, raw: original };
}

/* Agencies, and the word a posting uses when the employer will not be named.
   Applying "to" an agency is wrong; applying "via" one is not.

   Only words that mean recruiting. Bare "consulting", "search", "talent" and
   "selection" are ordinary employer names — Boston Consulting Group, Google
   Search, Selection Foods — and consulting firms are a core employer class for a
   senior profile. The cost is accepted: a recruiter whose name says only
   "Consult" (Big Fish Consult) now reads as an employer. */
const AGENCY = /\b(recruit\w*|staffing|manpower|resourcing|headhunt\w*|personnel (?:services|agency)|executive search|search (?:firm|partners|consultants|company)|talent (?:acquisition|solutions|partners)|hr solutions|hr consultancy|employment agency|agency|partners in hr)\b/i;
/* Not "private": Private Equity Partners is an employer. */
const NAMELESS = /^(confidential|undisclosed|not disclosed|company confidential|a leading \w+|our client)\b/i;

/* The daily fetcher writes "via X" when an agency or a board posted the job
   without naming the employer (scripts/fetch-listings.mjs). "via Departer — The
   German Headhunter" is the agency Departer; "via ae.indeed.com" and "via open
   web search" name only where the listing was found, which is nobody. */
const VIA_PREFIX = /^via(?:\s+|$)/i;
const TAGLINE = /\s+[—–|]\s+/;
const HOSTNAME = /^[^\s]+\.[^\s]+$/;

function readPoster(company) {
  const c = String(company || "").replace(/\s+/g, " ").trim();
  if (!c) return { kind: "unknown", name: "" };
  if (VIA_PREFIX.test(c)) {
    const name = c.replace(VIA_PREFIX, "").split(TAGLINE)[0].trim();
    if (!name || HOSTNAME.test(name) || /^open web search$/i.test(name)) return { kind: "nameless", name: "" };
    return { kind: "agency", name };
  }
  if (NAMELESS.test(c)) return { kind: "nameless", name: "" };
  if (AGENCY.test(c)) return { kind: "agency", name: c };
  return { kind: "employer", name: c };
}

/**
 * Who posted it.
 *
 * @returns {"employer"|"agency"|"nameless"|"unknown"}
 */
export function posterKind(company) {
  return readPoster(company).kind;
}

/**
 * The name to print wherever the page names the poster — recipient block, CV
 * caption, salutation: the agency's name for an agency, the company for an
 * employer, and nothing for a posting that names nobody.
 */
export function employerDisplay(company) {
  return readPoster(company).name;
}

/**
 * How the employer is named in a sentence, per language.
 *
 * An agency is written "via X" because the letter is not addressed to it, and a
 * posting that withholds the employer names nobody rather than inventing one.
 */
export function employerPhrase(company, lang = "en") {
  const { kind, name: c } = readPoster(company);
  if (kind === "unknown" || kind === "nameless") return { kind, name: "", at: "", via: "" };
  const AT = { en: " at ", de: " bei ", fr: " chez ", es: " en ", ar: " لدى " };
  const VIA = { en: " via ", de: " über ", fr: " via ", es: " a través de ", ar: " عبر " };
  const word = (kind === "agency" ? VIA : AT)[lang] || (kind === "agency" ? VIA.en : AT.en);
  return { kind, name: c, at: word + c, via: (VIA[lang] || VIA.en) + c };
}
