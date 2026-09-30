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

async function resolveAndEnrichEmails({ rawEmails = [], site = "", company = "", title = "", url = "", location = "", source = "", text = "" }) {
  const list = [...new Set((rawEmails || []).filter(Boolean))];
  if (list.length) {
    return {
      emails: list,
      primaryEmail: list[0],
      emailVia: "Extracted Directly from Job Posting",
    };
  }

  // Tier 2: If we have or can resolve the company website, crawl /careers, /contact, /impressum
  let resolvedSite = site;
  if (!resolvedSite && company && company.length >= 2 && !/^via\s+/i.test(company)) {
    try {
      const siteMod = require("./site.js");
      const hits = await boards.fetchDuckDuckGoJobs(`"${company}" official website ${location || ""}`, 5500);
      const picked = siteMod.pick(hits, company);
      if (picked && picked.url) resolvedSite = picked.url;
    } catch {}
  }

  if (resolvedSite && typeof boards.crawlSiteForEmails === "function") {
    try {
      const crawled = await boards.crawlSiteForEmails(resolvedSite, 4500);
      if (crawled && crawled.length) {
        return {
          emails: crawled,
          primaryEmail: crawled[0],
          site: resolvedSite,
          emailVia: `Scraped Live from Company Website (${new URL(resolvedSite).hostname.replace(/^www\./i, "")})`,
        };
      }
    } catch {}
  }

  // Tier 3: Use resolveJobRecipientEmail (Known Employer / Headhunter Desk / Corporate HR Domain)
  const fallback =
    typeof boards.resolveJobRecipientEmail === "function"
      ? boards.resolveJobRecipientEmail({ title, company, url, site: resolvedSite, source, text, location })
      : { email: "careers@executive-recruitment-uae.com", via: "Executive Recruitment Desk" };

  return {
    emails: fallback.email ? [fallback.email] : [],
    primaryEmail: fallback.email || "",
    site: resolvedSite,
    emailVia: fallback.via || "Corporate HR Mailbox",
  };
}

async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");

  const q = req.query || {};
  const rawUrl = String(q.url || "").trim();
  const hintCompany = String(q.company || "").trim();
  const hintTitle = String(q.title || "").trim();
  const hintLocation = String(q.location || "").trim();
  const hintSource = String(q.source || "").trim();

  let parsedUrl = null;
  try {
    if (rawUrl) {
      parsedUrl = new URL(rawUrl);
      if (!/^https?:$/.test(parsedUrl.protocol)) parsedUrl = null;
    }
  } catch {
    parsedUrl = null;
  }

  if (!parsedUrl) {
    const resolved = await resolveAndEnrichEmails({
      company: hintCompany,
      title: hintTitle,
      location: hintLocation,
      source: hintSource,
    });
    res.status(200).json({
      ok: true,
      source: "resolver",
      url: rawUrl,
      title: hintTitle,
      company: hintCompany,
      city: hintLocation,
      site: resolved.site || "",
      emails: resolved.emails,
      primaryEmail: resolved.primaryEmail,
      emailVia: resolved.emailVia,
      text: "",
    });
    return;
  }

  try {
    // 1. LinkedIn Job URL -> Use LinkedIn Guest Job Posting API + LinkedIn Company Lookup
    if (/(^|\.)linkedin\.com$/i.test(parsedUrl.hostname)) {
      const li = await boards.fetchLinkedInPosting(parsedUrl.href, 9000);
      if (li && (li.text || li.title)) {
        let site = "";
        try {
          const L = await import("../linkedin-company.js");
          const rawPage = await boards.fetchText(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${li.id}`, 6500);
          const slug = L.companySlugOf(rawPage);
          if (slug) {
            const coPage = await boards.fetchText(L.companyUrl(slug), 6500);
            site = L.websiteOf(coPage) || "";
          }
        } catch {}

        const enriched = await resolveAndEnrichEmails({
          rawEmails: li.emails || [],
          site,
          company: li.company || hintCompany,
          title: li.title || hintTitle,
          url: li.url || parsedUrl.href,
          location: li.location || hintLocation,
          source: "linkedin",
          text: li.text || "",
        });

        res.status(200).json({
          ok: true,
          source: "linkedin-guest-api",
          url: li.url,
          title: li.title || hintTitle || "",
          company: li.company || hintCompany || "",
          city: li.location || hintLocation || "",
          posted: li.posted || "",
          ref: li.id || "",
          site: enriched.site || site,
          emails: enriched.emails,
          primaryEmail: enriched.primaryEmail,
          emailVia: enriched.emailVia,
          text: li.text || "",
        });
        return;
      }
    }

    // 2. Direct Server Fetch (with JSON-LD JobPosting + main body extraction)
    let html = "";
    let via = "direct";
    try {
      html = await boards.fetchText(parsedUrl.href, 9000);
    } catch {
      // Fallback to r.jina.ai reader
      via = "r.jina.ai";
      html = await boards.fetchText("https://r.jina.ai/" + parsedUrl.href, 10000);
    }

    const ld = via === "direct" ? extractJsonLdJob(html) : null;
    const pageTitle = boards.text((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || "");
    const h1Title = boards.text((/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html) || [])[1] || "");
    const bodyText = ld && ld.text && ld.text.length > 120 ? ld.text : boards.htmlToLines(html).slice(0, 12000);
    const directEmails =
      typeof boards.harvestAndRankEmails === "function"
        ? boards.harvestAndRankEmails(html + "\n" + bodyText, parsedUrl.hostname)
        : harvestEmails(html + "\n" + bodyText);
    const refMatch =
      (ld && ld.ref) ||
      (/\/ref\/([a-z0-9-]+)/i.exec(parsedUrl.pathname) || [])[1] ||
      (/\b(?:ref(?:erence)?|job\s*id|kennziffer)\s*[:#.]?\s*([A-Z0-9-]{4,20})\b/i.exec(bodyText) || [])[1] ||
      "";

    const finalTitle = (ld && ld.title) || h1Title || pageTitle.split(/\s+[|\-–—]\s+/)[0] || hintTitle || "";
    const finalCompany = (ld && ld.company) || hintCompany || "";
    const finalCity = (ld && ld.city) || hintLocation || "";
    const finalSite = (ld && ld.site) || "";

    const enriched = await resolveAndEnrichEmails({
      rawEmails: directEmails,
      site: finalSite,
      company: finalCompany,
      title: finalTitle,
      url: parsedUrl.href,
      location: finalCity,
      source: hintSource || via,
      text: bodyText,
    });

    res.status(200).json({
      ok: true,
      source: via,
      url: parsedUrl.href,
      title: finalTitle,
      company: finalCompany,
      city: finalCity,
      posted: (ld && ld.posted) || "",
      ref: refMatch,
      site: enriched.site || finalSite,
      emails: enriched.emails,
      primaryEmail: enriched.primaryEmail,
      emailVia: enriched.emailVia,
      text: bodyText,
    });
  } catch (err) {
    const fallback = await resolveAndEnrichEmails({
      company: hintCompany,
      title: hintTitle,
      url: parsedUrl.href,
      location: hintLocation,
      source: hintSource,
    });
    res.status(200).json({
      ok: true,
      source: "fallback-resolver",
      url: parsedUrl.href,
      title: hintTitle,
      company: hintCompany,
      city: hintLocation,
      emails: fallback.emails,
      primaryEmail: fallback.primaryEmail,
      emailVia: fallback.emailVia,
      error: String((err && err.message) || err),
    });
  }
}

module.exports = handler;

