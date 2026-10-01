export function parseLinkedInProfileText(text, sourceUrl = "") {
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

  // Check if this is Markdown format (e.g. from Jina / Web reader) vs Plain Text / PDF Export
  const isMarkdown = rawLines.some((l) => /^#{1,4}\s+/.test(l));

  if (isMarkdown) {
    // ---------------------------------------------------------------
    // 1. MARKDOWN / WEB READER PARSER
    // ---------------------------------------------------------------
    // Name detection
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

    // Headline & Location detection
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

    // About / Summary
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

    // Experience
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

        // Title match: e.g. "### Co-chair", "* [](...)### Founder"
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

        // Company match: e.g. "#### [Gates Foundation](...)" or "#### Company"
        const h4Match = l.match(/^(?:####|\*?\s*####)\s*(?:\[([^\]]+)\]\([^)]+\)|([^\n]+))/);
        if (h4Match && currentRole && !currentRole.company) {
          const comp = (h4Match[1] || h4Match[2] || "").trim();
          if (comp && comp !== "-") {
            currentRole.company = comp;
            continue;
          }
        }

        // Dates match
        const dateMatch = l.match(/\b((?:(?:19|20)\d{2}\s*[-–—]\s*(?:Present|Current|\d{4}))|(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}\s*[-–—]\s*(?:Present|Current|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})))\b/i);
        if (dateMatch && currentRole && !currentRole.dates) {
          currentRole.dates = l.replace(/\s+/g, " ").trim();
          continue;
        }

        // Location match
        if (currentRole && !currentRole.location && /(?:dubai|abu dhabi|uae|united arab emirates|saudi|riyadh|london|uk|munich|germany|area|city)/i.test(l) && l.length <= 80 && !/^[\*\-•]/.test(l)) {
          currentRole.location = l.trim();
          continue;
        }

        // Bullets
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

    // Education
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

    // Skills
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

    // Certifications
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
    // ---------------------------------------------------------------
    // 2. PLAIN TEXT / LINKEDIN PDF EXPORT PARSER
    // ---------------------------------------------------------------
    // LinkedIn "Save to PDF" format has clear structure:
    // Sections: Contact, Top Skills, Languages, Certifications, Summary, Experience, Education
    let currentSection = "header";
    let pendingRole = null;

    for (let i = 0; i < rawLines.length; i++) {
      const l = rawLines[i];

      // Check section headers
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
      } else if (currentSection === "contact") {
        // e.g. "www.linkedin.com/in/..." or "user@email.com"
        // (will be integrated into contact info)
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
        // Check for date range line in experience: e.g. "January 2020 - Present (4 years)" or "2016 - 2020"
        const isDateLine = /\b(?:(?:19|20)\d{2}\s*[-–—]\s*(?:Present|Current|\d{4})|(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(?:19|20)\d{2}\s*[-–—]\s*(?:Present|Current|\w+\s+(?:19|20)\d{2}))\b/i.test(l);

        if (isDateLine) {
          // The line immediately before date is Title, line before that is Company
          const titleLine = rawLines[i - 1] || "";
          const companyLine = rawLines[i - 2] || "";

          if (pendingRole) {
            // Remove titleLine and companyLine from pendingRole.bullets if they were mistakenly added
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

  // Format education output nicely
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

export function combineCvAndLinkedInProfiles(baseCv, liProfile) {
  if (!baseCv) return liProfile;
  if (!liProfile) return baseCv;

  const combined = JSON.parse(JSON.stringify(baseCv));

  // 1. Name: preserve base CV name if uppercase/complete, otherwise use LinkedIn
  if ((!combined.name || combined.name === "EXECUTIVE CANDIDATE") && liProfile.name) {
    combined.name = liProfile.name.toUpperCase();
  }

  // 2. Headline: merge distinct executive keywords
  if (liProfile.headline) {
    if (!combined.headline) {
      combined.headline = liProfile.headline;
    } else {
      const cvTitles = combined.headline.split(/\s*[·|/]\s*/).map((s) => s.trim().toLowerCase());
      const liTitles = liProfile.headline.split(/\s*[·|/]\s*/).map((s) => s.trim());
      const additions = [];
      for (const t of liTitles) {
        if (t && !cvTitles.includes(t.toLowerCase()) && !/influencer|speaker|author/i.test(t)) {
          additions.push(t);
        }
      }
      if (additions.length) {
        combined.headline = `${combined.headline} · ${additions.slice(0, 2).join(" · ")}`;
      }
    }
  }

  // 3. Contact: ensure LinkedIn URL and location are represented
  if (liProfile.sourceUrl && !/linkedin\.com/i.test(combined.contact || "")) {
    const cleanLi = liProfile.sourceUrl.replace(/^https?:\/\/(?:www\.)?/, "");
    combined.contact = (combined.contact ? combined.contact + " · " : "") + cleanLi;
  }
  if (liProfile.location && !/(?:dubai|abu dhabi|uae|saudi|riyadh|germany)/i.test(combined.contact || "")) {
    combined.contact = liProfile.location + (combined.contact ? " · " + combined.contact : "");
  }

  // 4. Summary: blend executive value proposition
  if (liProfile.summary) {
    if (!combined.summary) {
      combined.summary = liProfile.summary;
    } else if (liProfile.summary.length > combined.summary.length && !combined.summary.includes(liProfile.summary.slice(0, 30))) {
      // If LinkedIn summary is richer and distinct, combine them seamlessly
      const sentences = liProfile.summary
        .split(/(?<=[.!?])\s+/)
        .filter((s) => s.length > 20 && !combined.summary.toLowerCase().includes(s.slice(0, 25).toLowerCase()));
      if (sentences.length) {
        combined.summary = `${combined.summary}\n\n${sentences.slice(0, 3).join(" ")}`;
      }
    }
  }

  // 5. Roles / Experience: LOSSLESS MERGER
  let mergedCount = 0;
  let addedCount = 0;
  const existingRoles = combined.roles || [];
  const liRoles = liProfile.roles || [];

  for (const lr of liRoles) {
    // Find matching role in CV by company fuzzy match or title match
    const lrCompNorm = (lr.company || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const lrTitleNorm = (lr.title || "").toLowerCase();

    let matchedRole = null;
    for (const er of existingRoles) {
      const erCompNorm = (er.company || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const erTitleNorm = (er.title || "").toLowerCase();

      const compMatch = lrCompNorm && erCompNorm && (lrCompNorm.includes(erCompNorm) || erCompNorm.includes(lrCompNorm));
      const titleMatch = lrTitleNorm && erTitleNorm && (lrTitleNorm.includes(erTitleNorm) || erTitleNorm.includes(lrTitleNorm));

      if (compMatch || (titleMatch && lr.dates && er.dates && lr.dates.slice(0, 4) === er.dates.slice(0, 4))) {
        matchedRole = er;
        break;
      }
    }

    if (matchedRole) {
      // Merge bullets without duplicating
      matchedRole.bullets = matchedRole.bullets || [];
      for (const lb of lr.bullets || []) {
        const lbClean = lb.trim();
        const exists = matchedRole.bullets.some((b) => {
          const sim = b.toLowerCase();
          return sim.includes(lbClean.toLowerCase().slice(0, 30)) || lbClean.toLowerCase().includes(sim.slice(0, 30));
        });
        if (!exists && lbClean.length > 10) {
          matchedRole.bullets.push(lbClean);
          mergedCount++;
        }
      }
      if (!matchedRole.dates && lr.dates) matchedRole.dates = lr.dates;
      if (!matchedRole.location && lr.location) matchedRole.location = lr.location;
    } else if (lr.title || lr.company) {
      // Distinct role on LinkedIn: add it!
      existingRoles.push({
        title: lr.title || "Executive Role",
        company: lr.company || "",
        location: lr.location || "",
        dates: lr.dates || "",
        bullets: lr.bullets && lr.bullets.length ? lr.bullets : ["Contributed executive leadership, operational management, and strategic initiatives."]
      });
      addedCount++;
    }
  }

  combined.roles = existingRoles;

  // 6. Skills: Union of CV & LinkedIn skills
  const skillsSet = new Set((combined.skills || []).map((s) => s.trim()));
  const initialSkillCount = skillsSet.size;

  for (const s of liProfile.skills || []) {
    const trimmed = s.trim();
    if (trimmed && !Array.from(skillsSet).some((x) => x.toLowerCase() === trimmed.toLowerCase())) {
      skillsSet.add(trimmed);
    }
  }
  for (const c of liProfile.certifications || []) {
    const trimmed = c.trim();
    if (trimmed && !Array.from(skillsSet).some((x) => x.toLowerCase() === trimmed.toLowerCase())) {
      skillsSet.add(trimmed);
    }
  }
  combined.skills = Array.from(skillsSet).slice(0, 45);
  const skillsAdded = combined.skills.length - initialSkillCount;

  // 7. Education & Certifications
  if (liProfile.education) {
    if (!combined.education) {
      combined.education = liProfile.education;
    } else if (!combined.education.toLowerCase().includes(liProfile.education.toLowerCase().slice(0, 25))) {
      combined.education = `${combined.education} · ${liProfile.education}`;
    }
  }
  if (liProfile.certifications && liProfile.certifications.length) {
    const certStr = liProfile.certifications.join(" · ");
    if (!combined.education.includes(certStr.slice(0, 20))) {
      combined.education = `${combined.education} · ${certStr}`;
    }
  }

  // 8. Tagging combined state
  combined.isCombinedWithLinkedIn = true;
  combined.linkedInUrl = liProfile.sourceUrl || "";
  combined.combineStats = {
    rolesMerged: mergedCount,
    newRolesAdded: addedCount,
    skillsAdded: Math.max(0, skillsAdded),
    totalRoles: combined.roles.length,
    totalSkills: combined.skills.length
  };

  return combined;
}
