/**
 * POST /api/match
 *
 * Strict Role-Locked Multi-Board Live Internet Job Search Engine.
 * Searches across:
 *  - LinkedIn Guest Jobs API (+ full 3,500+ char posting hydration)
 *  - Indeed (UAE / GCC / Global)
 *  - Dubizzle (Dubai / UAE)
 *  - Bayt (MENA)
 *  - Naukrigulf (UAE / GCC)
 *  - GulfTalent (UAE / GCC)
 *  - Page Executive, Michael Page, Charterhouse, Departer, AHK VAE, Arbeitnow
 *  - Daily Scraped Board Feed (data/listings.json)
 *
 * Strictly filters results to the user's chosen Target Roles (e.g. General Manager,
 * Managing Director, Operations Director) so zero irrelevant or junior listings appear.
 */

const AISA = "https://api.aisa.one/apis/v1";
const MAX_CV_CHARS = 60000;
const SEARCH_TIMEOUT_MS = 28000;

const SENIORITY = [
  [/\b(chief|c-level|ceo|coo|cfo|cso|cto|managing director|general manager|geschäftsführer|vorstand)\b/i, "executive"],
  [/\b(director|vice president|vp|head of|partner|direktor|bereichsleiter)\b/i, "director"],
  [/\b(senior manager|regional manager|country manager|principal)\b/i, "senior manager"],
  [/\b(manager|lead|supervisor|teamleiter)\b/i, "manager"],
];

function phrases(text) {
  const out = new Map();
  const re = /\b([A-Z][a-zA-Z&.'-]+(?:\s+(?:of|and|&|for|de|al)?\s*[A-Z][a-zA-Z&.'-]+){1,4})\b/g;
  let m;
  while ((m = re.exec(text))) {
    const p = m[1].replace(/\s+/g, " ").trim();
    if (p.length < 6 || p.length > 60) continue;
    out.set(p, (out.get(p) || 0) + 1);
  }
  return [...out.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
}

function titles(text) {
  const re =
    /\b((?:senior |group |regional |country |deputy |executive |general )?(?:managing director|operations director|director of operations|commercial director|supply chain director|chief [a-z]+ officer|ceo|coo|cfo|cso|cto|vice president|vp|head of [a-z &]{3,28}|general manager|regional manager|country manager|project director|plant director|director))\b/gi;
  const seen = new Map();
  let m;
  while ((m = re.exec(text))) {
    const t = m[1].toLowerCase().replace(/\s+/g, " ").trim();
    seen.set(t, (seen.get(t) || 0) + 1);
  }
  return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
}

const PLACES = require("../data/places.json");
const boards = require("./_boards.js");

function places(text) {
  return PLACES.filter((p) => new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));
}

const SKILL_WORDS =
  /\b(p&l|profit and loss|budget|forecast|procurement|logistics|supply chain|import|export|wholesale|distribution|retail|real estate|construction|building materials|automotive|mobility|fleet|media|publishing|feasibility|negotiation|stakeholder|board|governance|compliance|restructuring|turnaround|market entry|business development|digital transformation|ai|crm|erp|sap|manufacturing|lean|six sigma|ebitda|capex|opex)\b/gi;

function skills(text) {
  const seen = new Map();
  let m;
  while ((m = SKILL_WORDS.exec(text))) {
    const s = m[1].toLowerCase();
    seen.set(s, (seen.get(s) || 0) + 1);
  }
  SKILL_WORDS.lastIndex = 0;
  return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
}

function readCv(text) {
  const t = String(text || "").slice(0, MAX_CV_CHARS);
  const level = (SENIORITY.find(([re]) => re.test(t)) || [null, "professional"])[1];
  const langs = ["german", "arabic", "english", "french", "spanish", "deutsch", "arabisch"].filter((l) =>
    new RegExp(`\\b${l}\\b`, "i").test(t)
  );
  return {
    level,
    titles: titles(t).slice(0, 6),
    places: places(t).slice(0, 5),
    skills: skills(t).slice(0, 14),
    phrases: phrases(t).slice(0, 12),
    languages: [...new Set(langs.map((l) => l.toLowerCase()))],
  };
}

const cleanRole = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}&/ -]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

function wantedRoles(sig, prefs) {
  if (Array.isArray(prefs.targetRoles) && prefs.targetRoles.length) {
    const arr = prefs.targetRoles.map(cleanRole).filter((r) => r.length >= 2);
    if (arr.length) return arr.slice(0, 8);
  }
  const typed = prefs.roles ? String(prefs.roles).split(/[,;\n|]/).map(cleanRole).filter(Boolean) : [];
  const defaults = sig.titles.length
    ? sig.titles.map(cleanRole)
    : ["general manager", "managing director", "operations director", "chief operating officer"];
  return (typed.length ? typed : defaults).filter((r) => r.length >= 2).slice(0, 8);
}

