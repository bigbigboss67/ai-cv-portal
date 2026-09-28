/**
 * Pull the application address off a live job posting.
 *
 * A static page cannot read a third-party site directly — the browser's
 * same-origin policy forbids it — so this goes through a public read proxy that
 * returns the page as text with permissive CORS headers. That means the posting
 * URL is handed to that service. It is a public job ad, so the exposure is the
 * URL itself and nothing of his, but the UI says so rather than doing it quietly.
 *
 * Nothing here guesses. If the posting does not print an address, the answer is
 * "none found" — a plausible invented address looks valid, passes every check,
 * and sends the application nowhere.
 */

import { postingAddresses, websiteOf, companyUrl } from "./linkedin-company.js";
import { mailboxKind, cleanAddress } from "./mailbox-kind.js";
export { mailboxKind };

export const READERS = [
  { name: "r.jina.ai", build: (u) => "https://r.jina.ai/" + u },
  { name: "allorigins", build: (u) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u) },
];

export const MAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/* Addresses that are never a recruiter: asset filenames, tracking and CDN hosts,
   and the placeholder domains reserved by RFC 2606. */
export const JUNK_LOCAL = /^(no-?reply|do-?not-?reply|postmaster|abuse|webmaster|privacy|dpo|datenschutz)$/i;
export const JUNK_TAIL = /\.(png|jpe?g|gif|svg|webp|css|js|woff2?|ico)$/i;
export const JUNK_HOST = /(example\.(com|org|net)|test\.com|sentry\.io|wixpress\.com|cloudflare|googleapis|gstatic|jsdelivr|unpkg|w3\.org|schema\.org|\.png|\.jpg)/i;

/* What an application address actually looks like, in both languages. */
const PREFERRED = /^(bewerbung(en)?|karriere|job(s)?|career(s)?|hr|personal(abteilung)?|recruit\w*|talent|apply|application|stellen|hiring)$/i;

/* Three kinds of mailbox — application, general, never — judged in mailbox-kind.js,
   which the server shares. */

/* Where a site sends applicants when it prints no address: its own careers page, or
   the applicant-tracking system it uses. Read from the links on a page (HTML or a
   reader's text rendering of it). */
const ATS_HOST = /(^|\.)(lever\.co|greenhouse\.io|myworkdayjobs\.com|workday\.com|smartrecruiters\.com|bamboohr\.com|recruitee\.com|personio\.(de|com)|workable\.com|teamtailor\.com|jobvite\.com|icims\.com|successfactors\.(com|eu)|taleo\.net|breezy\.hr|jazzhr\.com|ashbyhq\.com|zohorecruit\.com)$/i;
const CAREERS_PATH = /\/(careers?|jobs|karriere|stellen(angebote)?|join-us|work-with-us|vacanc\w*|opportunities|emplois?|empleo)(\/|$|\?)/i;
export function careersLink(text, base) {
  const b = usable(base);
  const origin = b ? b.origin : "";
  /* The company's own site: www or not, and its subdomains ("careers.acme.com"). */
  const site = b ? b.hostname.replace(/^www\./, "") : "";
  const mine = (u) => !!site && (u.hostname.replace(/^www\./, "") === site || u.hostname.endsWith("." + site));
  const links = [...String(text || "").matchAll(/https?:\/\/[^\s"'<>()\]]+|href="(\/[^"#]*)"|\]\((\/[^)\s]*)\)/g)]
    .map((m) => { try { return new URL(m[1] || m[2] || m[0], origin || undefined); } catch { return null; } })
    .filter(Boolean);
  /* An application system counts only when it carries the company's name
     ("mercans.bamboohr.com", "boards.greenhouse.io/acme"): a page can link another
     company's board, and sending a candidate there is worse than sending them nowhere. */
  const name = site.split(".")[0];
  /* The name as a whole label or path segment ("acme.bamboohr.com", "/acme"); as the
     start of one only when it is four letters or more — "abc" is inside "abcdnetwork". */
  const carries = (u) => [...u.hostname.toLowerCase().split("."), ...u.pathname.toLowerCase().split("/")]
    .some((b) => b && (b === name || b.replace(/[-_]/g, "") === name || (name.length >= 4 && b.startsWith(name))));
  const ats = links.find((u) => ATS_HOST.test(u.hostname) && (!name || carries(u)));
  if (ats) return ats.href;
  const own = links.find((u) => mine(u) && (CAREERS_PATH.test(u.pathname + "/") || /^(careers?|jobs|karriere|stellen)\./i.test(u.hostname)));
  return own ? own.href : "";
}

function usable(url) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch { return null; }
}

