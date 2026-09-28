/**
 * A company's own website, as the company itself lists it on LinkedIn.
 *
 * A job found on LinkedIn names its employer but links only to LinkedIn. The
 * public ("guest") posting links to the company's LinkedIn page, and that page's
 * About block carries the website the company entered itself. That is a better
 * answer than any search: the company chose it. Read on the owner's decision of
 * 24 Sep 2026, knowing LinkedIn's robots.txt asks automated readers to stay out;
 * the portal already reads its guest job search the same way.
 *
 * Pure: no network. api/site.js fetches the pages on the server; the portal falls
 * back to its page reader when LinkedIn turns the server away. Nothing here ever
 * builds an address or a website from a name.
 */

import { mailboxKind, cleanAddress } from "./mailbox-kind.js";

export const POSTING = "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/";
export const COMPANY = "https://www.linkedin.com/company/";

/* Where a company is not: LinkedIn itself, social networks, link-in-bio pages. */
const NOT_A_SITE = /(^|\.)(linkedin\.com|licdn\.com|lnkd\.in|facebook\.com|fb\.com|instagram\.com|twitter\.com|x\.com|youtube\.com|youtu\.be|tiktok\.com|wa\.me|whatsapp\.com|t\.me|linktr\.ee|linktree\.com|bio\.link|beacons\.ai|lnk\.bio|linkin\.bio|taplink\.cc|carrd\.co|about\.me|google\.com|goo\.gl|bit\.ly)$/i;

/* Numeric entities first ("hr&#64;acme.ae" is an address), "&amp;" last so nothing is decoded twice. */
const decode = (s) => String(s)
  .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");

/**
 * The job's id from a LinkedIn job link ("…/jobs/view/managing-director-at-x-4394152801",
 * "…/jobs/view/4394152801", "…?currentJobId=4394152801") or the id itself.
 */
export function jobIdOf(ref) {
  const s = String(ref || "").trim();
  if (/^\d{6,}$/.test(s)) return s;
  let u;
  try { u = new URL(s); } catch { return ""; }
  if (!/(^|\.)linkedin\.com$/i.test(u.hostname)) return "";
  const q = u.searchParams.get("currentJobId");
  if (q && /^\d{6,}$/.test(q)) return q;
  const m = /\/jobs\/view\/(?:[^/]*?-)?(\d{6,})\/?$/.exec(u.pathname);
  return m ? m[1] : "";
}

/**
 * The company's LinkedIn slug, from a guest posting page: the top card's link to the
 * employer, else the first company link that is not LinkedIn's own. Entities are
 * decoded first — "Ali &amp; Sons" is "ali-&-sons", and stopping at the "&" asked
 * LinkedIn for a company called "ali-".
 */
