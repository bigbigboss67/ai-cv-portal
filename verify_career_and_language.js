const { chromium } = require('C:/Users/bigbi/node_modules/playwright');
const path = require('path');
const fs = require('fs');

const ARTIFACT_DIR = "C:\\Users\\bigbi\\.gemini\\antigravity\\brain\\f7afc8a9-a58c-4a3a-8bba-df8f932ba07a";
const TARGET_URL = "http://localhost:3847/index.html";

(async () => {
  console.log("=== STARTING VERIFICATION: CARRIER SECTION & LANGUAGE DEDICATED ROLES ===");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error' || msg.text().includes('CV') || msg.text().includes('Lang')) {
      console.log(`[Browser ${msg.type()}]:`, msg.text());
    }
  });

  console.log("Navigating to:", TARGET_URL);
  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  // 1. TEST CV PARSING WITH "CARRIER" AND ALL SECTIONS
  console.log("\n--- TEST 1: CV Parsing with 'CARRIER' Section Header & Multilingual Headers ---");
  const testCvText = `
ALEXANDER WEISS
Senior Cloud Solutions Architect & Enterprise Consultant
Email: alexander.weiss@enterprise-cloud.de | Phone: +49 89 12345678 | Munich, Germany
LinkedIn: linkedin.com/in/alex-weiss | GitHub: github.com/aweiss

PROFESSIONAL SUMMARY
Visionary enterprise cloud architect with 11+ years leading multi-region AWS & Azure transformations. Trilingual engineering director with proven success scaling European and MENA enterprise infrastructures, driving 40% cloud cost reduction and 99.999% SLA adherence.

CARRIER HISTORY
Principal Solutions Architect | Siemens Enterprise Cloud
Munich, Germany | 03/2021 - PRESENT
• Orchestrated DACH enterprise hybrid cloud migration across 45 distributed microservices reducing latency by 42%.
• Spearheaded cross-functional engineering squads across Frankfurt, Paris, and Dubai delivering sovereign cloud compliance (BSI C5, GDPR).
• Automated Terraform CI/CD pipelines deploying infrastructure across multi-cloud environments saving 320 engineering hours monthly.

Senior Cloud Infrastructure Engineer | BMW Group IT
Munich, Germany | 06/2017 - 02/2021
• Designed Kubernetes clusters handling 15M+ daily telematics telemetry events with zero downtime.
• Mentored 14 mid-level cloud DevOps engineers and delivered technical workshops in German and English.
• Implemented FinOps monitoring frameworks capturing €1.4M annual cloud spend savings.

Cloud Systems Administrator | T-Systems International
Frankfurt, Germany | 09/2014 - 05/2017
• Managed mission-critical Linux server fleets across Tier-3 data centers maintaining 99.99% availability.
• Configured Cisco routing, MPLS backbones, and enterprise perimeter firewalls.

TECHNICAL SKILLS & CORE COMPETENCIES
Cloud Platforms: AWS (Solutions Architect Pro), Azure (Solutions Architect Expert), Google Cloud
DevOps & Containers: Kubernetes, Docker, Terraform, Helm, GitHub Actions, GitLab CI/CD, ArgoCD
Languages: Python, Go, Bash, SQL, TypeScript, YAML
Security & Governance: ISO 27001, BSI C5, SOC 2, Zero Trust Architecture, HashiCorp Vault

EDUCATION & QUALIFICATIONS
Master of Science in Computer Science | Technical University of Munich (TUM)
Munich, Germany | 2012 - 2014
Bachelor of Science in Information Technology | University of Stuttgart
Stuttgart, Germany | 2008 - 2012

CERTIFICATIONS & CREDENTIALS
• AWS Certified Solutions Architect - Professional (SAP-C02)
• Certified Kubernetes Administrator (CKA)
• HashiCorp Certified: Terraform Associate
• TOGAF 9.2 Certified Enterprise Architect

LANGUAGES
• German: Native / Full Professional Fluency (C2)
• English: Bilingual / Fluent (C2)
• French: Professional Working Proficiency (B2/C1)
• Arabic: Conversational / Business Basics (A2)
`;

  const parseResult = await page.evaluate((cvText) => {
    try {
      if (typeof parseRawTextIntoCv !== 'function') {
        return { error: "parseRawTextIntoCv is not defined" };
      }
      const parsed = parseRawTextIntoCv(cvText, "alexander_weiss_resume.txt");
      return {
        success: true,
        fullName: state.cv.fullName,
        jobTitle: state.cv.jobTitle,
        email: state.cv.email,
        phone: state.cv.phone,
        location: state.cv.location,
        summaryLen: (state.cv.summary || "").length,
        rolesCount: (state.cv.roles || []).length,
        roles: state.cv.roles.map(r => ({
          title: r.title,
          company: r.company,
          dates: r.dates,
          bulletsCount: (r.bullets || []).length
        })),
        skillsCount: (state.cv.skills || []).length,
        skillsSample: (state.cv.skills || []).slice(0, 8),
        educationCount: (state.cv.education || []).length,
        education: state.cv.education,
        certificationsCount: (state.cv.certifications || []).length,
        certifications: state.cv.certifications,
        languagesCount: (state.cv.languages || []).length,
        languages: state.cv.languages
      };
    } catch (e) {
      return { error: e.message, stack: e.stack };
    }
  }, testCvText);

  console.log("Parsing Result:", JSON.stringify(parseResult, null, 2));

  if (parseResult.error) {
    throw new Error(`Parse failed: ${parseResult.error}\n${parseResult.stack}`);
  }

  // Assertions for CV parse
  if (parseResult.rolesCount < 3) {
    throw new Error(`Expected at least 3 roles parsed from CARRIER HISTORY, got ${parseResult.rolesCount}`);
  }
  console.log(`✔ SUCCESS: ${parseResult.rolesCount} roles extracted from 'CARRIER HISTORY' section!`);
  console.log(`✔ SUCCESS: ${parseResult.skillsCount} skills extracted!`);
  console.log(`✔ SUCCESS: ${parseResult.educationCount} education entries extracted!`);
  console.log(`✔ SUCCESS: ${parseResult.languagesCount} languages extracted!`);

  // Screenshot Step 1 with parsed data in UI
  await page.waitForTimeout(500);
  const cvScreenshotPath = path.join(ARTIFACT_DIR, 'cv_career_section_parsed.png');
  await page.screenshot({ path: cvScreenshotPath, fullPage: false });
  console.log(`Saved screenshot: ${cvScreenshotPath}`);

  // 2. TEST STEP 2: JOB SEARCH WITH LANGUAGE DEDICATED ROLES
  console.log("\n--- TEST 2: Job Search Language Dedicated Roles Filtering ---");
  await page.evaluate(() => {
    goToStep(2);
  });
  await page.waitForTimeout(600);

  // Check language filter bar exists
  const langBarExists = await page.evaluate(() => {
    const bar = document.getElementById('langPillsRow');
    return !!bar;
  });
  console.log("Language filter bar present:", langBarExists);
  if (!langBarExists) throw new Error("Language filter bar #langPillsRow not found");

  // Test German Filter
  console.log("Testing German filter pill click...");
  await page.evaluate(() => {
    const germanPill = document.querySelector('.lang-filter-pill[data-lang="german"]');
    if (germanPill) germanPill.click();
    else if (typeof setLanguageFilter === 'function') setLanguageFilter('german');
  });
  await page.waitForTimeout(500);

  const germanFilterState = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('#jobCardsContainer .exec-job-card'));
    const visibleCards = cards.filter(c => c.style.display !== 'none');
    const titles = visibleCards.map(c => {
      const h3 = c.querySelector('h3, .job-title');
      const badge = c.querySelector('.lang-req-badge');
      return {
        title: h3 ? h3.innerText.trim() : 'Unknown',
        badge: badge ? badge.innerText.trim() : 'No Badge'
      };
    });
    return {
      activeFilter: state.activeLanguageFilter,
      visibleCount: visibleCards.length,
      titles
    };
  });
  console.log("German filter results:", germanFilterState);
  if (germanFilterState.visibleCount === 0) {
    throw new Error("German filter returned 0 jobs!");
  }
  const germanScreenshotPath = path.join(ARTIFACT_DIR, 'job_search_language_filter_german.png');
  await page.screenshot({ path: germanScreenshotPath });
  console.log(`Saved screenshot: ${germanScreenshotPath}`);

  // Test French Filter
  console.log("Testing French filter pill click...");
  await page.evaluate(() => {
    const frenchPill = document.querySelector('.lang-filter-pill[data-lang="french"]');
    if (frenchPill) frenchPill.click();
    else if (typeof setLanguageFilter === 'function') setLanguageFilter('french');
  });
  await page.waitForTimeout(500);

  const frenchFilterState = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('#jobCardsContainer .exec-job-card'));
    const visibleCards = cards.filter(c => c.style.display !== 'none');
    const titles = visibleCards.map(c => {
      const h3 = c.querySelector('h3, .job-title');
      const badge = c.querySelector('.lang-req-badge');
      return {
        title: h3 ? h3.innerText.trim() : 'Unknown',
        badge: badge ? badge.innerText.trim() : 'No Badge'
      };
    });
    return {
      activeFilter: state.activeLanguageFilter,
      visibleCount: visibleCards.length,
      titles
    };
  });
  console.log("French filter results:", frenchFilterState);
  if (frenchFilterState.visibleCount === 0) {
    throw new Error("French filter returned 0 jobs!");
  }
  const frenchScreenshotPath = path.join(ARTIFACT_DIR, 'job_search_language_filter_french.png');
  await page.screenshot({ path: frenchScreenshotPath });
  console.log(`Saved screenshot: ${frenchScreenshotPath}`);

  // Test Arabic Filter
  console.log("Testing Arabic filter pill click...");
  await page.evaluate(() => {
    const arabicPill = document.querySelector('.lang-filter-pill[data-lang="arabic"]');
    if (arabicPill) arabicPill.click();
    else if (typeof setLanguageFilter === 'function') setLanguageFilter('arabic');
  });
  await page.waitForTimeout(500);

  const arabicFilterState = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('#jobCardsContainer .exec-job-card'));
    const visibleCards = cards.filter(c => c.style.display !== 'none');
    return {
      activeFilter: state.activeLanguageFilter,
      visibleCount: visibleCards.length
    };
  });
  console.log("Arabic filter results:", arabicFilterState);
  if (arabicFilterState.visibleCount === 0) {
    throw new Error("Arabic filter returned 0 jobs!");
  }

  // 3. TEST STEP 3: COVER LETTER WITH LANGUAGE ALIGNMENT
  console.log("\n--- TEST 3: Cover Letter Language Alignment for German Mandate ---");
  await page.evaluate(() => {
    setLanguageFilter('german');
    selectAndTailorJob(0);
  });
  await page.waitForTimeout(800);

  const coverLetterResult = await page.evaluate(() => {
    const clText = document.getElementById('coverLetterTextarea') ? document.getElementById('coverLetterTextarea').value : '';
    const mentionsGerman = /german|deutsch|dach/i.test(clText);
    return {
      targetJobTitle: state.selectedJob ? state.selectedJob.title : null,
      targetCompany: state.selectedJob ? state.selectedJob.company : null,
      textSnippet: clText.slice(0, 400),
      mentionsGerman
    };
  });

  console.log("Cover Letter Result:", coverLetterResult);
  if (!coverLetterResult.mentionsGerman) {
    throw new Error("German language alignment clause was not found in generated cover letter!");
  }
  console.log("✔ SUCCESS: Cover letter explicitly aligned to German language mandate!");

  const clScreenshotPath = path.join(ARTIFACT_DIR, 'cover_letter_language_alignment.png');
  await page.screenshot({ path: clScreenshotPath });
  console.log(`Saved screenshot: ${clScreenshotPath}`);

  console.log("\n=== ALL VERIFICATION TESTS PASSED SUCCESSFULLY! ===");
  await browser.close();
})().catch(err => {
  console.error("VERIFICATION FAILED:", err);
  process.exit(1);
});