function buildQueries(sig, prefs) {
  const where = (prefs.location || sig.places[0] || "Dubai UAE").trim();
  const roles = wantedRoles(sig, prefs).slice(0, 4);
  const loc = where ? ` in ${where}` : "";
  return [...new Set(roles.map((r) => `"${r}" jobs${loc}`))].slice(0, 4);
}

async function stepUpRoles(sig, text, explicitStepRole = "") {
  const out = [];
  if (explicitStepRole) {
    String(explicitStepRole)
      .split(/[,;|]/)
      .map(cleanRole)
      .filter((r) => r.length >= 3)
      .forEach((r) => out.push(r));
  }
  try {
    const { stepUpTitles } = await import("../coach.js");
    const profile = { experience: (sig.titles || []).map((t) => ({ t })) };
    for (const r of stepUpTitles(profile, text).map(cleanRole)) {
      if (r.length >= 3 && !out.includes(r)) out.push(r);
    }
  } catch {}
  if (!out.length) {
    if (sig.level === "executive") out.push("chief executive officer", "group managing director", "chief operating officer");
    else if (sig.level === "director") out.push("managing director", "general manager", "operations director");
    else out.push("operations director", "general manager", "managing director");
  }
  return out.slice(0, 3);
}

const countTracks = (list) => ({
  level: list.filter((m) => m.track !== "step").length,
  step: list.filter((m) => m.track === "step").length,
});

async function aisaSearch(key, query, signal) {
  const url = `${AISA}/tavily/search`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query, max_results: 8, topic: "general" }),
    signal,
  });
  if (!res.ok) throw new Error(`AIsa ${res.status} on "${query}"`);
  const data = await res.json();
  return Array.isArray(data.results) ? data.results : [];
}

async function webSearchWithFallback(key, query, signal) {
  if (key) {
    try {
      return await aisaSearch(key, query, signal);
    } catch {}
  }
  return boards.fetchDuckDuckGoJobs(query, 9000);
}

const BOARD =
  /(linkedin|bayt|gulftalent|naukrigulf|indeed|dubizzle|efinancialcareers|glassdoor|monster|stepstone|xing|michaelpage|pageexecutive|charterhouse|departer|ahk\.de|greenhouse|lever\.co|workable|ashbyhq|jobs?\.|careers?\.)/i;
const STALE = /\b(20(1\d|2[0-4]))\b/;

function detectBoardSource(urlOrHost) {
  const s = String(urlOrHost || "").toLowerCase();
  if (s.includes("indeed")) return "indeed";
  if (s.includes("dubizzle")) return "dubizzle";
  if (s.includes("linkedin")) return "linkedin";
  if (s.includes("bayt")) return "bayt";
  if (s.includes("naukrigulf")) return "naukrigulf";
  if (s.includes("gulftalent")) return "gulftalent";
  if (s.includes("pageexecutive")) return "pageexecutive";
  if (s.includes("michaelpage")) return "michaelpage";
  if (s.includes("charterhouse")) return "charterhouse";
  if (s.includes("departer")) return "departer";
  if (s.includes("ahk.de")) return "ahk";
  if (s.includes("arbeitnow")) return "arbeitnow";
  return s || "websearch";
}

function score(hit, sig, prefs, activeRoles) {
  const hay = `${hit.title || ""} ${hit.content || ""}`.toLowerCase();
  const url = String(hit.url || "");
  let s = 45;
  const why = [];

  const matchedRole = boards.matchStrictRole(hit.title || "", activeRoles);
  if (matchedRole) {
    s += 32;
    why.push(matchedRole);
  }

  for (const sk of sig.skills) {
    if (hay.includes(sk)) {
      s += 4;
      why.push(sk);
    }
  }

  const where = (prefs.location || sig.places[0] || "").toLowerCase();
  if (where && hay.includes(where)) {
    s += 10;
    why.push(where);
  }

  if (BOARD.test(url)) s += 8;
  if (STALE.test(hit.title || "")) s -= 12;

  return {
    s: Math.min(99, Math.max(40, s)),
    matchedRole,
    why: [...new Set(why)].slice(0, 6),
  };
}

let DAILY = null;
function dailyListings() {
  if (DAILY) return DAILY;
  try {
    return require("../data/listings.json");
  } catch {
    return null;
  }
}

