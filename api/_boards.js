/**
 * Live Internet Job Boards & Zero-Key Vacancy Scrapers
 * Shared by:
 *  - POST /api/match (live multi-source CV + Next Promotion Role job matcher)
 *  - GET  /api/job-detail (on-demand full job posting & email reader)
 *  - scripts/fetch-listings.mjs (daily scheduled GitHub Actions scraper)
 *
 * Includes:
 *  1. LinkedIn Public Guest Search + Guest Job Detail API (no login/key required)
 *  2. Michael Page UAE & GCC (michaelpage.ae)
 *  3. Page Executive — Director / VP / C-Suite (pageexecutive.com)
 *  4. Charterhouse Middle East (charterhouseme.ae)
 *  5. Departer — The German Headhunter Middle East & DACH (careers.departer.de)
 *  6. AHK VAE — German Emirati Joint Council (vae.ahk.de)
 *  7. Arbeitnow Live Public Job API (European / German / Remote roles with full JD)
 *  8. Remotive Live Public Job API (Global / Remote leadership & specialist roles)
 *  9. DuckDuckGo HTML Open-Web Job Search (zero-key fallback when AISA_API_KEY is unset)
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const decode = (s) =>
  String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d));

const text = (html) =>
  decode(String(html || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

const htmlToLines = (html) =>
  decode(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<a\b[^>]*href="mailto:([^"?]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi, (_, to, lbl) => `${lbl} ${to}`)
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|li|ul|ol|div|h\d|tr|section|article)>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, " ")
  )
    .split(/\r?\n/)
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");

const first = (re, s) => {
  const m = re.exec(s);
  return m ? m[1] : "";
};

async function fetchText(url, timeoutMs = 12000) {
  const res = await fetch(url, {
    headers: {
      "user-agent": UA,
      accept: "text/html,application/xhtml+xml,application/json;q=0.9",
      "accept-language": "en-US,en;q=0.9,de;q=0.8",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).hostname}`);
  return res.text();
}

function anchors(html, base) {
  const out = [];
  for (const m of String(html || "").matchAll(/<a\b([^>]*?)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = m[2].trim();
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) continue;
    let abs;
    try {
      abs = new URL(href, base).href;
    } catch {
      continue;
    }
    out.push({ href: abs, text: text(m[4]) });
  }
  return out;
}

/* ---------------------------------------------------------------- 1. LinkedIn Guest Search & Posting Detail */

function linkedInUrl(keywords, location, start = 0) {
  return (
    "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search" +
    `?keywords=${encodeURIComponent(keywords)}&location=${encodeURIComponent(location)}&start=${start}`
  );
}

const LI_VIEW = /href="(https:\/\/(?:[a-z]{2,3}\.|www\.)?linkedin\.com\/jobs\/view\/[^"?#]+)/;

function parseLinkedIn(html) {
  const jobs = [];
  const seen = new Set();
  for (const card of String(html || "").split(/<li\b/).slice(1)) {
    const url = first(LI_VIEW, card);
    const ref = first(/urn:li:jobPosting:(\d+)/, card) || first(/-(\d{6,})$/, url);
    const title = text(first(/<h3[^>]*base-search-card__title[^>]*>([\s\S]*?)<\/h3>/, card));
    if (!url || !ref || !title || seen.has(ref)) continue;
    seen.add(ref);
    jobs.push({
      title,
      company: text(first(/<h4[^>]*base-search-card__subtitle[^>]*>([\s\S]*?)<\/h4>/, card)),
      location: text(first(/<span[^>]*job-search-card__location[^>]*>([\s\S]*?)<\/span>/, card)),
      url,
      ref,
      posted: first(/<time[^>]*datetime="(\d{4}-\d{2}-\d{2})"/, card),
      kind: "page",
      src: "linkedin",
    });
  }
  return jobs;
}

