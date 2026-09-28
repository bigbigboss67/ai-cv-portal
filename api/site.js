/**
 * GET /api/site?name=<company>&where=<city>[&linkedin=<LinkedIn job link or id>]
 *
 * Resolves the company's official website and any application email printed on its
 * LinkedIn job posting. Works with AISA_API_KEY when present AND falls back to
 * DuckDuckGo HTML search when AISA_API_KEY is not set, so employer website & email
 * resolution works out-of-the-box on every deployment.
 */

const AISA = "https://api.aisa.one/apis/v1";
const TIMEOUT_MS = 12000;
const boards = require("./_boards.js");
const { UA } = boards;

const NOT_A_SITE =
  /(^|\.)(linkedin|bayt|gulftalent|naukri(gulf)?|indeed|glassdoor|monster|stepstone|xing|jooble|jobs?|careers?|dubizzle|facebook|instagram|twitter|x|youtube|tiktok|wikipedia|crunchbase|bloomberg|zoominfo|dnb|yellowpages|yelp|google|bing|duckduckgo|pinterest|medium|wordpress|blogspot|amazon|apple)\.[a-z.]+$/i;

const FORMS =
  /\b(llc|l\.l\.c|fz-?llc|fze|fz|dmcc|ltd|limited|inc|corp|corporation|plc|gmbh|ag|sarl|sa|bv|nv|pte|pty|co|company|group|holdings?|international|trading|general)\b/gi;

const slug = (s) => String(s || "").toLowerCase().replace(FORMS, " ").replace(/[^a-z0-9]+/g, "");
const hostOf = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
};
const originOf = (u) => {
  try {
    return new URL(u).origin;
  } catch {
    return "";
  }
};
const hostWord = (h) => String(h).split(".")[0].replace(/[^a-z0-9]/g, "");

function pick(results, name) {
  const want = slug(name);
  if (!want) return null;
  const scored = [];
  for (const r of results || []) {
    const host = hostOf(r.url);
    if (!host || NOT_A_SITE.test(host)) continue;
    const word = hostWord(host);
    let score = 0;
    if (word === want) score += 6;
    else if (word.length >= 4 && (want.includes(word) || word.includes(want))) score += 4;
    else if (want.length >= 5 && word.length >= 5 && want.slice(0, 5) === word.slice(0, 5)) score += 2;
    const title = String(r.title || "").toLowerCase();
    if (title.includes(String(name).toLowerCase().slice(0, 18))) score += 1;
    if (score > 0) scored.push({ url: originOf(r.url), host, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored[0] || null;
}

async function searchSite(key, query, signal) {
  if (key) {
    try {
      const res = await fetch(`${AISA}/tavily/search`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query, max_results: 8, topic: "general" }),
        signal,
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.results) && data.results.length) return data.results;
      }
    } catch {}
  }
  return boards.fetchDuckDuckGoJobs(query, 9000);
}

const LI_TIMEOUT_MS = 7000;

async function fromLinkedIn(ref) {
  const L = await import("../linkedin-company.js");
  const id = L.jobIdOf(ref);
  if (!id) return null;
  const get = async (url) => {
    const r = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml", "accept-language": "en-US,en;q=0.9" },
      redirect: "follow",
      signal: AbortSignal.timeout(LI_TIMEOUT_MS),
    });
    const body = r.ok ? await r.text() : "";
    return { ok: r.ok && !/authwall|login|checkpoint/i.test(r.url || ""), status: r.status, body };
  };
  const p = await get(L.POSTING + id);
  if (!p.ok) return { code: p.status === 404 ? "posting-gone" : "blocked", slug: "", emails: { apply: [], other: [] } };
  const emails = L.postingAddresses(p.body);
  const slug = L.companySlugOf(p.body);
  if (!slug) return { code: "no-company-page", slug: "", emails };
  const c = await get(L.companyUrl(slug));
  if (!c.ok) return { code: c.status === 404 ? "no-company-page" : "blocked", slug, emails };
  const site = L.websiteOf(c.body);
  return site ? { site, slug, emails } : { code: "no-website", slug, emails };
}

async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");

  const q = req.query || {};
  const name = String(q.name || "").trim().slice(0, 120);
  const where = String(q.where || "").trim().slice(0, 60);
  const linkedin = String(q.linkedin || "").trim().slice(0, 400);
  if (name.length < 2 && !linkedin) {
    res.status(400).json({ ok: false, error: "A company name is needed." });
    return;
  }

  let li = null;
  if (linkedin) {
    try {
      li = await fromLinkedIn(linkedin);
    } catch {
      li = { code: "blocked", slug: "", emails: { apply: [], other: [] } };
    }
    if (li && li.site) {
      res.status(200).json({
        ok: true,
        url: li.site,
        host: hostOf(li.site),
        confidence: "high",
        how: "linkedin",
        slug: li.slug,
        emails: li.emails,
      });
      return;
    }
  }
  const fromLi = li ? { liCode: li.code, slug: li.slug, emails: li.emails } : {};

  if (name.length < 2 || q.nosearch) {
    const code = li ? li.code : "no-name";
    res.status(200).json({ ok: false, code, ...fromLi, error: "Could not resolve company website." });
    return;
  }

  const key = process.env.AISA_API_KEY || "";
  const query = `"${name}" official website${where ? " " + where : ""}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const results = await searchSite(key, query, ac.signal);
    const hit = pick(results, name);
    if (!hit) {
      res.status(200).json({
        ok: false,
        code: "not-found",
        query,
        ...fromLi,
        error: `No site came back that matches "${name}".`,
      });
      return;
    }
    res.status(200).json({
      ok: true,
      url: hit.url,
      host: hit.host,
      confidence: hit.score >= 6 ? "high" : hit.score >= 4 ? "likely" : "weak",
      how: "search",
      query,
      ...fromLi,
    });
  } catch (err) {
    res.status(200).json({
      ok: false,
      code: "search-failed",
      query,
      ...fromLi,
      error: String((err && err.message) || err),
    });
  } finally {
    clearTimeout(timer);
  }
}

module.exports = handler;
module.exports.fromLinkedIn = fromLinkedIn;
module.exports.pick = pick;
module.exports.slug = slug;
