/**
 * GET /api/linkedin-profile?url=<linkedinUrl>
 * POST /api/linkedin-profile  { url: "...", text: "..." }
 *
 * Fetches public LinkedIn profile content via high-speed reader proxy (r.jina.ai)
 * and parses it into structured candidate data (name, headline, location, about, experience, education, skills, certifications).
 */

const TIMEOUT_MS = 14000;

function cleanLinkedInUrl(rawUrl) {
  if (!rawUrl) return "";
  let u = String(rawUrl).trim();
  if (!/^https?:\/\//i.test(u)) {
    if (/^[a-zA-Z0-9_-]+$/.test(u)) {
      u = `https://www.linkedin.com/in/${u}`;
    } else if (/^(?:www\.)?linkedin\.com/i.test(u)) {
      u = `https://${u.replace(/^https?:\/\//i, "")}`;
    } else {
      u = `https://${u}`;
    }
  }
  try {
    const parsed = new URL(u);
    let path = parsed.pathname.replace(/\/+$/, "");
    if (!path.startsWith("/in/")) {
      const match = path.match(/\/in\/([a-zA-Z0-9_\u0080-\uFFFF%-]+)/);
      if (match) path = `/in/${match[1]}`;
    }
    return `https://www.linkedin.com${path}`;
  } catch {
    return u;
  }
}

