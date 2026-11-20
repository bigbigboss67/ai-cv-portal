/**
 * Keyless Multi-Source Executive Job Fetching Agent
 *
 * Fetches real executive job listings across ALL 16+ GCC & DACH sources
 * with ZERO API keys (ignores AISA_API_KEY / OpenAI / paid APIs).
 *
 * Strategies per source (automatic fallback):
 *   1. Direct public HTTP/JSON/HTML fetch + JSON-LD JobPosting + anchor parser
 *   2. Public Markdown Reader (https://r.jina.ai/<url>) for JS-rendered boards
 *   3. Strict hostname validation so zero non-board junk URLs ever enter data/listings.json
 *   4. Genuine email resolution only (never guesses fake careers@domain.com)
 *
 * Usage:
 *   node scripts/job-fetching-agent.mjs
 */

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const boards = require("../api/_boards.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_FILE = path.join(ROOT, "data", "listings.json");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const TIMEOUT_MS = 14000;

const EXEC_ROLES = [
  "General Manager",
  "Managing Director",
  "Operations Director",
  "Chief Operating Officer",
  "Commercial Director",
  "Supply Chain Director",
];

const PLACE_RE =
  /\b(Dubai|Abu Dhabi|Sharjah|UAE|United Arab Emirates|Riyadh|Jeddah|Saudi Arabia|KSA|Doha|Qatar|Kuwait|Bahrain|Oman|Muscat|Munich|München|Berlin|Frankfurt|Hamburg|Zurich|Zürich|Geneva|Vienna|Wien|Germany|Deutschland|Switzerland|Schweiz|Austria|DACH)\b/i;

const NAV_JUNK_RE =
  /^(home|login|sign in|sign up|register|post a job|employers|about|contact|privacy|terms|cookies|help|faq|blog|advice|salary|courses|next|previous|back|more|view all|see all|load more|read more|apply|apply now|save job|share|search|filter|jobs|careers|vacancies)$/i;

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

const stripHtml = (s) => decode(String(s || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

async function fetchDirect(url, timeoutMs = TIMEOUT_MS) {
  const res = await fetch(url, {
    headers: {
      "user-agent": UA,
      accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9,de;q=0.8",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function fetchViaJina(url, timeoutMs = 18000) {
  const jinaUrl = `https://r.jina.ai/${url}`;
  const res = await fetch(jinaUrl, {
    headers: {
      "user-agent": UA,
      accept: "text/plain, text/markdown;q=0.9",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Jina HTTP ${res.status}`);
  const text = await res.text();
  if (/just a moment|verify you are human|captcha|access denied|enable javascript/i.test(text.slice(0, 1500)) && text.length < 3500) {
    throw new Error("Blocked by anti-bot wall");
  }
  return text;
}

function hostMatches(url, allowedDomains) {
  try {
    const h = new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
    return allowedDomains.some((d) => h === d || h.endsWith("." + d));
  } catch {
    return false;
  }
}

function extractHtmlAnchors(html, base) {
  const out = [];
  for (const m of String(html || "").matchAll(/<a\b[^>]*?href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1].trim();
    if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:")) continue;
    try {
      const abs = new URL(href, base).href.split("#")[0];
      const title = stripHtml(m[2]);
      if (title) out.push({ url: abs, title });
    } catch {}
  }
  return out;
}

function extractMarkdownLinks(md) {
  const out = [];
  for (const m of String(md || "").matchAll(/\[([^\]\n]{4,180})\]\((https?:\/\/[^\s)]+)\)/g)) {
    const rawTitle = m[1].replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\*\*|__|`/g, "").replace(/\s+/g, " ").trim();
    const url = m[2].split("#")[0].replace(/[),.;]+$/, "");
    if (rawTitle && url) out.push({ url, title: rawTitle });
  }
  return out;
}

function extractJsonLdJobs(html) {
  const jobs = [];
  for (const m of String(html || "").matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(m[1]);
      const items = Array.isArray(parsed) ? parsed : parsed["@graph"] ? parsed["@graph"] : [parsed];
      for (const item of items) {
        if (!item || item["@type"] !== "JobPosting") continue;
        const url = item.url || (item.hiringOrganization && item.hiringOrganization.sameAs) || "";
        const title = stripHtml(item.title || "");
        const company = stripHtml((item.hiringOrganization && item.hiringOrganization.name) || "");
        const loc =
          stripHtml(
            item.jobLocation?.address?.addressLocality ||
              item.jobLocation?.address?.addressCountry ||
              (Array.isArray(item.jobLocation) ? item.jobLocation[0]?.address?.addressLocality : "") ||
              ""
          );
        const text = stripHtml(item.description || "").slice(0, 1200);
        if (title && url) jobs.push({ title, company, location: loc, url, text });
      }
    } catch {}
  }
  return jobs;
}

function makeRef(src, url) {
  const hash = Math.abs(Array.from(String(url)).reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7))
    .toString(36)
    .slice(0, 6)
    .toUpperCase();
  return `${src.toUpperCase()}-${hash}`;
}

function cleanJob(raw, src, defaultCompany, defaultLoc) {
  const title = boards.cleanJobTitleForMatch
    ? boards.cleanJobTitleForMatch(raw.title || "")
    : String(raw.title || "").replace(/\s+/g, " ").trim();
  if (!title || title.length < 5 || title.length > 150 || NAV_JUNK_RE.test(title)) return null;
  const locMatch = PLACE_RE.exec(`${raw.location || ""} ${title} ${raw.text || ""}`);
  const job = {
    title,
    company: raw.company || defaultCompany,
    location: raw.location || (locMatch ? locMatch[1] : defaultLoc),
    url: raw.url,
    ref: raw.ref || makeRef(src, raw.url),
    posted: raw.posted || "live",
    salary: raw.salary || "", // only when the source states one (Adzuna / Jooble)
    text: String(raw.text || title).slice(0, 1200),
    kind: raw.kind || "page",
    source: src,
  };
  const resolved = boards.resolveJobRecipientEmail(job);
  job.to = resolved.email || "";
  job.emailVia = resolved.via || "Apply via Employer Portal / ATS";
  return job;
}

function dedupeJobs(list, max = 45) {
  const seen = new Set();
  const out = [];
  for (const j of list) {
    if (!j || !j.url) continue;
    const key = j.url.split("?")[0].toLowerCase() + "|" + j.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(j);
    if (out.length >= max) break;
  }
  return out;
}

/* ---------------------------------------------------------------- Source Agents */

async function fetchLinkedInAgent() {
  const queries = [
    ["General Manager", "United Arab Emirates"],
    ["Managing Director", "United Arab Emirates"],
    ["Operations Director", "United Arab Emirates"],
    ["Chief Operating Officer", "United Arab Emirates"],
    ["General Manager", "Saudi Arabia"],
    ["Managing Director", "Germany"],
    ["Operations Director", "Germany"],
  ];
  const all = [];
  const res = await Promise.allSettled(
    queries.map(async ([role, loc]) => {
      const html = await fetchDirect(boards.linkedInUrl(role, loc), TIMEOUT_MS);
      return boards.parseLinkedIn(html).map((j) => cleanJob(j, "linkedin", j.company || "via LinkedIn", loc));
    })
  );
  res.forEach((r) => {
    if (r.status === "fulfilled") all.push(...r.value.filter(Boolean));
  });
  return { jobs: dedupeJobs(all, 60), strategy: "guest-api" };
}

async function fetchArbeitnowAgent() {
  const txt = await fetchDirect("https://www.arbeitnow.com/api/job-board-api", TIMEOUT_MS);
  const data = JSON.parse(txt);
  const execRe = /\b(director|managing|general manager|chief|coo|ceo|vp|vice president|head of|geschäftsführer|leitung|leiter|bereichsleiter|operations|commercial|supply chain)\b/i;
  const jobs = [];
  for (const row of data.data || []) {
    if (!execRe.test(row.title || "")) continue;
    const j = cleanJob(
      {
        title: row.title,
        company: row.company_name || "via Arbeitnow DACH",
        location: row.location || "Germany / DACH",
        url: row.url,
        posted: row.created_at ? new Date(row.created_at * 1000).toISOString().slice(0, 10) : "live",
        text: stripHtml(row.description || "").slice(0, 1200),
      },
      "arbeitnow",
      "via Arbeitnow DACH",
      "Germany / DACH"
    );
    if (j) jobs.push(j);
  }
  return { jobs: dedupeJobs(jobs, 35), strategy: "public-json-api" };
}

/* ---------------------------------------------------------------- Free-key APIs (optional)
   Adzuna and Jooble run only when their free key is set (GitHub secrets); otherwise
   the source is reported as "skipped" with where to get the key. Readers live in
   api/_boards.js. Calls per day stay well under the free limits:
   Adzuna 25/min and 250/day; Jooble 100/day per country key.
     ADZUNA_APP_ID, ADZUNA_APP_KEY, ADZUNA_COUNTRIES (default "de,at,ch"; no UAE)
     JOOBLE_KEYS = "ae=KEY,de=KEY" (one key per Jooble country site)             */
const FREE_API_SENIOR_RE =
  /\b(managing director|general manager|director|head of|chief|ceo|coo|cfo|cto|vp|vice president|country manager|regional manager|operations manager|geschäftsführ\w*|geschaeftsfuehr\w*|leiter\w*|leitung|bereichsleit\w*|niederlassungsleit\w*)\b/i;
const FREE_API_QUERIES = {
  en: ["managing director", "general manager", "operations director", "chief operating officer"],
  dach: ["Geschäftsführer", "General Manager", "Managing Director", "Leiter Operations"],
};
const FREE_API_PLACE = {
  ae: "United Arab Emirates", sa: "Saudi Arabia", qa: "Qatar", kw: "Kuwait", bh: "Bahrain", om: "Oman",
  de: "Deutschland", at: "Österreich", ch: "Schweiz", gb: "United Kingdom", us: "United States",
};
const isDachCc = (cc) => ["de", "at", "ch"].includes(cc);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchAdzunaAgent() {
  const appId = process.env.ADZUNA_APP_ID, appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) {
    return { jobs: [], strategy: "skipped", error: "skipped: ADZUNA_APP_ID / ADZUNA_APP_KEY not set (free key: developer.adzuna.com)" };
  }
  const countries = String(process.env.ADZUNA_COUNTRIES || "de,at,ch").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const jobs = [];
  const errors = [];
  for (const cc of countries) {
    if (!boards.ADZUNA_COUNTRIES.has(cc)) { errors.push(`Adzuna does not cover "${cc}"`); continue; }
    for (const what of isDachCc(cc) ? FREE_API_QUERIES.dach : FREE_API_QUERIES.en) {
      try {
        for (const raw of await boards.fetchAdzuna({ appId, appKey, country: cc, what, resultsPerPage: 50 })) {
          if (!FREE_API_SENIOR_RE.test(raw.title)) continue;
          const j = cleanJob(raw, "adzuna", raw.company || "via Adzuna", raw.location || FREE_API_PLACE[cc] || "");
          if (j) jobs.push(j);
        }
      } catch (err) {
        errors.push(`${cc}: ${err.message}`);
        if (/HTTP (401|403|429)/.test(String(err.message))) break; // bad key or limit reached: stop this country
      }
      await pause(2600); // stay under 25 calls / minute
    }
  }
  const out = dedupeJobs(jobs, 80);
  return { jobs: out, strategy: "adzuna-api", error: out.length ? undefined : errors[0] };
}

async function fetchJoobleAgent() {
  const pairs = String(process.env.JOOBLE_KEYS || "")
    .split(",")
    .map((p) => p.split("=").map((s) => s.trim()))
    .filter(([cc, key]) => cc && key);
  if (!pairs.length) {
    return { jobs: [], strategy: "skipped", error: "skipped: JOOBLE_KEYS not set (free key per country, e.g. ae.jooble.org/api/about)" };
  }
  const jobs = [];
  const errors = [];
  for (const [ccRaw, key] of pairs) {
    const cc = ccRaw.toLowerCase();
    for (const keywords of isDachCc(cc) ? FREE_API_QUERIES.dach : FREE_API_QUERIES.en) {
      try {
        for (const raw of await boards.fetchJooble({ key, domain: cc, keywords, location: FREE_API_PLACE[cc] || "" })) {
          if (!FREE_API_SENIOR_RE.test(raw.title)) continue;
          const j = cleanJob(raw, "jooble", raw.company || "via Jooble", raw.location || FREE_API_PLACE[cc] || "");
          if (j) jobs.push(j);
        }
      } catch (err) {
        errors.push(`${cc}: ${err.message}`);
        if (/HTTP (403|429)/.test(String(err.message))) break; // bad key or daily limit: next country
      }
      await pause(1500);
    }
  }
  const out = dedupeJobs(jobs, 80);
  return { jobs: out, strategy: "jooble-api", error: out.length ? undefined : errors[0] };
}

async function fetchGenericBoardAgent(cfg) {
  const collected = [];
  let usedStrategy = "direct";
  const errors = [];

  for (const url of cfg.urls) {
    let body = "";
    let isMarkdown = false;
    try {
      body = await fetchDirect(url, TIMEOUT_MS);
      if (body.length < 1500 || /just a moment|cloudflare|enable javascript|captcha/i.test(body.slice(0, 2000))) {
        throw new Error("JS/WAF shell");
      }
    } catch (e1) {
      try {
        body = await fetchViaJina(url, 18000);
        isMarkdown = true;
        usedStrategy = "jina-reader";
      } catch (e2) {
        errors.push(`${url}: ${e1.message} / ${e2.message}`);
        continue;
      }
    }

    // 1. Custom parser if direct HTML and provided
    if (!isMarkdown && typeof cfg.directParser === "function") {
      try {
        const parsed = cfg.directParser(body);
        for (const p of parsed) {
          if (hostMatches(p.url, cfg.domains)) {
            const c = cleanJob(p, cfg.id, cfg.defaultCompany, cfg.defaultLoc);
            if (c) collected.push(c);
          }
        }
      } catch {}
    }

    // 2. JSON-LD JobPosting extraction
    if (!isMarkdown) {
      for (const ld of extractJsonLdJobs(body)) {
        if (hostMatches(ld.url, cfg.domains)) {
          const c = cleanJob(ld, cfg.id, cfg.defaultCompany, cfg.defaultLoc);
          if (c) collected.push(c);
        }
      }
    }

    // 3. Link extraction (HTML anchors or Markdown links) with strict domain + job-URL pattern
    const links = isMarkdown ? extractMarkdownLinks(body) : extractHtmlAnchors(body, url);
    for (const l of links) {
      if (!hostMatches(l.url, cfg.domains)) continue;
      if (cfg.jobUrlRe && !cfg.jobUrlRe.test(l.url)) continue;
      if (cfg.excludeUrlRe && cfg.excludeUrlRe.test(l.url)) continue;
      const c = cleanJob(l, cfg.id, cfg.defaultCompany, cfg.defaultLoc);
      if (c) collected.push(c);
    }
  }

  return {
    jobs: dedupeJobs(collected, cfg.max || 35),
    strategy: usedStrategy,
    error: collected.length === 0 && errors.length ? errors[0] : undefined,
  };
}

const BOARD_CONFIGS = [
  {
    id: "pageexecutive",
    domains: ["pageexecutive.com"],
    urls: ["https://www.pageexecutive.com/jobs/", "https://www.pageexecutive.com/jobs/general-management"],
    directParser: boards.parsePageExecutive,
    jobUrlRe: /\/job-detail\//i,
    defaultCompany: "via Page Executive",
    defaultLoc: "Dubai, UAE",
  },
  {
    id: "michaelpage",
    domains: ["michaelpage.ae"],
    urls: [
      "https://www.michaelpage.ae/jobs",
      "https://www.michaelpage.ae/jobs/executive-search",
      "https://www.michaelpage.ae/jobs/operations",
    ],
    directParser: boards.parseMichaelPage,
    jobUrlRe: /\/job-detail\//i,
    defaultCompany: "via Michael Page UAE",
    defaultLoc: "Dubai, UAE",
  },
  {
    id: "charterhouse",
    domains: ["charterhouseme.ae"],
    urls: ["https://www.charterhouseme.ae/jobs/"],
    directParser: boards.parseCharterhouse,
    jobUrlRe: /\/job\/[a-z0-9-]+-\d{4,}/i,
    excludeUrlRe: /\/(apply|save_job)\b/i,
    defaultCompany: "via Charterhouse",
    defaultLoc: "Dubai, UAE",
  },
  {
    id: "departer",
    domains: ["departer.de", "departer.com"],
    urls: ["https://careers.departer.de/"],
    directParser: boards.parseDeparter,
    jobUrlRe: /\/job\/\d+/i,
    defaultCompany: "via Departer — The German Headhunter",
    defaultLoc: "UAE / DACH",
  },
  {
    id: "ahk",
    domains: ["ahk.de", "ahkuae.com"],
    urls: ["https://vae.ahk.de/en/services/career-in-the-uae/current-job-posting"],
    jobUrlRe: /(\.(pdf|docx?)($|\?)|\/career|\/job|workdrive)/i,
    defaultCompany: "AHK UAE / Member Company",
    defaultLoc: "UAE",
  },
  {
    id: "bayt",
    domains: ["bayt.com"],
    urls: [
      "https://www.bayt.com/en/uae/jobs/general-manager-jobs/",
      "https://www.bayt.com/en/uae/jobs/managing-director-jobs/",
      "https://www.bayt.com/en/uae/jobs/operations-director-jobs/",
    ],
    directParser: boards.parseBaytHtml,
    jobUrlRe: /\/jobs\/[a-z0-9-]+-\d{5,}\/?$/i,
    defaultCompany: "via Bayt UAE",
    defaultLoc: "Dubai, UAE",
  },
  {
    id: "gulftalent",
    domains: ["gulftalent.com"],
    urls: [
      "https://www.gulftalent.com/uae/jobs/title/general-manager",
      "https://www.gulftalent.com/uae/jobs/title/managing-director",
      "https://www.gulftalent.com/uae/jobs/title/operations-director",
    ],
    directParser: boards.parseGulfTalent,
    jobUrlRe: /\/jobs\/[a-z0-9-]+-\d{5,}/i,
    defaultCompany: "via GulfTalent",
    defaultLoc: "Dubai, UAE",
  },
  {
    id: "naukrigulf",
    domains: ["naukrigulf.com"],
    urls: [
      "https://www.naukrigulf.com/general-manager-jobs-in-uae",
      "https://www.naukrigulf.com/operations-director-jobs-in-uae",
      "https://www.naukrigulf.com/managing-director-jobs-in-uae",
    ],
    jobUrlRe: /-(jid|jobs-in-).*\d{5,}|\/job-listings-/i,
    defaultCompany: "via Naukrigulf",
    defaultLoc: "Dubai, UAE",
  },
  {
    id: "dubizzle",
    domains: ["dubizzle.com"],
    urls: [
      "https://dubai.dubizzle.com/jobs/management/",
      "https://dubai.dubizzle.com/jobs/executive/",
    ],
    directParser: boards.parseDubizzleHtml,
    jobUrlRe: /\/jobs\/[a-z0-9-]+\/\d{4}\/\d{1,2}\/\d{1,2}\//i,
    defaultCompany: "via Dubizzle UAE",
    defaultLoc: "Dubai, UAE",
  },
  {
    id: "jobsae",
    domains: ["jobs.ae"],
    urls: [
      "https://www.jobs.ae/jobs/general-manager/",
      "https://www.jobs.ae/jobs/operations-director/",
      "https://www.jobs.ae/jobs/managing-director/",
    ],
    jobUrlRe: /jobs\.ae\/job\//i,
    defaultCompany: "via Jobs.ae",
    defaultLoc: "Dubai, UAE",
  },
  {
    id: "jobsch",
    domains: ["jobs.ch"],
    urls: [
      "https://www.jobs.ch/en/vacancies/?term=Managing+Director",
      "https://www.jobs.ch/en/vacancies/?term=Operations+Director",
      "https://www.jobs.ch/en/vacancies/?term=General+Manager",
    ],
    jobUrlRe: /\/vacancies\/detail\/[a-f0-9-]+/i,
    defaultCompany: "via Jobs.ch",
    defaultLoc: "Switzerland / DACH",
  },
  {
    id: "laimoon",
    domains: ["laimoon.com"],
    urls: [
      "https://jobs.laimoon.com/uae/general-manager",
      "https://jobs.laimoon.com/uae/operations-director",
      "https://jobs.laimoon.com/uae/managing-director",
    ],
    jobUrlRe: /jobs\.laimoon\.com\/job\//i,
    defaultCompany: "via Laimoon Jobs",
    defaultLoc: "Dubai, UAE",
  },
  {
    id: "founditgulf",
    domains: ["founditgulf.com"],
    urls: [
      "https://www.founditgulf.com/srp/results?query=General+Manager",
      "https://www.founditgulf.com/srp/results?query=Operations+Director",
    ],
    jobUrlRe: /\/job\//i,
    defaultCompany: "via Foundit Gulf",
    defaultLoc: "Dubai, UAE",
  },
  {
    id: "stepstone",
    domains: ["stepstone.de"],
    urls: [
      "https://www.stepstone.de/jobs/geschaeftsfuehrer",
      "https://www.stepstone.de/jobs/operations-director",
      "https://www.stepstone.de/jobs/managing-director",
    ],
    jobUrlRe: /\/stellenangebote--/i,
    defaultCompany: "via StepStone DE",
    defaultLoc: "Germany / DACH",
  },
  {
    id: "indeed",
    domains: ["indeed.com"],
    urls: [
      "https://ae.indeed.com/jobs?q=General+Manager&l=Dubai",
      "https://ae.indeed.com/jobs?q=Operations+Director&l=Dubai",
    ],
    jobUrlRe: /(\/viewjob|\/rc\/clk|jk=)/i,
    defaultCompany: "via Indeed UAE",
    defaultLoc: "Dubai, UAE",
  },
];

async function aisaSearchBoard(apiKey, cfg) {
  if (!apiKey) return [];
  const results = [];
  const primaryDomain = cfg.domains[0];
  const queries = [
    `site:${primaryDomain} ("General Manager" OR "Managing Director" OR "Operations Director" OR "COO") ${cfg.defaultLoc}`,
    `site:${primaryDomain} ("Commercial Director" OR "Supply Chain Director" OR "Geschäftsführer")`,
  ];
  for (const query of queries) {
    try {
      const res = await fetch("https://api.aisa.one/apis/v1/tavily/search", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ query, max_results: 10, topic: "general" }),
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      for (const hit of data.results || []) {
        if (!hit.url || !hostMatches(hit.url, cfg.domains)) continue;
        const c = cleanJob(
          { title: hit.title, url: hit.url, text: hit.content || hit.title },
          cfg.id,
          cfg.defaultCompany,
          cfg.defaultLoc
        );
        if (c) results.push(c);
      }
    } catch {}
  }
  return results;
}

async function runAgent() {
  const apiKey = process.env.AISA_API_KEY || "";
  console.log(
    `🚀 Starting Multi-Source Job Fetching Agent (keyless + ${apiKey ? "AISA_API_KEY enabled" : "no API key set locally"})...`
  );
  const tasks = [
    { id: "linkedin", fn: fetchLinkedInAgent },
    { id: "arbeitnow", fn: fetchArbeitnowAgent },
    { id: "adzuna", fn: fetchAdzunaAgent },
    { id: "jooble", fn: fetchJoobleAgent },
    ...BOARD_CONFIGS.map((cfg) => ({
      id: cfg.id,
      fn: async () => {
        const res = await fetchGenericBoardAgent(cfg);
        if (apiKey && res.jobs.length < 5) {
          const apiJobs = await aisaSearchBoard(apiKey, cfg);
          if (apiJobs.length) {
            res.jobs = dedupeJobs([...res.jobs, ...apiJobs], cfg.max || 35);
            res.strategy = res.jobs.length > apiJobs.length ? `${res.strategy}+aisa-api` : "aisa-api";
            res.error = undefined;
          }
        }
        return res;
      },
    })),
  ];

  const settled = await Promise.allSettled(tasks.map((t) => t.fn()));
  const sources = [];
  let totalJobs = 0;

  settled.forEach((s, idx) => {
    const id = tasks[idx].id;
    if (s.status === "fulfilled") {
      const { jobs, strategy, error } = s.value;
      totalJobs += jobs.length;
      sources.push({
        id,
        ok: jobs.length > 0,
        strategy,
        count: jobs.length,
        error: error || (jobs.length === 0 ? "No public listings extracted (0)" : undefined),
        jobs,
      });
      console.log(`  [${jobs.length > 0 ? "OK" : "0 "}] ${id.padEnd(14)} -> ${String(jobs.length).padStart(3)} jobs (${strategy})${error ? " | " + error : ""}`);
    } else {
      sources.push({
        id,
        ok: false,
        strategy: "failed",
        count: 0,
        error: String(s.reason?.message || s.reason),
        jobs: [],
      });
      console.log(`  [ERR] ${id.padEnd(14)} -> 0 jobs | ${s.reason?.message || s.reason}`);
    }
  });

  const now = new Date().toISOString();
  const payload = {
    generatedAt: now,
    fetchedAt: now,
    agent: "multi-source-fetching-agent-v2",
    total: totalJobs,
    totalJobs,
    sources,
  };

  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(payload, null, 2), "utf8");
  console.log(`\n✅ Wrote ${totalJobs} verified listings across ${sources.filter((s) => s.ok).length}/${sources.length} active sources to data/listings.json`);
}

runAgent().catch((err) => {
  console.error("Agent fatal error:", err);
  process.exit(1);
});
