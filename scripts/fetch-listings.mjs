/**
 * Fetch AHK and Departer vacancies and write data/listings.json.
 *
 * Runs in GitHub Actions, not in the browser: both sites block cross-origin
 * requests, and a static site has nowhere to run a scheduled job.
 *
 *   node scripts/fetch-listings.mjs
 *
 * Design note — every source records its own status. A source that returns zero
 * listings writes an error rather than an empty array, because a broken selector
 * and a genuinely quiet job board look identical in the output otherwise, and the
 * first is silent for months.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import boards from "../api/_boards.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const decode = (s) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
   .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, " ")
   .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
   .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d));

const strip = (s) => decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

async function get(url) {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.text();
}

/** Every <a> on the page, absolute href plus its visible text. */
function anchors(html, base) {
  const out = [];
  for (const m of html.matchAll(/<a\b([^>]*?)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = m[2].trim();
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) continue;
    let abs;
    try { abs = new URL(href, base).href; } catch { continue; }
    out.push({ href: abs, text: strip(m[4]) });
  }
  return out;
}

/* ── AHK ──────────────────────────────────────────────────────────
   Vacancies here are a mix of inline links and PDF blobs, and the page
   is frequently empty — which is itself worth recording. Use the ENGLISH
   URL: the German page drops the member-company section entirely.        */
const AHK_URL = "https://vae.ahk.de/en/services/career-in-the-uae/current-job-posting";

function parseAhk(html) {
  const base = AHK_URL;
  const jobWords = /(manager|director|officer|coordinator|assistant|consultant|intern|specialist|head of|executive|advisor|clerk|sachbearbeiter|referent)/i;
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
      company: "AHK VAE / member company",
      location: "UAE",
      url: a.href,
      kind: isDoc ? "document" : "page",
    });
  }
  return jobs;
}

/* ── Departer ─────────────────────────────────────────────────────
   Posting URLs follow careers.departer.de/job/<id>/<slug>. Note the DNS
   for this host fails from some networks; a failure here is recorded, not
   swallowed.                                                             */
const DEPARTER_URL = "https://careers.departer.de/";

function parseDeparter(html) {
  const seen = new Set();
  const jobs = [];
  for (const a of anchors(html, DEPARTER_URL)) {
    const m = a.href.match(/careers\.departer\.de\/job\/(\d+)(?:\/([\w-]+))?/i);
    if (!m) continue;
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    const title = a.text || (m[2] || "").replace(/-/g, " ");
    if (!title) continue;
    jobs.push({
      title,
      company: "via Departer — The German Headhunter",
      location: /dubai|uae|emirat|abu dhabi|sharjah/i.test(title) ? "UAE" : "",
      url: a.href,
      ref: m[1],
      kind: "page",
    });
  }
  return jobs;
}

/* ── Charterhouse ────────────────────────────────────
   Gulf recruiter. Postings are /job/<slug>-<id>, each rendered three times
   on the board: the title link, an /apply link and a /save_job link. Only
   the bare detail URL is a listing, and the card also emits a second anchor
   reading "Read More" to the same href — both are filtered here.

   Tried and rejected while choosing this source: Bayt returns 200 to curl
   but 403 to Node with identical headers (TLS fingerprinting), and Hays
   renders its results client-side, leaving one job link in the HTML. Both
   would have failed every night in CI.                                    */
const CHARTER_URL = "https://www.charterhouseme.ae/jobs/";
const CHARTER_JOB = /\/job\/([a-z0-9-]+?-(\d{4,}))$/i;
const CHARTER_PLACE =
  /(Dubai|Abu Dhabi|Sharjah|UAE|Riyadh|Saudi|Doha|Qatar|Kuwait|Bahrain|Oman)/i;