/** Rank: role mailbox first, then same-domain as the posting, then the rest. */
function rank(list, host) {
  const bare = String(host || "").replace(/^www\./, "");
  return list
    .map((a) => {
      const [local, domain] = a.split("@");
      let score = 0;
      if (PREFERRED.test(local)) score += 10;
      if (bare && domain.toLowerCase().endsWith(bare.toLowerCase())) score += 5;
      if (/@(gmail|gmx|web|yahoo|hotmail|outlook)\./i.test(a)) score -= 3;
      return { a, score };
    })
    .sort((x, y) => y.score - x.score)
    .map((x) => x.a);
}

export function harvest(text, host) {
  const seen = new Set();
  for (const raw of String(text).match(MAIL) || []) {
    const a = cleanAddress(raw);
    const [local, domain] = a.split("@");
    if (!domain || JUNK_TAIL.test(a) || JUNK_HOST.test(a)) continue;
    if (JUNK_LOCAL.test(local)) continue;
    seen.add(a);
  }
  return rank([...seen], host);
}

/* International numbers only: a "+" or "00" prefix, then digits with the
   separators people type. A bare digit run is as likely a date, a job ID or a
   postcode, so it is never taken. The run stays on its own line: a copyright
   year or a company number printed under a phone number in a footer would
   otherwise be swallowed into it, and the result is a number nobody printed.
   "Any space except a line break" (form feed and vertical tab count as breaks)
   rather than a plain space, because sites keep a number on one line with
   non-breaking or thin spaces. */
const PHONE_RUN = /(?:tel:)?(?:\+|(?<!\d)00)\d(?:(?:[\d().\/-]|[^\S\r\n\f\v\u2028\u2029])*\d)?/gi;

const phoneKey = (v) => v.replace(/^00/, "").replace(/\D/g, "");
const phoneDigits = (v) => v.replace(/^(\+|00)/, "").replace(/\D/g, "").length;

/**
 * Phone numbers printed on a page, in order, one per number.
 * A printed number comes back as printed (runs of spaces collapsed); a tel: link
 * comes back as written in the link.
 * @returns {string[]}
 */
export function harvestPhones(text) {
  const out = [];
  const keys = new Set();
  for (const raw of String(text).match(PHONE_RUN) || []) {
    // Two numbers written "A / B" or "A; B" arrive as one run; split them again.
    const parts = phoneDigits(raw.replace(/^tel:/i, "")) > 15 ? raw.split(/\s+\/\s+|\s*;\s*/) : [raw];
    for (const part of parts) {
      const v = part.replace(/^tel:/i, "").replace(/\s+/g, " ").trim();
      if (!/^(\+|00)\d/.test(v)) continue;
      const n = phoneDigits(v);
      if (n < 8 || n > 15) continue;
      const key = phoneKey(v);
      if (keys.has(key)) continue;
      keys.add(key);
      out.push(v);
    }
  }
  return out;
}

/** One page through the readers; the first reader that answers wins. */
async function readPage(url) {
  let lastErr = "";
  for (const r of READERS) {
    try {
      const res = await fetch(r.build(url), { redirect: "follow" });
      if (!res.ok) { lastErr = r.name + " returned " + res.status; continue; }
      const text = await res.text();
      if (!text || text.length < 40) { lastErr = r.name + " returned an empty page"; continue; }
      return { ok: true, text, via: r.name };
    } catch (err) {
      lastErr = r.name + ": " + String((err && err.message) || err);
    }
  }
  return { ok: false, error: lastErr };
}

/**
 * @param {string} url  the job posting
 * @returns {Promise<{ok:boolean, addresses:string[], via?:string, host?:string, error?:string}>}
 */
export async function fetchAddresses(url) {
  const u = usable(url);
  if (!u) return { ok: false, addresses: [], error: "That is not a valid http(s) link." };

  const page = await readPage(u.href);
  if (!page.ok) return { ok: false, addresses: [], error: page.error || "Could not read the posting." };
  return { ok: true, addresses: harvest(page.text, u.host), via: page.via, host: u.host };
}

/**
 * Widen the search past the posting itself.
 *
 * Most corporate postings route through an apply form and print no address, but
 * the company's own careers, contact or Impressum page usually does. These are
 * real pages that get read — the alternative people reach for is building
 * careers@<company> from the name, which is exactly the failure this avoids.
 *
 * Each page costs a proxy round-trip, so it stops at the first page that yields
 * anything and never walks more than `limit` pages.
 *
 * @param {{postingUrl?:string, siteUrl?:string, limit?:number,
 *          onStep?:(msg:string)=>void}} opt
 * `tried` is every page asked for; `read` the ones that actually answered.
 * @returns {Promise<{ok:boolean, addresses:string[], from?:string, tried:string[], read:string[]}>}
 */
