/**
 * GET /api/job-detail?url=<jobUrl>
 *
 * Fetches a live job posting from the internet, extracts its full description,
 * title, company, city, posted date, reference code, and any printed application
 * email addresses — so converting ANY live listing into a Draft Application
 * populates Stage 03 with the real, complete job requirements.
 *
 * Supports:
 *  - LinkedIn job URLs (via public guest API jobs-guest/jobs/api/jobPosting/<id> + company page)
 *  - Executive search boards (Michael Page, Page Executive, Charterhouse, Departer, AHK)
 *  - ATS boards (Greenhouse, Lever, Workable, Ashby, Personio, SmartRecruiters, BambooHR)
 *  - Any company careers page (extracts Schema.org JobPosting JSON-LD when present + readable text)
 *  - Fallback via r.jina.ai reader when direct fetch is blocked by TLS/WAF
 */

const boards = require("./_boards.js");

function extractJsonLdJob(html) {
  const scripts = [...String(html || "").matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const m of scripts) {
    try {
      const raw = JSON.parse(m[1].trim());
      const list = Array.isArray(raw) ? raw : raw && Array.isArray(raw["@graph"]) ? raw["@graph"] : [raw];
      const job = list.find((x) => x && /JobPosting/i.test(String(x["@type"] || "")));
      if (!job) continue;
      const org = job.hiringOrganization || {};
      const loc = Array.isArray(job.jobLocation) ? job.jobLocation[0] : job.jobLocation || {};
      const addr = loc.address || {};
      const city = addr.addressLocality || addr.addressRegion || addr.addressCountry || "";
      const descHtml = job.description || "";
      return {
        title: boards.text(job.title || ""),
        company: boards.text(org.name || ""),
        site: String(org.sameAs || org.url || ""),
        city: boards.text(typeof city === "string" ? city : ""),
        posted: String(job.datePosted || "").slice(0, 10),
        ref: String((job.identifier && (job.identifier.value || job.identifier)) || ""),
        text: boards.htmlToLines(descHtml),
      };
    } catch {}
  }
  return null;
}

function harvestEmails(str) {
  const raw = String(str || "").match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
  const seen = new Set();
  const out = [];
  for (const r of raw) {
    const clean = r.replace(/[.,;:)\]]+$/, "").toLowerCase();
    if (/^(no-?reply|do-?not-?reply|postmaster|abuse|webmaster|privacy|sentry)@/i.test(clean)) continue;
    if (/\.(png|jpe?g|gif|svg|webp|css|js|woff2?)$/i.test(clean)) continue;
    if (/@(example\.|test\.|sentry\.io|wixpress\.com)/i.test(clean)) continue;
    if (!seen.has(clean)) {
      seen.add(clean);
      out.push(clean);
    }
  }
  return out;
}

async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");

  const rawUrl = String((req.query && req.query.url) || "").trim();
  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl);
    if (!/^https?:$/.test(parsedUrl.protocol)) throw new Error("Only http/https URLs supported");
  } catch {
    res.status(400).json({ ok: false, error: "Invalid or missing ?url= parameter." });
    return;
  }

  try {
    // 1. LinkedIn Job URL -> Use LinkedIn Guest Job Posting API + LinkedIn Company Lookup
    if (/(^|\.)linkedin\.com$/i.test(parsedUrl.hostname)) {
      const li = await boards.fetchLinkedInPosting(parsedUrl.href, 10000);
      if (li && (li.text || li.title)) {
        let site = "";
        try {
          const L = await import("../linkedin-company.js");
          const rawPage = await boards.fetchText(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${li.id}`, 7000);
          const slug = L.companySlugOf(rawPage);
          if (slug) {
            const coPage = await boards.fetchText(L.companyUrl(slug), 7000);
            site = L.websiteOf(coPage) || "";
          }
        } catch {}
        res.status(200).json({
          ok: true,
          source: "linkedin-guest-api",
          url: li.url,
          title: li.title || "",
          company: li.company || "",
          city: li.location || "",
          posted: li.posted || "",
          ref: li.id || "",
          site,
          emails: li.emails || [],
          text: li.text || "",
        });
        return;
      }
    }

    // 2. Direct Server Fetch (with JSON-LD JobPosting + main body extraction)
    let html = "";
    let via = "direct";
    try {
      html = await boards.fetchText(parsedUrl.href, 10000);
    } catch {
      // Fallback to r.jina.ai reader
      via = "r.jina.ai";
      html = await boards.fetchText("https://r.jina.ai/" + parsedUrl.href, 12000);
    }

    const ld = via === "direct" ? extractJsonLdJob(html) : null;
    const pageTitle = boards.text((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || "");
    const h1Title = boards.text((/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html) || [])[1] || "");
    const bodyText = ld && ld.text && ld.text.length > 120 ? ld.text : boards.htmlToLines(html).slice(0, 12000);
    const emails = harvestEmails(html + "\n" + bodyText);
    const refMatch =
      (ld && ld.ref) ||
      (/\/ref\/([a-z0-9-]+)/i.exec(parsedUrl.pathname) || [])[1] ||
      (/\b(?:ref(?:erence)?|job\s*id|kennziffer)\s*[:#.]?\s*([A-Z0-9-]{4,20})\b/i.exec(bodyText) || [])[1] ||
      "";

    res.status(200).json({
      ok: true,
      source: via,
      url: parsedUrl.href,
      title: (ld && ld.title) || h1Title || pageTitle.split(/\s+[|\-–—]\s+/)[0] || "",
      company: (ld && ld.company) || "",
      city: (ld && ld.city) || "",
      posted: (ld && ld.posted) || "",
      ref: refMatch,
      site: (ld && ld.site) || "",
      emails,
      text: bodyText,
    });
  } catch (err) {
    res.status(200).json({
      ok: false,
      url: parsedUrl.href,
      error: String((err && err.message) || err),
    });
  }
}

module.exports = handler;
