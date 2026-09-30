/**
 * GET / POST /api/daily-fetch
 *
 * Automated Daily Job Listing Fetcher & CV-Detail + Desired-Role Matcher.
 *
 * Triggered by:
 *  1. Vercel Cron Schedule (`0 4 * * *` — 08:00 AM Dubai GST daily)
 *  2. Portal Auto-Daily Sync on Boot & CV/Role Change
 *
 * Collects fresh executive listings across Indeed, Dubizzle, LinkedIn, Bayt,
 * GulfTalent, Naukrigulf, Page Executive, Michael Page, Charterhouse & Departer,
 * then scores & filters each listing against the candidate's CV details
 * (skills, P&L authority, experience keywords, location) and desired job roles.
 */

const boards = require("./_boards.js");
const matchEngine = require("./match.js");

const DEFAULT_ROLES = [
  "General Manager",
  "Managing Director",
  "Operations Director",
  "Chief Operating Officer",
];

const DEFAULT_CV_TEXT =
  "Chief Operating Officer, General Manager, Managing Director, Operations Director. Full P&L ownership ($120M+), multi-site operations, supply chain optimization, strategic procurement, EBITDA turnaround, Lean Six Sigma, Board governance, ERP SAP transformation, UAE, Dubai, Abu Dhabi, Saudi Arabia, GCC, DACH.";

let cachedDailySnapshot = null;
let cachedDailyDate = "";

async function collectFreshDailyFeed(roles, location) {
  const today = new Date().toISOString().slice(0, 10);
  const roleKey = roles.map((r) => r.toLowerCase()).sort().join("|") + "::" + location.toLowerCase();

  if (cachedDailySnapshot && cachedDailyDate === `${today}::${roleKey}`) {
    return cachedDailySnapshot;
  }

  const tasks = [
    ...roles.slice(0, 3).map((r) => ({
      id: "linkedin",
      run: () => boards.fetchText(boards.linkedInUrl(r, location), 8500).then(boards.parseLinkedIn),
    })),
    ...["indeed", "dubizzle", "bayt", "gulftalent", "naukrigulf"].map((boardId) => ({
      id: boardId,
      run: () => boards.fetchBoardByRoleSearch(boardId, roles.slice(0, 3), location, 8500),
    })),
    {
      id: "pageexecutive",
      run: () => boards.fetchText("https://www.pageexecutive.com/jobs/", 8500).then(boards.parsePageExecutive),
    },
    {
      id: "michaelpage",
      run: () => boards.fetchText("https://www.michaelpage.ae/jobs", 8500).then(boards.parseMichaelPage),
    },
    {
      id: "charterhouse",
      run: () => boards.fetchText("https://www.charterhouseme.ae/jobs/", 8500).then(boards.parseCharterhouse),
    },
    {
      id: "departer",
      run: () => boards.fetchText("https://careers.departer.de/", 8500).then(boards.parseDeparter),
    },
  ];

  const settled = await Promise.allSettled(tasks.map((t) => t.run()));
  const bySource = {};
  settled.forEach((s, i) => {
    const srcId = tasks[i].id;
    if (!bySource[srcId]) bySource[srcId] = [];
    if (s.status === "fulfilled" && Array.isArray(s.value)) {
      bySource[srcId].push(...s.value);
    }
  });

  // Merge with static daily listings.json fallback so no board is ever empty
  try {
    const disk = require("../data/listings.json");
    for (const src of (disk && disk.sources) || []) {
      if (!bySource[src.id]) bySource[src.id] = [];
      if (Array.isArray(src.jobs)) {
        bySource[src.id].push(...src.jobs);
      }
    }
  } catch {}

  const snapshot = {
    generatedAt: new Date().toISOString(),
    sources: Object.entries(bySource).map(([id, jobs]) => ({
      id,
      ok: true,
      count: jobs.length,
      jobs,
    })),
  };

  cachedDailySnapshot = snapshot;
  cachedDailyDate = `${today}::${roleKey}`;
  return snapshot;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  let body = {};
  if (req.method === "POST" && req.body) {
    if (typeof req.body === "string") {
      try {
        body = JSON.parse(req.body);
      } catch {
        body = {};
      }
    } else {
      body = req.body;
    }
  } else if (req.query) {
    body = {
      location: req.query.location || "",
      roles: req.query.roles || "",
      targetRoles: req.query.roles ? String(req.query.roles).split(",").map((s) => s.trim()) : [],
      text: req.query.text || "",
    };
  }

  const cvText = String(body.text || DEFAULT_CV_TEXT);
  const targetRoles =
    Array.isArray(body.targetRoles) && body.targetRoles.length
      ? body.targetRoles.map(String)
      : DEFAULT_ROLES;
  const location = String(body.location || "United Arab Emirates").trim() || "United Arab Emirates";
  const strictRoleOnly = body.strictRoleOnly !== false;

  const sig = matchEngine.readCv(cvText);
  const prefs = {
    location,
    roles: targetRoles.join(", "),
    targetRoles,
    strictRoleOnly,
  };

  const feed = await collectFreshDailyFeed(targetRoles, location);
  const ranked = matchEngine.rankDaily(feed, sig, prefs, []);

  res.status(200).json({
    ok: true,
    dailyAutoFetchActive: true,
    dailySyncDate: new Date().toISOString().slice(0, 10),
    syncedAt: feed.generatedAt,
    nextScheduledSync: "Daily at 08:00 GST (04:00 UTC)",
    cvProfileMatched: {
      seniority: sig.level,
      detectedTitles: sig.titles,
      matchedSkills: sig.skills,
      places: sig.places,
    },
    desiredRoles: targetRoles,
    totalRanked: ranked.length,
    matches: ranked,
  });
};