export async function findApplicationAddress(opt = {}) {
  const { postingUrl, siteUrl, limit = 5, onStep } = opt;
  const pages = [];
  const push = (u) => { if (u && !pages.includes(u)) pages.push(u); };

  push(postingUrl);
  /* Company pages that conventionally carry a recruiting mailbox, English and German.
     The homepage comes third: it is the one page every site has, and it links to the
     careers page or the application system when no page prints an address. */
  const base = usable(siteUrl) || usable(postingUrl);
  if (base) {
    for (const p of ["/careers", "/jobs", "/", "/contact", "/contact-us", "/impressum", "/kontakt", "/career"]) {
      push(base.origin + p);
    }
  }

  /* An application mailbox ends the search. A general one is remembered and offered
     at the end, labelled; one never meant for a CV is dropped. */
  const tried = [], read = [], general = [];
  let careers = "";
  for (const url of pages.slice(0, limit)) {
    if (onStep) onStep(url);
    tried.push(url);
    const u = usable(url);
    const page = u ? await readPage(u.href) : { ok: false };
    if (!page.ok) continue;
    read.push(url);
    if (!careers) careers = careersLink(page.text, url);
    const found = harvest(page.text, u.host);
    /* On the posting itself, an address printed next to "send your CV" is the
       application address whatever its name. */
    const said = url === postingUrl ? postingAddresses(page.text).apply : [];
    const apply = found.filter((a) => mailboxKind(a) === "apply" || (said.includes(a) && mailboxKind(a) !== "never"));
    if (apply.length) return { ok: true, addresses: apply, from: url, tried, read, general, careers };
    for (const a of found) if (mailboxKind(a) === "general" && !general.includes(a)) general.push(a);
  }
  return { ok: false, addresses: [], tried, read, general, careers };
}

/**
 * The website a LinkedIn company page lists, read through the page readers — the
 * portal's way round when LinkedIn turns the server away.
 */
export async function siteFromLinkedInCompany(slug) {
  const url = companyUrl(slug);
  if (!url) return "";
  const page = await readPage(url);
  return page.ok ? websiteOf(page.text) : "";
}

/**
 * Contact details a source prints on its own website: every email and phone
 * number found, each with the page it was printed on.
 *
 * Reads the given page, then the site's contact, Impressum, careers and about
 * pages, and stops after the first page that prints an email. LinkedIn is not
 * read at all — it blocks every reader — and nothing is ever constructed.
 *
 * @param {{siteUrl?:string, limit?:number, onStep?:(url:string)=>void}} opt
 * @returns {Promise<{ok:boolean, emails:{value:string, from:string}[],
 *          phones:{value:string, from:string}[], tried:string[],
 *          blocked?:boolean, error?:string}>}
 */
export async function findContact(opt = {}) {
  const { siteUrl, limit = 6, onStep } = opt;
  const base = usable(siteUrl);
  if (!base) return { ok: false, emails: [], phones: [], tried: [], error: "That is not a valid http(s) link." };
  const host = base.hostname.replace(/^www\./, "").toLowerCase();
  if (host === "linkedin.com" || host.endsWith(".linkedin.com")) {
    return { ok: false, blocked: true, emails: [], phones: [], tried: [] };
  }

  const pages = [];
  const push = (u) => { if (!pages.includes(u)) pages.push(u); };
  push(base.href);
  for (const p of ["/contact", "/contact-us", "/kontakt", "/impressum", "/careers", "/about"]) push(base.origin + p);

  const emails = [], phones = [], tried = [];
  let read = 0, lastErr = "";
  for (const url of pages.slice(0, limit)) {
    if (onStep) onStep(url);
    tried.push(url);
    const page = await readPage(url);
    if (!page.ok) { lastErr = page.error; continue; }
    read += 1;
    for (const value of harvest(page.text, base.host)) {
      if (!emails.some((e) => e.value === value)) emails.push({ value, from: url });
    }
    for (const value of harvestPhones(page.text)) {
      if (!phones.some((p) => phoneKey(p.value) === phoneKey(value))) phones.push({ value, from: url });
    }
    if (emails.length) break;
  }
  if (!read) return { ok: false, emails, phones, tried, error: lastErr || "Could not read the site." };
  return { ok: true, emails, phones, tried };
}