const STOP = new Set(["and", "of", "the", "for", "in", "to", "at", "a", "an"]);
function roleHit(textStr, role) {
  const hay = " " + String(textStr).toLowerCase().replace(/[^\p{L}\p{N}&]+/gu, " ") + " ";
  const words = String(role || "")
    .split(" ")
    .filter((w) => w.length >= 2 && !STOP.has(w));
  if (!words.length) return false;
  if (words.every((w) => hay.includes(" " + w))) return true;
  const hits = words.filter((w) => hay.includes(" " + w));
  return words.length >= 2 && hits.length >= 2;
}

const GERMAN_TITLE =
  /\b(m\/w\/d|w\/m\/d|d\/m\/w)\b|[äöüß]|\b(leiter(in)?|leitung|vertrieb|einkauf|gesch[äa]ftsf[üu]hrer(in)?|mitarbeiter(in)?|kaufmann|kauffrau|fachkraft|sachbearbeiter(in)?|ausbildung|praktikum|stellvertretende?r?)\b/i;
const speaksGerman = (sig) => (sig.languages || []).some((l) => /german|deutsch/i.test(l));
const ELSEWHERE =
  /\b(china|asia|australia|new zealand|usa|united states|americas?|canada|uk|united kingdom|london|india|singapore|hong kong|japan|korea)\b/i;
const GULF =
  /\b(uae|gcc|gulf|middle east|mena|emirates|dubai|abu dhabi|sharjah|ajman|ras al khaimah|fujairah|riyadh|jeddah|saudi|ksa|qatar|doha|kuwait|bahrain|oman|muscat)\b/i;
const hostOf = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};
const LOWER_RUNG = /\b(assistant|asst|junior|jr|intern|internship|trainee|graduate|coordinator|secretary|receptionist)\b/i;

function rankDaily(listings, sig, prefs, step = []) {
  const roles = wantedRoles(sig, prefs);
  const steps = prefs.strictRoleOnly ? [] : (step || []).filter(Boolean);
  const where = String(prefs.location || sig.places[0] || "").trim().toLowerCase();
  const gulfWanted = !where || GULF.test(where) || PLACES.some((p) => p.toLowerCase() === where);
  const out = [];
  for (const src of (listings && listings.sources) || []) {
    if (src.ok === false && !(src.jobs && src.jobs.length)) continue;
    for (const j of src.jobs || []) {
      const url = String(j.url || "");
      if (j.kind === "search" || !/^https?:\/\//i.test(url)) continue;
      const rawTitle = String(j.title || "").trim();
      const title = boards.cleanJobTitleForMatch(rawTitle) || rawTitle;
      if (GERMAN_TITLE.test(title) && !speaksGerman(sig)) continue;

      const strictMatch = boards.matchStrictRole(title, roles);
      const hits = strictMatch ? [strictMatch.toLowerCase()] : roles.filter((r) => roleHit(title, r));
      const stepHits = hits.length || prefs.strictRoleOnly ? [] : steps.filter((r) => roleHit(title, r));
      const skillHits = (sig.skills || []).filter((sk) => `${title} ${j.text || ""}`.toLowerCase().includes(sk));

      if (prefs.strictRoleOnly && !strictMatch) continue;
      if (!hits.length && !stepHits.length && skillHits.length < 2) continue;

      const track = stepHits.length ? "step" : "level";
      const lower = `${title} ${j.location || ""} ${j.text || ""}`.toLowerCase();
      if (where && ELSEWHERE.test(title) && !GULF.test(title) && !lower.includes(where)) continue;
      const host = hostOf(url);
      const titleGulf = (GULF.exec(title) || [])[0];
      const gulfWord = (GULF.exec(`${title} ${j.location || ""}`) || [])[0];
      const exact = !!where && lower.includes(where);
      const region = exact
        ? where
        : gulfWanted && gulfWord
        ? gulfWord.toLowerCase()
        : gulfWanted && (/\.ae$/.test(host) || host === "vae.ahk.de")
        ? "UAE board"
        : "";
      let s =
        68 +
        14 * (hits.length || stepHits.length) +
        4 * skillHits.length +
        (exact ? 10 : region ? 6 : 0) -
        (track === "step" ? 3 : 0);
      if (LOWER_RUNG.test(title)) continue;
      out.push({
        title,
        matchedRole: strictMatch || hits[0] || stepHits[0] || "Executive Role",
        url,
        snippet:
          j.text ||
          [
            j.company || host,
            j.location || (titleGulf ? `${titleGulf}` : "UAE / International"),
            j.posted ? `posted ${j.posted}` : "",
          ]
            .filter(Boolean)
            .join(" · "),
        text: j.text || "",
        source: detectBoardSource(j.src || src.id || host),
        company: j.company || "",
        location: j.location || titleGulf || prefs.location || "UAE",
        posted: j.posted || "live",
        ref: j.ref || "",
        score: Math.min(99, s),
        track,
        matched: [...new Set([strictMatch || hits[0], ...skillHits.slice(0, 4), ...(region ? [region] : [])].filter(Boolean))],
        places: places(`${title} ${j.location || ""}`).slice(0, 3),
      });
    }
  }
  return out.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, 45);
}

