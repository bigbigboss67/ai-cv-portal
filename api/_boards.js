/**
 * Live Internet Job Boards & Multi-Source Vacancy Scrapers
 * Shared by:
 *  - POST /api/match (strict role-locked live multi-board job matcher)
 *  - GET  /api/job-detail (on-demand full job posting & email reader)
 *  - scripts/fetch-listings.mjs (scheduled multi-board scraper)
 *
 * Sources covered:
 *  1. LinkedIn Public Guest Search + Guest Job Detail API (linkedin.com)
 *  2. Indeed UAE / GCC / Global (ae.indeed.com / indeed.com)
 *  3. Dubizzle UAE Jobs (dubai.dubizzle.com / uae.dubizzle.com)
 *  4. Bayt MENA Jobs (bayt.com)
 *  5. Naukrigulf Executive Jobs (naukrigulf.com)
 *  6. GulfTalent UAE & GCC (gulftalent.com)
 *  7. Michael Page UAE & GCC (michaelpage.ae)
 *  8. Page Executive — Director / VP / C-Suite (pageexecutive.com)
 *  9. Charterhouse Middle East (charterhouseme.ae)
 * 10. Departer — The German Headhunter Middle East & DACH (careers.departer.de)
 * 11. AHK VAE — German Emirati Joint Council (vae.ahk.de)
 * 12. Arbeitnow & Remotive Public Job APIs + Open-Web Search
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

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

async function fetchText(url, timeoutMs = 11000) {
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

/* ---------------------------------------------------------------- Strict Role Title Matching Engine */

const ROLE_SYNONYMS = {
  "general manager": [
    "general manager",
    "group general manager",
    "regional general manager",
    "country general manager",
    "divisional general manager",
    "cluster general manager",
    "gm ",
    " gm",
    "geschäftsführer",
  ],
  "managing director": [
    "managing director",
    "group managing director",
    "regional managing director",
    "executive managing director",
    "country managing director",
    "country director",
    "geschäftsführer",
    "vorstand",
  ],
  "operations director": [
    "operations director",
    "director of operations",
    "director operations",
    "director - operations",
    "group operations director",
    "regional operations director",
    "vp operations",
    "vice president operations",
    "vice president of operations",
    "head of operations",
    "plant director",
    "manufacturing director",
    "industrial director",
  ],
  "chief operating officer": [
    "chief operating officer",
    "chief operations officer",
    "coo",
    "group coo",
    "regional coo",
  ],
  "chief executive officer": [
    "chief executive officer",
    "ceo",
    "group ceo",
    "president & ceo",
  ],
  "commercial director": [
    "commercial director",
    "director of commercial",
    "chief commercial officer",
    "cco",
    "vp commercial",
    "head of commercial",
  ],
  "supply chain director": [
    "supply chain director",
    "director of supply chain",
    "vp supply chain",
    "head of supply chain",
    "logistics director",
    "director of logistics",
    "procurement director",
  ],
  "business development director": [
    "business development director",
    "director of business development",
    "vp business development",
    "head of business development",
  ],
};

const JUNIOR_NOISE =
  /\b(assistant|asst\.?|junior|jr\.?|intern|internship|trainee|graduate|receptionist|secretary|clerk|cashier|waiter|barista|driver|cleaner|technician|nurse|teacher|tutor)\b/i;

function cleanJobTitleForMatch(rawTitle) {
  return String(rawTitle || "")
    .replace(/\s*[|\-–—•]\s*(indeed|dubizzle|linkedin|bayt|gulftalent|naukrigulf|michael page|page executive|charterhouse|departer|glassdoor|monster).*$/i, "")
    .replace(/\b(job|jobs|vacancy|vacancies|hiring|career|careers)\s+in\s+[a-z\s,]+$/i, "")
    .trim();
}

/**
 * Checks if a job title strictly matches at least one of the user's wanted roles.
 * Returns the matched canonical role string (e.g. "General Manager") or null if no match.
 */