export function companySlugOf(postingPage) {
  const s = String(postingPage || "");
  /* Read raw and decoded per slug, so an entity inside it ("o&#39;neil-group") stays whole. */
  const links = [...s.matchAll(/linkedin\.com\/company\/((?:&#?\w+;|[^/?#&"'\s<>)\]])+)([^"'\s<>]*)/g)]
    .map((m) => ({ slug: unescapeUrl(decode(m[1])), top: /topcard/i.test(m[2]) }))
    .filter((l) => l.slug && !/^linkedin$/i.test(l.slug));
  const pick = links.find((l) => l.top) || links[0];
  return pick ? pick.slug : "";
}
const unescapeUrl = (x) => { try { return decodeURIComponent(x); } catch { return x; } };

/** The company page for a slug, or "" when it is not one. */
export function companyUrl(slug) {
  const s = String(slug || "");
  if (!s || s.length > 150 || /[/\s]/.test(s)) return "";
  return COMPANY + encodeURIComponent(s);
}

/**
 * The website a guest company page lists, as an origin ("https://mercans.com"), or "".
 * Reads the page's HTML (the About block's website link, which goes through
 * LinkedIn's redirect) and also a reader's text rendering of it ("Website", then
 * the link).
 */
export function websiteOf(companyPage) {
  const s = String(companyPage || "");
  let raw = "";
  const a = /data-tracking-control-name="about_website"[^>]*href="([^"]+)"|href="([^"]+)"[^>]*data-tracking-control-name="about_website"/.exec(s);
  if (a) raw = a[1] || a[2];
  else {
    /* A reader's rendering: "Website" as the label that starts a line, the link right
       after it. Any "website" in running text ("our new website is live: ...") is not it. */
    const m = /(?:^|\n)[ \t#*]*Website[ \t*]*:?[ \t*]*\n*[ \t]*\[?(https?:\/\/[^\s"'<>()\]]+)/i.exec(s);
    if (m) raw = m[1];
  }
  if (!raw) return "";
  let url = decode(raw);
  try {
    const u = new URL(url);
    if (/(^|\.)linkedin\.com$/i.test(u.hostname)) url = u.searchParams.get("url") || "";
  } catch { return ""; }
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol) || NOT_A_SITE.test(u.hostname) || /\.(png|jpe?g|gif|svg|webp|ico)$/i.test(u.pathname)) return "";
    return u.origin;
  } catch { return ""; }
}

const MAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/* The words that make an address the one to send a CV to, in the portal's
   languages. A general inbox (info@, a person's name) needs the strict set in its own
   sentence; "send" and "submit" alone also cover "send us your questions". And the
   words that make an address anything but. */
const APPLY_NEAR = /\b(cv|c\.v\.|resume|résumé|apply|applications?|send|submit|email your|bewerb\w*|lebenslauf|candidature|postuler|curriculum|solicitud|enviar)\b/i;
const APPLY_STRICT = /\b(cv|c\.v\.|resume|résumé|apply|applications?|bewerb\w*|lebenslauf|candidature|postuler|curriculum|solicitud)\b/i;
const NOT_FOR_CVS = /\b(accommodat\w*|reasonable adjustments?|disabilit\w*|fraud\w*|scam\w*|phishing|impersonat\w*|press|media enquir\w*)\b/i;

/* Sentences, for judging what an address is printed next to. A full stop after a
   common abbreviation ("e.g.", "Co. Ltd.", "Mr.") does not end one, and neither does a
   single line break ("send your CV to:<br>hr@..."); a paragraph, a list item or a
   blank line does. */
/* Company suffixes and "etc." are not held: they end a sentence as often as not, and
   holding them let "…Trading LLC. For anything else, write to info@" borrow the CV request. */
const ABBR = /\b(e\.g|i\.e|mr|mrs|ms|dr|st|no|nr|approx|incl|jr|sr|p\.o|dept|tel|ext)\.(?=\s)/gi;
const HOLD = String.fromCharCode(0x2024); // a one-dot leader stands in for the abbreviation's full stop
function sentencesOf(text) {
  return String(text).replace(ABBR, (m) => m.slice(0, -1) + HOLD)
    .split(/\n\s*\n|(?<=[.!?])\s+/)
    .map((s) => s.split(HOLD).join(".").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/**
 * Addresses the posting's own text prints. `apply` holds those whose sentence asks
 * for a CV (and is not an accessibility or fraud notice): a recruiting mailbox may
 * take it from the sentence before, a general one only from its own. `other` holds
 * the rest, never filled in on their own. A mailbox never meant for a CV (sales@,
 * support@, press@) is in neither — a window of characters once reached from
 * "Apply now!" across to "Questions about our products? sales@".
 */
export function postingAddresses(postingPage) {
  const html = String(postingPage || "");
  const body = (/<div class="show-more-less-html__markup[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(html) || [])[1] || html;
  const text = decode(body
    /* A link's address counts as printed: "email <a href="mailto:hr@acme.ae">here</a>". */
    .replace(/<a\b[^>]*href="mailto:([^"?]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi, (m, to, label) => label + " " + to)
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|li|ul|ol|div|h\d|tr)>/gi, "\n\n").replace(/<[^>]+>/g, " ")).replace(/[ \t]+/g, " ");
  const apply = [], other = [];
  const sentences = sentencesOf(text);
  sentences.forEach((own, i) => {
    for (const m of own.matchAll(MAIL)) {
      const a = cleanAddress(m[0]);
      if (/^(no-?reply|do-?not-?reply)@/.test(a) || /@(example|test)\./.test(a)) continue;
      if (apply.includes(a) || other.includes(a)) continue;
      const kind = mailboxKind(a);
      if (kind === "never") continue;
      const near = kind === "apply" ? (sentences[i - 1] || "") + " " + own : own;
      /* The request may come from the sentence before; a notice vetoes only its own. */
      const asks = (kind === "apply" ? APPLY_NEAR : APPLY_STRICT).test(near) && !NOT_FOR_CVS.test(own);
      (asks ? apply : other).push(a);
    }
  });
  return { apply, other };
}