const BOARD_TIMEOUT_MS = 9500;

async function liveBoards(sig, prefs, step = []) {
  const roles = wantedRoles(sig, prefs).slice(0, 4);
  const stepRoles = prefs.strictRoleOnly ? [] : (step || []).filter((r) => !roles.includes(r)).slice(0, 2);
  const where = String(prefs.location || sig.places[0] || "United Arab Emirates").trim();
  const tasks = [];

  // 1. LinkedIn Live Search per Target Role
  for (const r of roles) {
    tasks.push({
      id: "linkedin",
      track: "level",
      label: `LinkedIn Live: ${r} in ${where}`,
      run: () =>
        boards
          .fetchText(boards.linkedInUrl(r, where), BOARD_TIMEOUT_MS)
          .then(boards.parseLinkedIn)
          .then((list) => list.map((x) => ({ ...x, trackHint: "level" }))),
    });
  }
  for (const r of stepRoles) {
    tasks.push({
      id: "linkedin",
      track: "step",
      label: `LinkedIn Live: ${r} in ${where}`,
      run: () =>
        boards
          .fetchText(boards.linkedInUrl(r, where), BOARD_TIMEOUT_MS)
          .then(boards.parseLinkedIn)
          .then((list) => list.map((x) => ({ ...x, trackHint: "step" }))),
    });
  }

  // 2. Indeed, Dubizzle, Bayt, Naukrigulf, GulfTalent Live Role Search
  for (const boardId of ["indeed", "dubizzle", "bayt", "naukrigulf", "gulftalent"]) {
    tasks.push({
      id: boardId,
      label: `${boardId.toUpperCase()} Live Search: ${roles.join(", ")} in ${where}`,
      run: () => boards.fetchBoardByRoleSearch(boardId, roles, where, BOARD_TIMEOUT_MS),
    });
  }

  // 3. Executive Headhunter Boards (Page Executive, Michael Page, Charterhouse, Departer)
  tasks.push({
    id: "pageexecutive",
    label: "Page Executive Live Board",
    run: () => boards.fetchText("https://www.pageexecutive.com/jobs/", BOARD_TIMEOUT_MS).then(boards.parsePageExecutive),
  });
  tasks.push({
    id: "michaelpage",
    label: "Michael Page UAE Live Board",
    run: () => boards.fetchText("https://www.michaelpage.ae/jobs", BOARD_TIMEOUT_MS).then(boards.parseMichaelPage),
  });
  tasks.push({
    id: "charterhouse",
    label: "Charterhouse Middle East Live Board",
    run: () => boards.fetchText("https://www.charterhouseme.ae/jobs/", BOARD_TIMEOUT_MS).then(boards.parseCharterhouse),
  });
  tasks.push({
    id: "departer",
    label: "Departer German Headhunter Live Board",
    run: () => boards.fetchText("https://careers.departer.de/", BOARD_TIMEOUT_MS).then(boards.parseDeparter),
  });

  const settled = await Promise.allSettled(tasks.map((t) => t.run()));
  const jobsBySource = {};
  const failures = [];
  let totalFound = 0;

  settled.forEach((s, i) => {
    const t = tasks[i];
    if (!jobsBySource[t.id]) jobsBySource[t.id] = [];
    if (s.status === "fulfilled" && Array.isArray(s.value)) {
      jobsBySource[t.id].push(...s.value);
      totalFound += s.value.length;
    } else if (s.status === "rejected") {
      failures.push(`${t.label}: ${String((s.reason && s.reason.message) || s.reason)}`);
    }
  });

  return {
    listings: {
      sources: Object.entries(jobsBySource).map(([id, list]) => ({ id, ok: true, jobs: list })),
    },
    searches: tasks.map((t) => t.label),
    found: totalFound,
    failures,
  };
}