function parseCharterhouse(html) {
  const seen = new Set();
  const jobs = [];
  for (const a of anchors(html, CHARTER_URL)) {
    const m = CHARTER_JOB.exec(a.href.split("?")[0]);
    if (!m) continue;
    if (!a.text || /^(read more|apply|save job)$/i.test(a.text)) continue;
    if (a.text.length < 4 || a.text.length > 160) continue;
    if (seen.has(m[2])) continue;
    seen.add(m[2]);
    const place = CHARTER_PLACE.exec(a.text);
    jobs.push({
      title: a.text,
      company: "via Charterhouse",
      location: place ? place[1] : "",
      url: a.href.split("?")[0],
      ref: m[2],
      kind: "page",
    });
  }
  return jobs;
}

/* ── Michael Page ─────────────────────────────────────────────────
   Postings are /job-detail/<slug>/ref/<jn-ref>. Every listing appears twice
   in the markup (card title and card body both link out), so dedupe on the
   ref rather than trusting the anchor count.

   This is the .ae site, but its feed is regional: Riyadh, Doha and even
   Algiers roles appear. Location is therefore read out of the title when it
   is stated and left empty otherwise, rather than stamping everything UAE. */
const MPAGE_URL = "https://www.michaelpage.ae/jobs";
const MPAGE_JOB = /\/job-detail\/[^/]+\/ref\/([a-z0-9-]+)/i;
const MPAGE_PLACE =
  /(Dubai|Abu Dhabi|Sharjah|UAE|United Arab Emirates|Riyadh|Saudi|Doha|Qatar|Kuwait|Bahrain|Oman|Muscat|Cairo|Egypt|Alg[eé]rie|Algeria)/i;

function parseMichaelPage(html) {
  const seen = new Set();
  const jobs = [];
  for (const a of anchors(html, MPAGE_URL)) {
    const m = MPAGE_JOB.exec(a.href);
    if (!m) continue;
    if (!a.text || a.text.length < 4 || a.text.length > 160) continue;
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    const place = MPAGE_PLACE.exec(a.text);
    jobs.push({
      title: a.text,
      company: "via Michael Page",
      location: place ? place[1] : "",
      url: a.href.split("?")[0],
      ref: m[1],
      kind: "page",
    });
  }
  return jobs;
}

/* ── Page Executive ───────────────────────────────────
   Michael Page's executive-search arm, same platform and therefore the same
   /job-detail/<slug>/ref/<jn-ref> shape and the same duplicate-anchor quirk.
   Worth carrying separately: this board is director-and-above only, where the
   main Michael Page feed runs from analyst upwards.                        */
const PEXEC_URL = "https://www.pageexecutive.com/jobs/";

function parsePageExecutive(html) {
  const seen = new Set();
  const jobs = [];
  for (const a of anchors(html, PEXEC_URL)) {
    const m = MPAGE_JOB.exec(a.href);
    if (!m) continue;
    if (!a.text || a.text.length < 4 || a.text.length > 160) continue;
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    const place = MPAGE_PLACE.exec(a.text);
    jobs.push({
      title: a.text,
      company: "via Page Executive",
      location: place ? place[1] : "",
      url: a.href.split("?")[0],
      ref: m[1],
      kind: "page",
    });
  }
  return jobs;
}

/* ── Open web search ──────────────────────────────────
   Every other source here is one board, so the board's blind spots are the
   portal's blind spots. This one searches the open web instead, through the
   same AIsa endpoint that /api/match uses on demand — so the scheduled board
   and the CV matcher see the same internet.

   What it returns are board result pages rather than individual vacancies, so
   its entries carry kind:"search". That is the point of it: these are the very
   boards that refuse to be scraped directly — Bayt and GulfTalent both answer
   403 — reached through the front door instead.

   Needs AISA_API_KEY as a repository secret. Without it this source fails,
   which the carry-forward guard turns into "stale" rather than a silent zero. */
const AISA_SEARCH = "https://api.aisa.one/apis/v1/tavily/search";
const AISA_QUERIES = [
  "managing director jobs Dubai UAE hiring now",
  "general manager vacancy Abu Dhabi Sharjah UAE apply",
  "Geschaeftsfuehrer Stellenangebot Vereinigte Arabische Emirate",
];
const AISA_PLACE =
  /(Dubai|Abu Dhabi|Sharjah|UAE|United Arab Emirates|Qatar|Doha|Saudi|Riyadh|Kuwait|Bahrain|Oman)/i;

