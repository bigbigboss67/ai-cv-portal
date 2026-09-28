# Award-Winning 4-Step Executive CV Analyzer & Strict Role-Locked Live Job Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy the redesigned 4-Step Guided Executive Career Portal featuring an HR Director 1-Click CV Analyzer (automatic old-to-new wording replacement on the live CV), Strict Role-Locked Live Internet Job Search across Indeed, Dubizzle, LinkedIn, Bayt, Naukrigulf, GulfTalent, Michael Page, Page Executive, Charterhouse, Departer, and AHK, and 1-Click Listing-to-Draft Application export.

**Architecture:** Serverless multi-board scraping backend (`api/_boards.js`, `api/match.js`, `api/job-detail.js`, `api/site.js`) paired with a luxury editorial 4-Step Guided Wizard frontend (`index.html`) that eliminates visual clutter by showing a persistent 4-Step Progress Bar with a glowing "Next Step →" button alongside the real-time A4 Executive CV sheet.

**Tech Stack:** HTML5, Vanilla ES2022 JS, CSS Custom Properties (Luxury Editorial Alabaster + Obsidian + Royal Indigo + Emerald Design System), Vercel Serverless Functions (Node.js), PDF.js, Mammoth.js, Tesseract.js.

## Global Constraints
- Never fabricate candidate employers, dates, or fake HR email addresses.
- 1-Click CV Analyzer must show exact CV location (`Executive Summary`, `Experience → Role #N → Bullet #M`, `Core Competencies`), `Old Wording` (red), `HR Director Suggested Wording` (green), and replace the wording automatically in 1 click (plus `Auto-Fix All CV Suggestions in 1 Click` at the top and 1-click `Undo`).
- Live job search must support **Strict Role Lock** (filtering strictly to the user's selected roles like `General Manager`, `Managing Director`, `Operations Director`, `Chief Operating Officer`) across **Indeed**, **Dubizzle**, **LinkedIn**, **Bayt**, **Naukrigulf**, **GulfTalent**, **Michael Page**, **Page Executive**, **Charterhouse**, **Departer**, and **AHK**.
- Keep `C:\Users\bigbi\.gemini\antigravity\scratch\career-portal-redesign`, `C:\Users\bigbi\OneDrive\سطح المكتب\ai cv portal`, `C:\Users\bigbi\Desktop\ai cv portal`, `https://github.com/bigbigboss67/ai-cv-portal`, and `https://ai-cv-portal.vercel.app` synchronized.

---

### Task 1: Multi-Board Internet Job Scrapers (Indeed, Dubizzle, Bayt, Naukrigulf, LinkedIn, GulfTalent, Executive Headhunters) & Strict Role Lock Filter

**Files:**
- Modify: `api/_boards.js`
- Modify: `api/match.js`
- Modify: `scripts/fetch-listings.mjs`

- [x] **Step 1: Add Indeed, Dubizzle, Bayt, and Naukrigulf live scrapers + Strict Role Title Matcher in `api/_boards.js`**
- [x] **Step 2: Update `api/match.js` to accept `targetRoles` and `strictRoleOnly`, query all 12 sources in parallel, and strictly filter results to the user's selected target roles**
- [x] **Step 3: Test `api/match.js` locally with Node to verify strict role matching and multi-board results**

---

### Task 2: Redesigned 4-Step Guided Wizard UI, HR Director 1-Click CV Analyzer, and Strict Role Search Studio (`index.html`)

**Files:**
- Modify: `index.html`

- [x] **Step 1: Build the Top Floating 4-Step Guided Progress Bar & Persistent "Next Step →" Action Controller**
- [x] **Step 2: Build Step 1 — Universal CV Upload + HR Director CV Analyzer with `⚡ Auto-Fix All CV Suggestions in 1 Click` and Individual `1-Click Replace Automatically` Diff Cards**
- [x] **Step 3: Build Step 2 — Strict Role-Locked Live Internet Search Bar (Interactive Role Chips, Location Selector, Source Badges for Indeed, Dubizzle, LinkedIn, Bayt, Naukrigulf, GulfTalent, Michael Page, Page Executive, Charterhouse) & High-Clarity Job Cards**
- [x] **Step 4: Build Step 3 (1-Click Auto-Tailored CV & Cover Letter Studio) & Step 4 (Ready-to-Send Application Export Hub)**

---

### Task 3: Verification, Desktop & Artifact Sync, GitHub Push, and Vercel Production Deployment

**Files:**
- Sync: `C:\Users\bigbi\OneDrive\سطح المكتب\ai cv portal`
- Sync: `C:\Users\bigbi\Desktop\ai cv portal`
- Sync: `C:\Users\bigbi\.gemini\antigravity\brain\f7afc8a9-a58c-4a3a-8bba-df8f932ba07a\career_portal_redesign_standalone.html`

- [x] **Step 1: Validate inline JS syntax and run local API smoke tests**
- [x] **Step 2: Sync all files to Desktop folders and standalone artifact**
- [x] **Step 3: Commit, push to `bigbigboss67/ai-cv-portal`, deploy to `https://ai-cv-portal.vercel.app`, and verify live endpoints**