function parseLinkedInProfileText(text, sourceUrl = "") {
  if (!text || typeof text !== "string") return null;

  const rawLines = text
    .replace(/\r\n?/g, "\n")
    .replace(/\u00A0/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (!rawLines.length) return null;

  let name = "";
  let headline = "";
  let location = "";
  let summary = "";
  const roles = [];
  const education = [];
  const skills = [];
  const certifications = [];
  const languages = [];

  const isMarkdown = rawLines.some((l) => /^#{1,4}\s+/.test(l));

  if (isMarkdown) {
    // 1. MARKDOWN / WEB READER PARSER
    for (let i = 0; i < Math.min(rawLines.length, 120); i++) {
      const l = rawLines[i];
      const m = l.match(/^#\s+([^#\n]+)$/);
      if (m) {
        const c = m[1].replace(/\[.*?\]|\(.*?\)/g, "").trim();
        if (!/sign in|join|linkedin|skip to|view|activity|articles/i.test(c) && c.length <= 80) {
          name = c;
          break;
        }
      }
    }

    if (!name) {
      const titleMatch = text.match(/Title:\s*([^\n\-|–—]+)/i);
      if (titleMatch && titleMatch[1]) {
        const candidate = titleMatch[1].trim();
        if (!/sign in|join|linkedin/i.test(candidate)) name = candidate;
      }
    }

    for (let i = 0; i < Math.min(rawLines.length, 120); i++) {
      const l = rawLines[i];
      if (/^##\s+([^#\n]+)$/.test(l)) {
        const t = l.replace(/^##\s+/, "").trim();
        if (!headline && !/sign in|join|about|experience|education|activity|articles|skills|licenses|certifications/i.test(t) && t.length <= 160) {
          headline = t;
        }
      } else if (/^###\s+([^#\n]+)$/.test(l)) {
        const t = l.replace(/^###\s+/, "").replace(/Contact Info/i, "").trim();
        if (!location && /(?:united arab emirates|uae|dubai|abu dhabi|saudi|riyadh|qatar|kuwait|bahrain|oman|germany|munich|berlin|united states|usa|uk|london|canada|australia|singapore|city|area|region)/i.test(t) && t.length <= 90) {
          location = t;
        }
      }
    }

    const aboutIdx = rawLines.findIndex((l) => /^##\s*About\b/i.test(l));
    if (aboutIdx !== -1) {
      const aboutLines = [];
      for (let i = aboutIdx + 1; i < rawLines.length; i++) {
        const l = rawLines[i];
        if (/^##\s+/i.test(l)) break;
        if (l && !/^\[|^!\[/i.test(l) && !/sign in|join to view/i.test(l)) {
          aboutLines.push(l);
        }
      }
      summary = aboutLines.join("\n").trim();
    }

    const expIdx = rawLines.findIndex((l) => /^##\s*Experience\b/i.test(l));
    if (expIdx !== -1) {
      let currentRole = null;
      for (let i = expIdx + 1; i < rawLines.length; i++) {
        const l = rawLines[i];
        if (/^##\s+(?:Education|Licenses|Certifications|Skills|Honors|Languages|Projects|View|Other)/i.test(l)) {
          if (currentRole && (currentRole.company || currentRole.bullets.length)) roles.push(currentRole);
          currentRole = null;
          break;
        }

        const h3Match = l.match(/(?:^|[^#])###\s+([^\n#]+)/);
        if (h3Match) {
          const rawTitle = h3Match[1].replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[\[\]()]/g, "").trim();
          if (rawTitle && !/view full profile|sign in/i.test(rawTitle)) {
            if (currentRole && (currentRole.company || currentRole.bullets.length)) {
              roles.push(currentRole);
            }
            currentRole = {
              title: rawTitle,
              company: "",
              location: "",
              dates: "",
              bullets: []
            };
            continue;
          }
        }

        const h4Match = l.match(/^(?:####|\*?\s*####)\s*(?:\[([^\]]+)\]\([^)]+\)|([^\n]+))/);
        if (h4Match && currentRole && !currentRole.company) {
          const comp = (h4Match[1] || h4Match[2] || "").trim();
          if (comp && comp !== "-") {
            currentRole.company = comp;
            continue;
          }
        }

        const dateMatch = l.match(/\b((?:(?:19|20)\d{2}\s*[-–—]\s*(?:Present|Current|\d{4}))|(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}\s*[-–—]\s*(?:Present|Current|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})))\b/i);
        if (dateMatch && currentRole && !currentRole.dates) {
          currentRole.dates = l.replace(/\s+/g, " ").trim();
          continue;
        }

        if (currentRole && !currentRole.location && /(?:dubai|abu dhabi|uae|united arab emirates|saudi|riyadh|london|uk|munich|germany|area|city)/i.test(l) && l.length <= 80 && !/^[\*\-•]/.test(l)) {
          currentRole.location = l.trim();
          continue;
        }

        if (currentRole && l && !l.startsWith("http") && !/^\[.*\]\(.*\)$/.test(l) && !/sign in|join/i.test(l)) {
          const clean = l.replace(/^[\*\-•▪▸]\s*/, "").trim();
          if (clean.length > 5 && !clean.startsWith("Company Name") && !clean.startsWith("Dates")) {
            currentRole.bullets.push(clean);
          }
        }
      }
      if (currentRole && (currentRole.company || currentRole.bullets.length)) {
        roles.push(currentRole);
      }
    }

    const eduIdx = rawLines.findIndex((l) => /^##\s*Education\b/i.test(l));
    if (eduIdx !== -1) {
      for (let i = eduIdx + 1; i < rawLines.length; i++) {
        const l = rawLines[i];
        if (/^##\s+(?:Licenses|Certifications|Skills|Honors|Languages|Projects|View|Other)/i.test(l)) break;
        const h3 = l.match(/(?:^|[^#])###\s+([^\n#]+)/);
        if (h3) {
          const school = h3[1].replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trim();
          if (school && school !== "-") education.push(school);
        } else {
          const h4 = l.match(/^(?:####|\*?\s*####)\s*(?:\[([^\]]+)\]\([^)]+\)|([^\n]+))/);
          if (h4 && education.length) {
            const deg = (h4[1] || h4[2] || "").trim();
            if (deg && deg !== "-") education[education.length - 1] += ` · ${deg}`;
          }
        }
      }
    }

    const skillsIdx = rawLines.findIndex((l) => /^##\s*(?:Skills|Top Skills)\b/i.test(l));
    if (skillsIdx !== -1) {
      for (let i = skillsIdx + 1; i < rawLines.length; i++) {
        const l = rawLines[i];
        if (/^##\s+/i.test(l)) break;
        const clean = l.replace(/^[\*\-•▪▸]\s*/, "").replace(/\[([^\]]+)\]\([^)]+\)/, "$1").trim();
        if (clean && clean.length >= 2 && clean.length <= 60 && !/sign in|endorse|see all/i.test(clean)) {
          if (!skills.includes(clean)) skills.push(clean);
        }
      }
    }

    const certIdx = rawLines.findIndex((l) => /^##\s*(?:Licenses & Certifications|Certifications)\b/i.test(l));
    if (certIdx !== -1) {
      for (let i = certIdx + 1; i < rawLines.length; i++) {
        const l = rawLines[i];
        if (/^##\s+/i.test(l)) break;
        const clean = l.replace(/^[\*\-•▪▸#]+\s*/, "").replace(/\[([^\]]+)\]\([^)]+\)/, "$1").trim();
        if (clean && clean.length >= 3 && clean.length <= 90 && !/sign in|show credential/i.test(clean)) {
          if (!certifications.includes(clean)) certifications.push(clean);
        }
      }
    }
  } else {
    // 2. PLAIN TEXT / LINKEDIN PDF EXPORT PARSER
    let currentSection = "header";
    let pendingRole = null;

    for (let i = 0; i < rawLines.length; i++) {
      const l = rawLines[i];

      if (/^contact$/i.test(l)) {
        currentSection = "contact";
        continue;
      }
      if (/^(?:top\s+)?skills$/i.test(l)) {
        currentSection = "skills";
        continue;
      }
      if (/^languages$/i.test(l)) {
        currentSection = "languages";
        continue;
      }
      if (/^(?:licenses\s*&\s*)?certifications$/i.test(l)) {
        currentSection = "certifications";
        continue;
      }
      if (/^(?:summary|about)$/i.test(l)) {
        currentSection = "summary";
        continue;
      }
      if (/^(?:experience|work\s+experience)$/i.test(l)) {
        currentSection = "experience";
        continue;
      }
      if (/^education$/i.test(l)) {
        if (pendingRole && (pendingRole.company || pendingRole.bullets.length)) {
          roles.push(pendingRole);
          pendingRole = null;
        }
        currentSection = "education";
        continue;
      }

      if (currentSection === "header") {
        if (!name && l.length <= 70 && !/@|linkedin\.com/i.test(l)) {
          name = l;
        } else if (!headline && l.length <= 160 && !/@|linkedin\.com/i.test(l)) {
          headline = l;
        } else if (!location && /(?:united arab emirates|uae|dubai|abu dhabi|saudi|riyadh|qatar|kuwait|germany|usa|uk|london|canada|australia|city|area|region)/i.test(l)) {
          location = l;
        }
      } else if (currentSection === "skills") {
        if (l.length >= 2 && l.length <= 60 && !skills.includes(l)) {
          skills.push(l);
        }
      } else if (currentSection === "languages") {
        languages.push(l);
      } else if (currentSection === "certifications") {
        certifications.push(l);
      } else if (currentSection === "summary") {
        summary += (summary ? "\n" : "") + l;
      } else if (currentSection === "experience") {
        const isDateLine = /\b(?:(?:19|20)\d{2}\s*[-–—]\s*(?:Present|Current|\d{4})|(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(?:19|20)\d{2}\s*[-–—]\s*(?:Present|Current|\w+\s+(?:19|20)\d{2}))\b/i.test(l);

        if (isDateLine) {
          const titleLine = rawLines[i - 1] || "";
          const companyLine = rawLines[i - 2] || "";

          if (pendingRole) {
            while (pendingRole.bullets.length && (
              pendingRole.bullets[pendingRole.bullets.length - 1] === titleLine ||
              pendingRole.bullets[pendingRole.bullets.length - 1] === companyLine
            )) {
              pendingRole.bullets.pop();
            }
            if (pendingRole.company || pendingRole.bullets.length) {
              roles.push(pendingRole);
            }
          }

          pendingRole = {
            title: titleLine.replace(/^[\*\-•▪▸]\s*/, ""),
            company: companyLine.replace(/^[\*\-•▪▸]\s*/, ""),
            location: "",
            dates: l,
            bullets: []
          };
          continue;
        }

        if (pendingRole) {
          if (!pendingRole.location && /(?:dubai|abu dhabi|uae|united arab emirates|saudi|riyadh|qatar|london|munich|germany|area|city)/i.test(l) && l.length <= 70) {
            pendingRole.location = l;
          } else {
            const clean = l.replace(/^[\*\-•▪▸]\s*/, "").trim();
            if (clean.length > 5) pendingRole.bullets.push(clean);
          }
        }
      } else if (currentSection === "education") {
        education.push(l);
      }
    }

    if (pendingRole && (pendingRole.company || pendingRole.bullets.length)) {
      roles.push(pendingRole);
    }
  }

  const cleanEdu = education
    .filter((e) => e && e !== "-" && e.length > 2)
    .join(" · ");

  return {
    sourceUrl: sourceUrl || "",
    name: name || "",
    headline: headline || "",
    location: location || "",
    summary: summary || "",
    roles: roles.filter((r) => r.title || r.company || r.bullets.length),
    education: cleanEdu,
    skills,
    certifications,
    languages
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  try {
    let targetUrl = "";
    let rawText = "";

    if (req.method === "GET") {
      targetUrl = req.query.url || req.query.u || "";
    } else {
      const body = req.body || {};
      targetUrl = body.url || body.u || "";
      rawText = body.text || "";
    }

    if (rawText && rawText.length > 50) {
      const parsed = parseLinkedInProfileText(rawText, targetUrl);
      res.status(200).json({ ok: true, data: parsed, source: "provided-text" });
      return;
    }

    if (!targetUrl) {
      res.status(400).json({ ok: false, error: "Missing 'url' parameter" });
      return;
    }

    const cleanUrl = cleanLinkedInUrl(targetUrl);
    if (!cleanUrl || !cleanUrl.includes("linkedin.com/in/")) {
      res.status(400).json({
        ok: false,
        error: "Invalid LinkedIn Profile URL. Please use format: https://www.linkedin.com/in/your-profile"
      });
      return;
    }

    const jinaUrl = `https://r.jina.ai/${cleanUrl}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

    let mdText = "";
    try {
      const resp = await fetch(jinaUrl, {
        headers: {
          Accept: "text/plain, text/markdown"
        },
        signal: ctrl.signal
      });
      clearTimeout(timer);
      if (resp.ok) {
        mdText = await resp.text();
      }
    } catch (fetchErr) {
      clearTimeout(timer);
      console.warn("LinkedIn fetch timeout/error:", fetchErr.message);
    }

    if (!mdText || mdText.length < 100 || (/authwall|checkpoint|login\?|sign in to view/i.test(mdText.slice(0, 1500)) && !/##\s*Experience|##\s*About/i.test(mdText))) {
      res.status(200).json({
        ok: false,
        fallbackRequired: true,
        targetUrl: cleanUrl,
        error: "authwall",
        message: "This LinkedIn profile is private or requires sign-in. You can easily export your profile PDF from LinkedIn (click 'More' > 'Save to PDF') and upload it, or paste your profile text directly."
      });
      return;
    }

    const parsed = parseLinkedInProfileText(mdText, cleanUrl);
    res.status(200).json({
      ok: true,
      data: parsed,
      targetUrl: cleanUrl,
      source: "live-jina"
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || "Failed to fetch LinkedIn profile" });
  }
};