async function collectWebSearch() {
  const key = process.env.AISA_API_KEY;
  const seen = new Set();
  const jobs = [];

  for (const query of AISA_QUERIES) {
    let results = [];
    if (key) {
      try {
        const res = await fetch(AISA_SEARCH, {
          method: "POST",
          headers: {
            authorization: `Bearer ${key}`,
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({ query, max_results: 8, topic: "general" }),
        });
        if (res.ok) {
          const data = await res.json();
          results = data.results || [];
        }
      } catch {}
    }
    if (!results.length) {
      results = await boards.fetchDuckDuckGoJobs(query, 10000);
    }

    for (const r of results || []) {
      const url = String(r.url || "");
      if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
      seen.add(url);
      const text = `${r.title || ""} ${r.content || ""}`;
      const place = AISA_PLACE.exec(text);
      let host = "";
      try { host = new URL(url).hostname.replace(/^www\./, ""); } catch {}
      jobs.push({
        title: r.title || url,
        company: host ? `via ${host}` : "via open web search",
        location: place ? place[1] : "UAE",
        url,
        kind: "page",
      });
    }
  }
  return jobs;
}

/* ── LinkedIn and GulfTalent ─────────────────────────
   The two biggest channels for senior UAE roles that answer a server directly
   (api/_boards.js has the readers, shared with the live CV search). LinkedIn is
   read only through the job search it shows logged-out visitors — no account,
   no cookies. One page per role, with a pause between requests, so a day's run
   is a handful of reads on each site.                                       */
const BOARD_ROLES = [
  "managing director", "general manager", "operations director", "chief executive officer",
  "chief operating officer", "country manager", "business development director",
];
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function collectBoard(url, parse) {
  const seen = new Set();
  const jobs = [];
  for (const role of BOARD_ROLES) {
    for (const j of parse(await boards.fetchText(url(role), 20000))) {
      if (seen.has(j.ref)) continue;
      seen.add(j.ref);
      jobs.push(j);
    }
    await pause(1500);
  }
  return jobs;
}
const collectLinkedIn = () => collectBoard((r) => boards.linkedInUrl(r, "United Arab Emirates"), boards.parseLinkedIn);
/* GulfTalent was read here until 20 September 2026, when it began answering 403
   to this machine and to GitHub Actions alike. Its reader is still in
   api/_boards.js, tested, for the day it lets a robot in again. */

/* `audience` says who a source is for: the market it covers, and the language a
   candidate needs before its listings are worth showing them. Two of these are
   German-diaspora channels in the Gulf — real, and not for everybody. The fetch
   collects them all either way, because one shared file serves every candidate;
   the filtering belongs where a candidate is known. */
const SOURCES = [
  { id: "ahk", name: "AHK VAE — Current Job Posting", url: AHK_URL, parse: parseAhk, audience: { market: "gulf", lang: "de" } },
  { id: "departer", name: "Departer — The German Headhunter", url: DEPARTER_URL, parse: parseDeparter, audience: { market: "gulf", lang: "de" } },
  { id: "charterhouse", name: "Charterhouse — Middle East", url: CHARTER_URL, parse: parseCharterhouse, audience: { market: "gulf" } },
  { id: "michaelpage", name: "Michael Page — Middle East", url: MPAGE_URL, parse: parseMichaelPage, audience: { market: "gulf" } },
  { id: "pageexecutive", name: "Page Executive — director level and above", url: PEXEC_URL, parse: parsePageExecutive, audience: { market: "gulf" } },
  { id: "linkedin", name: "LinkedIn — public job search, senior UAE roles", url: "https://www.linkedin.com/jobs/search?location=United%20Arab%20Emirates", collect: collectLinkedIn, audience: { market: "gulf" } },
  { id: "websearch", name: "Open web search (AIsa)", url: AISA_SEARCH, collect: collectWebSearch, audience: { market: "gulf" } },
];

/**
 * The previous run, if the file is there and parses.
 *
 * A source that fails should not silently drop its listings: a network blip
 * would empty a panel that was fine yesterday, and the portal would show
 * "0 open" where the honest answer is "we could not look today". The last
 * good jobs are carried forward and flagged stale — never passed off as fresh.
 */
async function previous() {
  try {
    const raw = await readFile(path.join(process.cwd(), "data", "listings.json"), "utf8");
    const data = JSON.parse(raw);
    const byId = new Map();
    for (const s of data.sources || []) byId.set(s.id, s);
    return { at: data.generatedAt || null, byId };
  } catch {
    return { at: null, byId: new Map() };
  }
}

async function main() {
  const prev = await previous();
  const sources = [];
  let total = 0;
  let stale = 0;

  for (const s of SOURCES) {
    const t0 = Date.now();
    try {
      // A source either scrapes one page or collects across several requests.
      const html = s.collect ? null : await get(s.url);
      const jobs = s.collect ? await s.collect() : s.parse(html);
      total += jobs.length;
      sources.push({
        id: s.id, name: s.name, url: s.url,
        audience: s.audience,
        ok: true,
        count: jobs.length,
        ms: Date.now() - t0,
        bytes: html ? html.length : undefined,
        // Zero listings from a page that loaded is ambiguous: either the board is
        // empty or the parser missed. Say which is unknown rather than implying calm.
        note: jobs.length ? null : "page loaded but no listings matched — verify the parser against the live markup before trusting this as 'nothing open'",
        jobs,
      });
      console.log(`  ${s.id.padEnd(14)} ${String(jobs.length).padStart(3)} listings  (${html ? html.length + " bytes, " : ""}${Date.now() - t0}ms)`);
    } catch (err) {
      // Carry the last good read forward rather than publishing a zero. Only a
      // hard failure qualifies: a page that loaded and genuinely returned no
      // listings is still recorded as zero above, because a board going empty
      // is real news and must not be papered over with yesterday's jobs.
      const before = prev.byId.get(s.id);
      const carried = before && Array.isArray(before.jobs) && before.jobs.length ? before : null;
      const since = carried ? (carried.staleSince || prev.at) : null;
      if (carried) { total += carried.count; stale++; }

      sources.push({
        id: s.id, name: s.name, url: s.url,
        ok: false,
        count: carried ? carried.count : 0,
        ms: Date.now() - t0,
        error: String(err.message || err),
        stale: carried ? true : undefined,
        staleSince: since || undefined,
        note: carried
          ? `fetch failed — these ${carried.count} listings are carried over from ${since}, not a fresh read`
          : undefined,
        jobs: carried ? carried.jobs : [],
      });
      console.log(
        `  ${s.id.padEnd(10)} FAILED — ${err.message}` +
        (carried ? `  (kept ${carried.count} from ${since})` : "  (no previous data to keep)")
      );
    }
  }

  const out = {
    generatedAt: new Date().toISOString(),
    total,
    // How much of `total` is yesterday's news. Zero means every number here
    // was read live in this run.
    staleSources: stale,
    sources,
  };

  await mkdir(path.join(process.cwd(), "data"), { recursive: true });
  await writeFile(path.join(process.cwd(), "data", "listings.json"), JSON.stringify(out, null, 2));
  console.log(
    `
  ${total} listings from ${sources.filter((s) => s.ok).length}/${sources.length} sources` +
    (stale ? `, ${stale} carried over stale` : "") +
    " -> data/listings.json"
  );

  // Fail the workflow when every source is down, so a dead fetcher surfaces as a
  // red run instead of a JSON file that quietly stops changing.
  if (sources.every((s) => !s.ok)) {
    console.error("\n  Every source failed. Not masking this as a successful run.");
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