async function hydrateTopLinkedInMatches(matches, maxHydrate = 5) {
  const targets = matches
    .filter((m) => /linkedin\.com\/jobs\/view\//i.test(m.url) && (!m.text || m.text.length < 160))
    .slice(0, maxHydrate);
  if (!targets.length) return;
  await Promise.allSettled(
    targets.map(async (m) => {
      const detail = await boards.fetchLinkedInPosting(m.url, 6500);
      if (detail && detail.text) {
        m.text = detail.text;
        m.snippet = detail.text.slice(0, 380);
        if (detail.company && !m.company) m.company = detail.company;
        if (detail.location && !m.location) m.location = detail.location;
        if (detail.posted && !m.posted) m.posted = detail.posted;
        if (detail.emails && detail.emails.length) m.to = detail.emails[0];
      }
    })
  );
}

async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  body = body || {};

  const text = String(body.text || "");
  if (text.trim().length < 20) {
    res.status(400).json({ error: "CV text too short — upload or paste your CV first." });
    return;
  }

  const prefs = {
    location: String(body.location || "").slice(0, 80),
    roles: String(body.roles || "").slice(0, 240),
    targetRoles: Array.isArray(body.targetRoles) ? body.targetRoles.map(String) : [],
    stepRole: String(body.stepRole || "").slice(0, 160),
    strictRoleOnly: body.strictRoleOnly !== false,
  };

  const key = process.env.AISA_API_KEY || "";
  const sig = readCv(text);
  const activeRoles = wantedRoles(sig, prefs);
  const step = await stepUpRoles(sig, text, prefs.stepRole);
  const queries = buildQueries(sig, prefs);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), SEARCH_TIMEOUT_MS);

  let batches = [],
    board = { listings: { sources: [] }, searches: [], found: 0, failures: [] };
  try {
    [batches, board] = await Promise.all([
      Promise.allSettled(queries.slice(0, 4).map((q) => webSearchWithFallback(key, q, ac.signal))),
      liveBoards(sig, prefs, step),
    ]);
  } finally {
    clearTimeout(timer);
  }

  const webFailures = batches.filter((b) => b.status === "rejected").map((b) => String(b.reason));
  const failures = [...webFailures, ...board.failures];

  const hits = batches.flatMap((b) => (b.status === "fulfilled" ? b.value : []));
  const boardRanked = rankDaily(board.listings, sig, prefs, step);

  const daily = dailyListings();
  const dailyRanked = daily ? rankDaily(daily, sig, prefs, step) : [];

  const searched = [...queries, ...board.searches];

  const byUrl = new Map();
  for (const h of hits) {
    const u = String(h.url || "");
    if (!/^https?:\/\//i.test(u)) continue;
    if (!byUrl.has(u)) byUrl.set(u, h);
  }

  const webRanked = [...byUrl.values()]
    .map((h) => {
      const cleanedTitle = boards.cleanJobTitleForMatch(h.title || "Untitled Vacancy");
      const { s, matchedRole, why } = score({ ...h, title: cleanedTitle }, sig, prefs, activeRoles);
      if (prefs.strictRoleOnly && !matchedRole) return null;
      const host = hostOf(h.url);
      const src = detectBoardSource(h.url);
      return {
        title: cleanedTitle,
        matchedRole: matchedRole || activeRoles[0] || "Executive Role",
        url: h.url,
        snippet: String(h.content || "").slice(0, 380),
        text: String(h.content || ""),
        company: host ? `via ${host}` : "",
        location: places(`${h.title || ""} ${h.content || ""}`)[0] || prefs.location || "UAE / International",
        posted: "live web",
        source: src,
        score: s,
        track: "level",
        matched: why,
        places: places(`${h.title || ""} ${h.content || ""}`).slice(0, 3),
      };
    })
    .filter(Boolean);

  const merged = new Map();
  for (const r of [...boardRanked, ...webRanked, ...dailyRanked]) {
    if (!r.url || merged.has(r.url)) continue;
    merged.set(r.url, r);
  }

  const ranked = [...merged.values()].sort((a, b) => b.score - a.score).slice(0, 40);

  await hydrateTopLinkedInMatches(ranked, 5);

  res.status(200).json({
    ok: true,
    profile: sig,
    activeRoles,
    strictRoleOnly: prefs.strictRoleOnly,
    queries: searched,
    counts: {
      raw: hits.length + board.found + dailyRanked.length,
      unique: merged.size,
      ranked: ranked.length,
    },
    stepRoles: step,
    tracks: countTracks(ranked),
    failures: failures.length ? failures : undefined,
    matches: ranked,
  });
}

module.exports = handler;
module.exports.readCv = readCv;
module.exports.buildQueries = buildQueries;
module.exports.stepUpRoles = stepUpRoles;
module.exports.rankDaily = rankDaily;
module.exports._setListings = (d) => {
  DAILY = d || null;
};