function linkedInJobId(urlOrId) {
  const s = String(urlOrId || "").trim();
  if (/^\d{6,}$/.test(s)) return s;
  const q = /[?&]currentJobId=(\d{6,})/.exec(s);
  if (q) return q[1];
  const m = /\/jobs\/view\/(?:[^/?#]*?-)?(\d{6,})(?:[/?#]|$)/.exec(s);
  return m ? m[1] : "";
}

async function fetchLinkedInPosting(urlOrId, timeoutMs = 8000) {
  const id = linkedInJobId(urlOrId);
  if (!id) return null;
  const apiUrl = `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`;
  const html = await fetchText(apiUrl, timeoutMs);
  const title =
    text(first(/<h2[^>]*top-card-layout__title[^>]*>([\s\S]*?)<\/h2>/i, html)) ||
    text(first(/<h1[^>]*>([\s\S]*?)<\/h1>/i, html));
  const company =
    text(first(/<a[^>]*topcard__org-name-link[^>]*>([\s\S]*?)<\/a>/i, html)) ||
    text(first(/<span[^>]*topcard__flavor[^>]*>([\s\S]*?)<\/span>/i, html));
  const location = text(first(/<span[^>]*topcard__flavor--bullet[^>]*>([\s\S]*?)<\/span>/i, html));
  const posted = text(first(/<span[^>]*posted-time-ago__text[^>]*>([\s\S]*?)<\/span>/i, html));
  const markup =
    first(/<div class="show-more-less-html__markup[^"]*"[^>]*>([\s\S]*?)<\/div>/i, html) ||
    first(/<div class="description__text[^"]*"[^>]*>([\s\S]*?)<\/div>/i, html) ||
    "";
  const desc = htmlToLines(markup);
  const emails = [
    ...new Set(
      (desc.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []).filter(
        (e) => !/^(no-?reply|do-?not-?reply)@/i.test(e)
      )
    ),
  ];
  return {
    id,
    title,
    company,
    location,
    posted,
    text: desc,
    emails,
    url: `https://www.linkedin.com/jobs/view/${id}`,
  };
}

/* ---------------------------------------------------------------- 2. GulfTalent */

const slug = (role) =>
  String(role)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
const gulfTalentUrl = (role) => `https://www.gulftalent.com/uae/jobs/title/${slug(role)}`;

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
function fullDate(dayMonth, readOn) {
  const m = /^(\d{1,2})\s+([a-z]{3})/i.exec(String(dayMonth).trim());
  const mon = m && MONTHS[m[2].toLowerCase()];
  if (mon === undefined || mon === null) return "";
  const read = readOn instanceof Date && !isNaN(readOn) ? readOn : new Date();
  let year = read.getUTCFullYear();
  if (Date.UTC(year, mon, +m[1]) > read.getTime()) year -= 1;
  return new Date(Date.UTC(year, mon, +m[1])).toISOString().slice(0, 10);
}

function parseGulfTalent(html, readOn = new Date()) {
  const jobs = [];
  const seen = new Set();
  for (const row of String(html || "").match(/<tr\b[\s\S]*?<\/tr>/g) || []) {
    const link = /href="(\/[a-z-]+\/jobs\/[a-z0-9-]+-(\d{5,}))"[^>]*>([\s\S]*?)<\/a>/i.exec(row);
    if (!link || seen.has(link[2])) continue;
    const title = text(link[3]);
    if (!title) continue;
    seen.add(link[2]);
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1]);
    jobs.push({
      title,
      company: text(String(cells[0] || "").replace(/<p\b[\s\S]*?<\/p>/i, "")),
      location: decode(first(/<span title="([^"]+)"/, row)).trim(),
      url: `https://www.gulftalent.com${link[1]}`,
      ref: link[2],
      posted: fullDate(text(cells[2] || ""), readOn),
      kind: "page",
      src: "gulftalent",
    });
  }
  return jobs;
}

/* ---------------------------------------------------------------- 3. Executive Boards (Michael Page, Page Executive, Charterhouse, Departer, AHK) */

const MPAGE_JOB = /\/job-detail\/[^/]+\/ref\/([a-z0-9-]+)/i;
const MPAGE_PLACE =
  /\b(Dubai|Abu Dhabi|Sharjah|UAE|United Arab Emirates|Riyadh|Saudi|Doha|Qatar|Kuwait|Bahrain|Oman|Muscat|Cairo|Egypt|Germany|Munich|Frankfurt|Berlin)\b/i;

function parseMichaelPage(html, baseUrl = "https://www.michaelpage.ae/jobs", label = "via Michael Page", srcId = "michaelpage") {
  const seen = new Set();
  const jobs = [];
  for (const a of anchors(html, baseUrl)) {
    const m = MPAGE_JOB.exec(a.href);
    if (!m) continue;
    if (!a.text || a.text.length < 4 || a.text.length > 160) continue;
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    const place = MPAGE_PLACE.exec(a.text);
    jobs.push({
      title: a.text,
      company: label,
      location: place ? place[1] : "UAE / GCC",
      url: a.href.split("?")[0],
      ref: m[1],
      kind: "page",
      src: srcId,
    });
  }
  return jobs;
}

function parsePageExecutive(html) {
  return parseMichaelPage(html, "https://www.pageexecutive.com/jobs/", "via Page Executive", "pageexecutive");
}

const CHARTER_JOB = /\/job\/([a-z0-9-]+?-(\d{4,}))$/i;
function parseCharterhouse(html) {
  const seen = new Set();
  const jobs = [];
  for (const a of anchors(html, "https://www.charterhouseme.ae/jobs/")) {
    const m = CHARTER_JOB.exec(a.href.split("?")[0]);
    if (!m) continue;
    if (!a.text || /^(read more|apply|save job)$/i.test(a.text)) continue;
    if (a.text.length < 4 || a.text.length > 160) continue;
    if (seen.has(m[2])) continue;
    seen.add(m[2]);
    const place = MPAGE_PLACE.exec(a.text);
    jobs.push({
      title: a.text,
      company: "via Charterhouse",
      location: place ? place[1] : "Dubai, UAE",
      url: a.href.split("?")[0],
      ref: m[2],
      kind: "page",
      src: "charterhouse",
    });
  }
  return jobs;
}