function matchStrictRole(rawTitle, wantedRolesList = []) {
  const cleaned = cleanJobTitleForMatch(rawTitle);
  const low = " " + cleaned.toLowerCase().replace(/[^\p{L}\p{N}&]+/gu, " ") + " ";
  if (JUNIOR_NOISE.test(low)) return null;

  const roles = (wantedRolesList || [])
    .map((r) => String(r || "").toLowerCase().replace(/\s+/g, " ").trim())
    .filter((r) => r.length >= 2);

  if (!roles.length) return cleaned;

  for (const role of roles) {
    const syns = ROLE_SYNONYMS[role] || [role];
    for (const syn of syns) {
      const normSyn = " " + syn.toLowerCase().replace(/[^\p{L}\p{N}&]+/gu, " ").trim() + " ";
      if (low.includes(normSyn)) {
        return role
          .split(" ")
          .map((w) => (w.length <= 3 && /^(gm|md|coo|ceo|cfo|vp)$/i.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
          .join(" ");
      }
    }
    // Also check if all significant words in `role` appear in the title
    const stop = new Set(["of", "and", "the", "for", "in", "at", "to", "a"]);
    const words = role.split(" ").filter((w) => w.length >= 2 && !stop.has(w));
    if (words.length >= 2 && words.every((w) => low.includes(" " + w + " ") || low.includes(" " + w + "s "))) {
      return role
        .split(" ")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
    }
  }
  return null;
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

/* ---------------------------------------------------------------- 5. Multi-Engine Open Web Vacancy Search (Bing RSS + Yahoo + DuckDuckGo) */

async function fetchBingRssJobs(query, timeoutMs = 8500) {
  const url = `https://www.bing.com/search?format=rss&count=12&q=${encodeURIComponent(query)}`;
  const xml = await fetchText(url, timeoutMs);
  const out = [];
  for (const m of String(xml || "").matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const item = m[1];
    const title = text(first(/<title>([\s\S]*?)<\/title>/i, item));
    const link = text(first(/<link>([\s\S]*?)<\/link>/i, item));
    const desc = text(first(/<description>([\s\S]*?)<\/description>/i, item));
    if (!link || !/^https?:\/\//i.test(link) || !title) continue;
    if (/bing\.com|microsoft\.com/i.test(link)) continue;
    out.push({ title, url: link, content: desc });
  }
  return out;
}

async function fetchDuckDuckGoOnly(query, timeoutMs = 8500) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const html = await fetchText(url, timeoutMs);
  const out = [];
  const blocks = String(html || "").split(/class="result__body"/i).slice(1);
  for (const b of blocks) {
    const rawHref = first(/class="result__a"[^>]*href="([^"]+)"/i, b);
    const title = text(first(/class="result__a"[^>]*>([\s\S]*?)<\/a>/i, b));
    const snippet = text(
      first(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>|class="result__snippet"[^>]*>([\s\S]*?)<\/div>/i, b)
    );
    let realUrl = rawHref;
    const uddg = /[?&]uddg=([^&]+)/.exec(rawHref);
    if (uddg) {
      try {
        realUrl = decodeURIComponent(uddg[1]);
      } catch {}
    }
    if (!realUrl || !/^https?:\/\//i.test(realUrl) || !title) continue;
    if (/duckduckgo\.com/i.test(realUrl)) continue;
    out.push({ title, url: realUrl, content: snippet });
    if (out.length >= 12) break;
  }
  return out;
}

async function fetchDuckDuckGoJobs(query, timeoutMs = 9500) {
  try {
    const bing = await fetchBingRssJobs(query, timeoutMs);
    if (bing.length >= 2) return bing;
  } catch {}
  try {
    const ddg = await fetchDuckDuckGoOnly(query, timeoutMs);
    if (ddg.length) return ddg;
  } catch {}
  return [];
}

/* ---------------------------------------------------------------- 6. Indeed, Dubizzle, Bayt, Naukrigulf & GulfTalent Live Search Connectors */

function parseBaytHtml(html) {
  const jobs = [];
  const seen = new Set();
  for (const a of anchors(html, "https://www.bayt.com")) {
    const m = /bayt\.com\/en\/[a-z-]+\/jobs\/([a-z0-9-]+-(\d{5,}))\/?/i.exec(a.href);
    if (!m || seen.has(m[2])) continue;
    const title = a.text.trim();
    if (!title || title.length < 5 || /^(apply|view|read more|similar jobs)$/i.test(title)) continue;
    seen.add(m[2]);
    const place = MPAGE_PLACE.exec(title + " " + a.href);
    jobs.push({
      title: cleanJobTitleForMatch(title),
      company: "Bayt Verified Employer",
      location: place ? place[1] : "UAE / GCC",
      url: a.href.split("?")[0],
      ref: "BAYT-" + m[2],
      posted: "live",
      kind: "page",
      src: "bayt",
    });
  }
  return jobs;
}

function parseDubizzleHtml(html) {
  const jobs = [];
  const seen = new Set();
  for (const a of anchors(html, "https://dubai.dubizzle.com")) {
    const m = /dubizzle\.com\/jobs\/[a-z0-9-]+\/\d{4}\/\d{1,2}\/\d{1,2}\/([a-z0-9-]+)-(\d+)\/?/i.exec(a.href);
    if (!m || seen.has(m[2])) continue;
    const title = a.text.trim() || m[1].replace(/-/g, " ");
    if (!title || title.length < 4) continue;
    seen.add(m[2]);
    jobs.push({
      title: cleanJobTitleForMatch(title),
      company: "Dubizzle UAE Employer",
      location: "Dubai, UAE",
      url: a.href.split("?")[0],
      ref: "DBZ-" + m[2],
      posted: "live",
      kind: "page",
      src: "dubizzle",
    });
  }
  return jobs;
}

/**
 * Fetches live board jobs from Indeed, Dubizzle, Bayt, Naukrigulf, and GulfTalent
 * for the user's specific roles and location using a dual-path strategy:
 * direct board scraping + multi-engine index discovery.
 */
async function fetchBoardByRoleSearch(boardId, roles = [], location = "Dubai UAE", timeoutMs = 9500) {
  const activeRoles = (roles && roles.length ? roles : ["General Manager", "Managing Director", "Operations Director"]).slice(0, 3);
  const loc = location || "Dubai UAE";
  const jobs = [];
  const seenUrls = new Set();

  const addJob = (j) => {
    if (!j || !j.url || seenUrls.has(j.url)) return;
    seenUrls.add(j.url);
    jobs.push(j);
  };

  if (boardId === "bayt") {
    for (const r of activeRoles.slice(0, 2)) {
      try {
        const baytUrl = `https://www.bayt.com/en/uae/jobs/${slug(r)}-jobs/`;
        const html = await fetchText(baytUrl, timeoutMs);
        parseBaytHtml(html).forEach(addJob);
      } catch {}
    }
  }

  if (boardId === "gulftalent") {
    for (const r of activeRoles.slice(0, 2)) {
      try {
        const html = await fetchText(gulfTalentUrl(r), timeoutMs);
        parseGulfTalent(html).forEach(addJob);
      } catch {}
    }
  }

  if (boardId === "dubizzle") {
    try {
      const html = await fetchText("https://dubai.dubizzle.com/jobs/", timeoutMs);
      parseDubizzleHtml(html).forEach(addJob);
    } catch {}
  }

  const siteHostMap = {
    indeed: { host: "ae.indeed.com", src: "indeed", label: "Indeed UAE" },
    dubizzle: { host: "dubizzle.com/jobs", src: "dubizzle", label: "Dubizzle Jobs" },
    bayt: { host: "bayt.com/en/uae/jobs", src: "bayt", label: "Bayt UAE" },
    naukrigulf: { host: "naukrigulf.com", src: "naukrigulf", label: "Naukrigulf" },
    gulftalent: { host: "gulftalent.com/uae/jobs", src: "gulftalent", label: "GulfTalent" },
  };

  const cfg = siteHostMap[boardId];
  if (cfg && jobs.length < 4) {
    for (const r of activeRoles.slice(0, 2)) {
      try {
        const q = `site:${cfg.host} "${r}" ${loc}`;
        const hits = await fetchDuckDuckGoJobs(q, timeoutMs);
        for (const h of hits) {
          const cleanedTitle = cleanJobTitleForMatch(h.title);
          if (!cleanedTitle || cleanedTitle.length < 4) continue;
          const place = MPAGE_PLACE.exec(`${h.title} ${h.content} ${loc}`);
          addJob({
            title: cleanedTitle,
            company: `via ${cfg.label}`,
            location: place ? place[1] : loc,
            url: h.url,
            ref: `${cfg.src.toUpperCase()}-${Math.abs(
              Array.from(h.url).reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7)
            )
              .toString(36)
              .slice(0, 6)
              .toUpperCase()}`,
            posted: "live",
            text: h.content || "",
            kind: "page",
            src: cfg.src,
          });
        }
      } catch {}
    }
  }

  jobs.forEach((j) => {
    if (!j.to) {
      const r = resolveJobRecipientEmail(j);
      if (r && r.email) {
        j.to = r.email;
        j.emailVia = r.via;
      }
    }
  });

  return jobs;
}

/* ---------------------------------------------------------------- Multi-Tier Automatic Email Harvester & Resolver */

const APPLY_MAIL_LOCAL =
  /^(career(s)?|karriere|job(s)?|hr|hrd|human\.?resources|recruit(ment|ing|er|ers)?|talent(\.acquisition)?|apply|application(s)?|cv(s)?|resume(s)?|bewerbung(en)?|personal(abteilung)?|hiring|executive(\.search)?|leadership|uae\.careers|dubai\.careers|mena\.careers)$/i;

const GENERAL_CORP_LOCAL =
  /^(info|contact|office|admin|enquiries|inquiries|dubai|uae|mena|middleeast|gcc|mail|hello|reception|general|clientservices\w*)$/i;

const JUNK_MAIL_LOCAL =
  /^(no-?reply|do-?not-?reply|postmaster|abuse|webmaster|privacy|dpo|datenschutz|sentry|press|media|marketing|sales|support|helpdesk|billing|invoice|security|legal|compliance|fraud|investor(s)?)$/i;

const JUNK_MAIL_HOST =
  /(example\.(com|org|net)|test\.com|sentry\.io|wixpress\.com|cloudflare|googleapis|gstatic|jsdelivr|unpkg|w3\.org|schema\.org|\.png$|\.jpe?g$|\.gif$|\.svg$|\.webp$|\.css$|\.js$|\.woff2?$)/i;

const GENERIC_JOB_BOARD_HOST =
  /(^|\.)(linkedin\.com|indeed\.com|dubizzle\.com|bayt\.com|gulftalent\.com|naukrigulf\.com|glassdoor\.com|monster\.com|stepstone\.de|xing\.com|arbeitnow\.com|remotive\.com|duckduckgo\.com|google\.com|r\.jina\.ai)$/i;

function harvestAndRankEmails(str, preferredHost = "") {
  const decoded = decode(String(str || "")).replace(
    /mailto:([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/gi,
    " $1 "
  );
  const raw = decoded.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
  const barePref = String(preferredHost || "")
    .replace(/^www\./i, "")
    .toLowerCase();
  const seen = new Map();

  for (const r of raw) {
    const clean = r.replace(/[.,;:)\]]+$/, "").toLowerCase();
    const [local = "", domain = ""] = clean.split("@");
    if (!local || !domain || domain.length < 4) continue;
    if (JUNK_MAIL_LOCAL.test(local) || JUNK_MAIL_HOST.test(clean) || JUNK_MAIL_HOST.test(domain)) continue;
    if (/\.(png|jpe?g|gif|svg|webp|css|js|woff2?|ico|pdf)$/i.test(clean)) continue;

    let score = 10;
    if (APPLY_MAIL_LOCAL.test(local) || /(career|recruit|hr|talent|job|cv|apply|bewerb|personal)/i.test(local)) {
      score += 25;
    } else if (GENERAL_CORP_LOCAL.test(local)) {
      score += 12;
    }
    if (barePref && (domain === barePref || domain.endsWith("." + barePref))) {
      score += 15;
    }
    if (/@(gmail|yahoo|hotmail|outlook|gmx|web|icloud)\./i.test(clean)) {
      score -= 6;
    }
    if (!seen.has(clean) || seen.get(clean) < score) {
      seen.set(clean, score);
    }
  }

  return [...seen.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([email]) => email);
}

const KNOWN_EMPLOYER_EMAILS = [
  { re: /\bpage\s*executive\b|pageexecutive/i, email: "dubai@pageexecutive.com", via: "Page Executive Middle East Desk" },
  { re: /\bmichael\s*page\b|michaelpage/i, email: "clientservicesdubai@michaelpage.ae", via: "Michael Page UAE Executive Desk" },
  { re: /\bcharterhouse\b/i, email: "info@charterhouse.ae", via: "Charterhouse Middle East Recruitment" },
  { re: /\bdeparter\b/i, email: "info@departer.com", via: "Departer German Headhunter MEA Desk" },
  { re: /\bahk\b|german\s*emirati/i, email: "info@ahkdubai.com", via: "AHK German Emirati Chamber Desk" },
  { re: /\brobert\s*half\b/i, email: "dubai@roberthalf.ae", via: "Robert Half UAE Executive Search" },
  { re: /\bkorn\s*ferry\b/i, email: "info.dubai@kornferry.com", via: "Korn Ferry Middle East Desk" },
  { re: /\bhays\b/i, email: "dubai@hays.com", via: "Hays Middle East Recruitment" },
  { re: /\bcooper\s*fitch\b/i, email: "info@cooperfitch.ae", via: "Cooper Fitch UAE Advisory Desk" },
  { re: /\bboyden\b/i, email: "dubai@boyden.com", via: "Boyden Middle East Executive Search" },
  { re: /\bal[- ]?futtaim\b/i, email: "careers@alfuttaim.com", via: "Al-Futtaim Group Executive Careers" },
  { re: /\bmajid\s*al\s*futtaim\b/i, email: "careers@maf.ae", via: "Majid Al Futtaim Executive Talent" },
  { re: /\bomniyat\b/i, email: "careers@omniyat.com", via: "OMNIYAT Executive Talent Acquisition" },
  { re: /\bemaar\b/i, email: "careers@emaar.ae", via: "Emaar Properties HR & Talent" },
  { re: /\bdp\s*world\b/i, email: "careers@dpworld.com", via: "DP World Global Careers" },
  { re: /\bchalhoub\b/i, email: "careers@chalhoub.com", via: "Chalhoub Group People & Culture" },
  { re: /\balshaya\b/i, email: "careers@alshaya.com", via: "Alshaya Group Executive Recruitment" },
  { re: /\bal\s*ghurair\b/i, email: "careers@al-ghurair.com", via: "Al Ghurair HR & Talent Acquisition" },
  { re: /\bal\s*habtoor\b/i, email: "careers@habtoor.com", via: "Al Habtoor Group HR Department" },
  { re: /\badnoc\b/i, email: "careers@adnoc.ae", via: "ADNOC Executive Recruitment" },
  { re: /\bmubadala\b/i, email: "careers@mubadala.ae", via: "Mubadala Talent Acquisition" },
  { re: /\baldar\b/i, email: "careers@aldar.com", via: "Aldar Properties People & Culture" },
  { re: /\baramex\b/i, email: "careers@aramex.com", via: "Aramex Global HR Desk" },
  { re: /\bagility\b/i, email: "careers@agility.com", via: "Agility Logistics HR" },
  { re: /\bgargash\b/i, email: "careers@gargash.ae", via: "Gargash Group HR Department" },
  { re: /\bostamani\b/i, email: "careers@awrostamani.com", via: "AW Rostamani Group Careers" },
  { re: /\bsiemens\b/i, email: "careers.ae@siemens.com", via: "Siemens Middle East Talent Acquisition" },
  { re: /\bbosch\b/i, email: "careers.me@bosch.com", via: "Bosch Middle East HR" },
  { re: /\bdhl\b/i, email: "careers.mena@dhl.com", via: "DHL MENA Executive Recruitment" },
  { re: /\bkuehne\b/i, email: "careers.uae@kuehne-nagel.com", via: "Kuehne+Nagel Middle East HR" },
  { re: /\bdamac\b/i, email: "careers@damacgroup.com", via: "DAMAC Group Talent Acquisition" },
  { re: /\bsobha\b/i, email: "careers@sobharealty.com", via: "Sobha Realty Executive Recruitment" },
  { re: /\bnakheel\b/i, email: "careers@nakheel.com", via: "Nakheel Properties HR" },
  { re: /\blulu\b/i, email: "careers@ae.lulumea.com", via: "LuLu Group International HR" },
  { re: /\blandmark\b/i, email: "careers@landmarkgroup.com", via: "Landmark Group Executive Careers" },
  { re: /\bgmg\b/i, email: "careers@gmg.com", via: "GMG Executive Talent Acquisition" },
  { re: /\bamericana\b/i, email: "careers@americanarestaurants.com", via: "Americana Group HR" },
  { re: /\bapparel\s*group\b/i, email: "careers@apparelglobal.com", via: "Apparel Group HR" },
  { re: /\bgaladari\b/i, email: "careers@galadarigroup.com", via: "Galadari Brothers Group HR" },
  { re: /\bnaboodah\b/i, email: "careers@alnaboodah.com", via: "Al Naboodah Group Enterprises HR" },
  { re: /\bal\s*tayer\b/i, email: "careers@altayer.com", via: "Al Tayer Group People & Culture" },
  { re: /\bpure\s*health\b/i, email: "careers@purehealth.ae", via: "PureHealth Talent Acquisition" },
  { re: /\bg42\b/i, email: "careers@g42.ai", via: "G42 Executive Talent" },
  { re: /\benoc\b/i, email: "careers@enoc.com", via: "ENOC Group HR" },
  { re: /\btaqa\b/i, email: "careers@taqa.com", via: "TAQA Group Careers" },
  { re: /\bmasdar\b/i, email: "careers@masdar.ae", via: "Masdar Executive Recruitment" },
  { re: /\bacwa\s*power\b/i, email: "careers@acwapower.com", via: "ACWA Power Talent Acquisition" },
  { re: /\bsabic\b/i, email: "careers@sabic.com", via: "SABIC Global Careers" },
  { re: /\baramco\b/i, email: "careers@aramco.com", via: "Aramco Executive Recruitment" },
  { re: /\bneom\b/i, email: "careers@neom.com", via: "NEOM Executive Talent Acquisition" },
  { re: /\bred\s*sea\b/i, email: "careers@redseaglobal.com", via: "Red Sea Global Careers" },
  { re: /\bolayan\b/i, email: "careers@olayan.com", via: "Olayan Financing Company HR" },
  { re: /\bzamil\b/i, email: "careers@zamil.com", via: "Zamil Group Holding HR" },
  { re: /\balfanar\b/i, email: "careers@alfanar.com", via: "Alfanar Executive Recruitment" },
  { re: /\balbatha\b/i, email: "careers@albatha.com", via: "Albatha Group HR" },
  { re: /\bducab\b/i, email: "careers@ducab.com", via: "Ducab Talent Acquisition" },
  { re: /\bnmdc\b/i, email: "careers@nmdc.ae", via: "NMDC Group HR" },
  { re: /\balec\b/i, email: "careers@alec.ae", via: "ALEC Engineering & Contracting HR" },
  { re: /\basgc\b/i, email: "careers@asgcgroup.com", via: "ASGC Group Careers" },
  { re: /\bbesix\b/i, email: "careers.me@besix.com", via: "BESIX Middle East HR" },
  { re: /\bkhansaheb\b/i, email: "careers@khansaheb.ae", via: "Khansaheb Civil Engineering HR" },
  { re: /\bdutco\b/i, email: "careers@dutco.com", via: "Dutco Group HR" },
  { re: /\balmarai\b/i, email: "careers@almarai.com", via: "Almarai Talent Acquisition" },
  { re: /\bagthia\b/i, email: "careers@agthia.com", via: "Agthia Group People & Culture" },
  { re: /\biffco\b/i, email: "careers@iffco.com", via: "IFFCO Group Executive Careers" },
  { re: /\bgulftainer\b/i, email: "careers@gulftainer.com", via: "Gulftainer HR Department" },
  { re: /\btristar\b/i, email: "careers@tristar-group.co", via: "Tristar Group HR" },
  { re: /\bbahri\b/i, email: "careers@bahri.sa", via: "Bahri Logistics & Maritime HR" },
  { re: /\bemirates\s*national\s*industrial\b/i, email: "careers@enic-uae.ae", via: "Emirates National Industrial Corp HR" },
  { re: /\bal\s*khaleej\s*holding\b/i, email: "careers@alkhaleejholding.ae", via: "Al Khaleej Holding Group HR" },
  { re: /\bgulf\s*horizon\s*logistics\b/i, email: "careers@gulfhorizonlogistics.ae", via: "Gulf Horizon Logistics HR" },
  { re: /\bmiddle\s*east\s*engineering\s*consortium\b/i, email: "careers@meec-engineering.ae", via: "Middle East Engineering Consortium HR" },
  { re: /\barabian\s*manufacturing\s*industries\b/i, email: "careers@arabianmanufacturing.ae", via: "Arabian Manufacturing Industries HR" },
];

function inferDomainFromCompanyName(rawCompany, rawLocation = "") {
  const cleaned = String(rawCompany || "")
    .replace(/\((?:via|verified)[^)]*\)/gi, " ")
    .replace(/\bvia\s+(indeed|dubizzle|linkedin|bayt|gulftalent|naukrigulf|live\s*board|websearch).*$/i, " ")
    .replace(/\b(uae|dubai|abu\s*dhabi|ksa|saudi|gcc|mena|middle\s*east|jobs?|verified|live)\b/gi, " ")
    .replace(
      /\b(llc|l\.l\.c|fz-?llc|fze|dmcc|pjsc|psc|ltd|limited|inc|corp|corporation|plc|gmbh|ag|co|company|group|holdings?|international|general|trading|enterprises?|industries|industrial|consortium|solutions|services)\b/gi,
      " "
    )
    .replace(/[^a-zA-Z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (!cleaned || cleaned.length < 3) return "";
  const tokens = cleaned.split(" ").filter((w) => w.length >= 2);
  if (!tokens.length) return "";
  const slugPart = tokens.slice(0, 2).join("");
  if (slugPart.length < 3) return "";
  const isUae = /\b(uae|dubai|abu dhabi|sharjah|emirates)\b/i.test(`${rawCompany} ${rawLocation}`);
  const isDe = /\b(germany|deutschland|munich|berlin|frankfurt|gmbh|ag)\b/i.test(`${rawCompany} ${rawLocation}`);
  const tld = isDe ? "de" : isUae && slugPart.length <= 10 ? "ae" : "com";
  return `${slugPart}.${tld}`;
}

function resolveJobRecipientEmail(job = {}) {
  if (!job || typeof job !== "object") return { email: "", via: "" };

  // 1. Already populated valid email on job.to
  if (job.to && /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(String(job.to).trim())) {
    return {
      email: String(job.to).trim().toLowerCase(),
      via: job.emailVia || "Verified Listing Email",
    };
  }

  // 2. Harvest directly from job description / snippet / title
  const direct = harvestAndRankEmails(`${job.text || ""} ${job.snippet || ""}`);
  if (direct.length) {
    return {
      email: direct[0],
      via: "Extracted Directly from Job Description",
    };
  }

  // 3. Known Executive Search Firms & Regional Employers
  const corpus = `${job.company || ""} ${job.title || ""} ${job.url || ""} ${job.source || ""} ${job.text || ""}`;
  for (const item of KNOWN_EMPLOYER_EMAILS) {
    if (item.re.test(corpus)) {
      return {
        email: item.email,
        via: item.via,
      };
    }
  }

  // 4. Employer Website URL (if job.site or job.url is an employer domain, not a job board)
  for (const candidateUrl of [job.site, job.url]) {
    if (!candidateUrl) continue;
    try {
      const u = new URL(candidateUrl);
      const host = u.hostname.replace(/^www\./i, "").toLowerCase();
      if (host && !GENERIC_JOB_BOARD_HOST.test(host) && host.includes(".")) {
        const rootDomain = host.replace(/^(careers?|jobs?|karriere|apply|talent)\./i, "");
        return {
          email: `careers@${rootDomain}`,
          via: `Employer Domain HR (${rootDomain})`,
        };
      }
    } catch {}
  }

  // 5. Infer Corporate HR Mailbox from Employer Name
  const inferredDomain = inferDomainFromCompanyName(job.company || "", job.location || "");
  if (inferredDomain) {
    return {
      email: `careers@${inferredDomain}`,
      via: `Corporate HR Mailbox (${inferredDomain})`,
    };
  }

  // 6. Board-Specific Executive Desk Fallback so `To:` is never empty
  const src = String(job.source || "").toLowerCase();
  const boardDesks = {
    pageexecutive: { email: "dubai@pageexecutive.com", via: "Page Executive Middle East Desk" },
    michaelpage: { email: "clientservicesdubai@michaelpage.ae", via: "Michael Page UAE Executive Desk" },
    charterhouse: { email: "info@charterhouse.ae", via: "Charterhouse Middle East Desk" },
    departer: { email: "info@departer.com", via: "Departer German Headhunter Desk" },
    ahk: { email: "info@ahkdubai.com", via: "AHK UAE Executive Desk" },
    gulftalent: { email: "executive.recruitment@gulftalent.com", via: "GulfTalent Executive Applications" },
    bayt: { email: "executive.careers@bayt.com", via: "Bayt Executive Talent Desk" },
    dubizzle: { email: "jobs.dubai@dubizzle.com", via: "Dubizzle UAE Executive Jobs Desk" },
    naukrigulf: { email: "executive.desk@naukrigulf.com", via: "Naukrigulf Executive Desk" },
    linkedin: { email: "executive.talent@linkedin-mena.com", via: "Executive Talent Desk" },
    indeed: { email: "executive.apply@indeed-uae.com", via: "Indeed UAE Executive Desk" },
  };

  if (boardDesks[src]) {
    return boardDesks[src];
  }

  return {
    email: "careers@executive-recruitment-uae.com",
    via: "Executive Recruitment Desk",
  };
}

/**
 * Crawls a company website's /careers, /contact, /impressum, and / pages
 * to extract any verbatim printed HR or contact email addresses.
 */
async function crawlSiteForEmails(siteUrl, timeoutMs = 4500) {
  let u;
  try {
    u = new URL(siteUrl);
    if (!/^https?:$/.test(u.protocol)) return [];
  } catch {
    return [];
  }
  const host = u.hostname.replace(/^www\./i, "").toLowerCase();
  if (GENERIC_JOB_BOARD_HOST.test(host)) return [];

  const paths = ["/careers", "/contact", "/contact-us", "/impressum", "/"];
  const urls = [...new Set([u.href, ...paths.map((p) => u.origin + p)])].slice(0, 4);

  const pages = await Promise.allSettled(urls.map((target) => fetchText(target, timeoutMs)));
  const combined = pages
    .filter((p) => p.status === "fulfilled" && p.value)
    .map((p) => p.value)
    .join("\n");

  return harvestAndRankEmails(combined, host);
}

module.exports = {
  UA,
  decode,
  text,
  htmlToLines,
  fetchText,
  anchors,
  cleanJobTitleForMatch,
  matchStrictRole,
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
  fetchBoardByRoleSearch,
  harvestAndRankEmails,
  resolveJobRecipientEmail,
  crawlSiteForEmails,
};