function parseDeparter(html) {
  const seen = new Set();
  const jobs = [];
  for (const a of anchors(html, "https://careers.departer.de/")) {
    const m = a.href.match(/careers\.departer\.de\/job\/(\d+)(?:\/([\w-]+))?/i);
    if (!m || seen.has(m[1])) continue;
    seen.add(m[1]);
    const title = a.text || (m[2] || "").replace(/-/g, " ");
    if (!title) continue;
    const place = MPAGE_PLACE.exec(title);
    jobs.push({
      title,
      company: "via Departer — The German Headhunter",
      location: place ? place[1] : /dubai|uae|emirat|abu dhabi|sharjah|gcc/i.test(title) ? "Dubai, UAE" : "International / DACH",
      url: a.href,
      ref: m[1],
      kind: "page",
      src: "departer",
    });
  }
  return jobs;
}

function parseAhk(html) {
  const base = "https://vae.ahk.de/en/services/career-in-the-uae/current-job-posting";
  const jobWords =
    /(manager|director|officer|coordinator|assistant|consultant|intern|specialist|head of|executive|advisor|clerk|sachbearbeiter|referent|ceo|cfo|coo)/i;
  const seen = new Set();
  const jobs = [];
  for (const a of anchors(html, base)) {
    const isDoc = /\.(pdf|docx?)($|\?)|\/download\/|workdrive/i.test(a.href);
    const looksLikeJob = jobWords.test(a.text) && a.text.length > 8 && a.text.length < 160;
    if (!isDoc && !looksLikeJob) continue;
    if (!a.text || /^(home|contact|imprint|privacy|back|more)$/i.test(a.text)) continue;
    const key = a.href + "|" + a.text;
    if (seen.has(key)) continue;
    seen.add(key);
    jobs.push({
      title: a.text,
      company: "AHK VAE / Member Company",
      location: "UAE",
      url: a.href,
      kind: isDoc ? "document" : "page",
      src: "ahk",
    });
  }
  return jobs;
}

/* ---------------------------------------------------------------- 4. Public JSON Job Board APIs (Arbeitnow & Remotive) */

async function fetchArbeitnow(timeoutMs = 9000) {
  const res = await fetch("https://www.arbeitnow.com/api/job-board-api", {
    headers: { "user-agent": UA, accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Arbeitnow HTTP ${res.status}`);
  const data = await res.json();
  return (data.data || []).map((j) => ({
    title: String(j.title || "").trim(),
    company: String(j.company_name || "").trim(),
    location: String(j.location || (j.remote ? "Remote / Europe" : "Germany")).trim(),
    url: String(j.url || ""),
    ref: String(j.slug || ""),
    posted: j.created_at ? new Date(j.created_at * 1000).toISOString().slice(0, 10) : "recent",
    text: htmlToLines(j.description || "").slice(0, 3500),
    kind: "page",
    src: "arbeitnow",
  }));
}

async function fetchRemotive(timeoutMs = 9000) {
  const res = await fetch("https://remotive.com/api/remote-jobs?limit=35", {
    headers: { "user-agent": UA, accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Remotive HTTP ${res.status}`);
  const data = await res.json();
  return (data.jobs || []).map((j) => ({
    title: String(j.title || "").trim(),
    company: String(j.company_name || "").trim(),
    location: String(j.candidate_required_location || "Remote").trim(),
    url: String(j.url || ""),
    ref: String(j.id || ""),
    posted: String(j.publication_date || "").slice(0, 10),
    text: htmlToLines(j.description || "").slice(0, 3500),
    kind: "page",
    src: "remotive",
  }));
}

/* ---------------------------------------------------------------- 5. Zero-Key Open Web Vacancy Search (DuckDuckGo HTML) */

async function fetchDuckDuckGoJobs(query, timeoutMs = 10000) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const html = await fetchText(url, timeoutMs);
  const out = [];
  const blocks = String(html || "").split(/class="result__body"/i).slice(1);
  for (const b of blocks) {
    const rawHref = first(/class="result__a"[^>]*href="([^"]+)"/i, b);
    const title = text(first(/class="result__a"[^>]*>([\s\S]*?)<\/a>/i, b));
    const snippet = text(first(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>|class="result__snippet"[^>]*>([\s\S]*?)<\/div>/i, b));
    let realUrl = rawHref;
    const uddg = /[?&]uddg=([^&]+)/.exec(rawHref);
    if (uddg) {
      try {
        realUrl = decodeURIComponent(uddg[1]);
      } catch {}
    }
    if (!realUrl || !/^https?:\/\//i.test(realUrl) || !title) continue;
    if (/duckduckgo\.com/i.test(realUrl)) continue;
    out.push({
      title,
      url: realUrl,
      content: snippet,
    });
    if (out.length >= 10) break;
  }
  return out;
}

module.exports = {
  UA,
  decode,
  text,
  htmlToLines,
  fetchText,
  anchors,
  linkedInUrl,
  parseLinkedIn,
  linkedInJobId,
  fetchLinkedInPosting,
  gulfTalentUrl,
  parseGulfTalent,
  parseMichaelPage,
  parsePageExecutive,
  parseCharterhouse,
  parseDeparter,
  parseAhk,
  fetchArbeitnow,
  fetchRemotive,
  fetchDuckDuckGoJobs,
};
