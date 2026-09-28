# Award-Winning 4-Step Executive CV Analyzer & Strict Role-Locked Live Job Portal — Design Spec

**Date:** 2026-09-28
**Project:** AI CV Portal (`https://ai-cv-portal.vercel.app`)
**Roles Embodied:** Executive CV Builder & Analyzer, Human Resource Director, Award-Winning Principal UX/UI Designer

---

## 1. Problem Statement & UX Goals

The previous portal had powerful capabilities (universal CV upload, live job scraping, keyword lenses, cover letter generation, email lookup, `.eml` and ATS PDF export), but **too many controls were visible at once or tucked into dense panels**, causing the user to feel lost about where to start and what to click next.

### Core Objectives
1. **Zero Getting Lost (Guided 4-Step Wizard):**
   - Present a floating top **4-Step Guided Progress Bar** with a glowing **`Next Step →`** CTA button that always highlights the exact current step and next action.
   - Show only the active step's focused workspace on the left while keeping the **Live Interactive A4 Executive CV Sheet** visible and synchronized on the right (or side-by-side in Step 3/4).
2. **HR Director CV Analyzer with 1-Click Automatic Wording Replacement (Step 1):**
   - Analyze any uploaded or active CV across 4 HR Director dimensions: **Executive Authority & Action Verbs**, **Quantified P&L & Operational Impact**, **Board & Governance Positioning**, and **ATS Keyword Density**.
   - Generate specific, grounded **Before → After Suggestion Cards** for every weak or improvable line in the CV.
   - Every suggestion card displays:
     - **📍 Exact Location on CV:** e.g., `Executive Summary · Core Pitch` or `Experience → Role #1 (General Manager) · Bullet 2` or `Core Executive Competencies`.
     - **💡 HR Director Rationale:** Concise explanation of why the upgrade increases shortlist conversion.
     - **❌ Current Wording (Red Box):** The exact text currently on the CV.
     - **✅ HR Director Suggested Wording (Emerald Box):** The upgraded executive wording ready to insert.
     - **⚡ `[ 1-Click Replace Automatically ]` Button:** Replaces the old wording with the new suggestion directly inside the live CV with zero user typing, flashes the updated line in emerald green on the A4 CV sheet, and toggles to `✓ Applied (Click to Undo)`.
   - Include a top hero button: **`⚡ Auto-Fix All CV Suggestions in 1 Click`** that applies every pending improvement across the entire CV at once.
3. **Strict Role-Locked Live Internet Job Search (Step 2):**
   - Auto-extract the user's target roles from their CV (e.g., `General Manager`, `Managing Director`, `Operations Director`, `Chief Operating Officer`) and display them as interactive **Target Role Lock Chips** (`+ Add Custom Role` input supported).
   - **Strict Role Filter Gate:** Both backend (`/api/match`) and frontend strictly filter job listings so **only** vacancies matching the user's active Target Role chips are displayed.
   - **All Major Internet Job Sources:** Query **Indeed**, **Dubizzle**, **LinkedIn**, **Bayt**, **Naukrigulf**, **GulfTalent**, **Michael Page**, **Page Executive**, **Charterhouse**, **Departer**, and **AHK** in parallel.
   - Each job card features a clean layout with source badge (`Indeed`, `Dubizzle`, `LinkedIn`, `Bayt`, `GulfTalent`, etc.), CV Match %, matched role chip, and one unmistakable button: **`⚡ 1-Click Tailor CV & Cover Letter for This Job →`**.
4. **1-Click Tailored Application Review (Step 3) & Ready-to-Send Export Hub (Step 4):**
   - Clicking any job card in Step 2 automatically converts the listing into a **Tailored CV + Tailored Cover Letter (`EN`/`DE`/`AR`/`FR`/`ES`)** in Step 3, showing a clear **Listing → Application Conversion Summary** and 1-click ATS keyword injection.
   - Step 4 provides the **Ready-to-Send Package**: auto-extracted or auto-discovered HR/Recruiter `To:` email, `Subject:` line with reference code, **1-Click `.EML` Download (with ATS PDF attached)**, and **1-Click Standalone ATS PDF Download**.

---

## 2. Architecture & File Breakdown

- **`api/_boards.js`**:
  - Live scrapers and targeted search connectors for:
    1. **LinkedIn Guest Search + Job Detail Hydration API**
    2. **Indeed Live Search** (UAE / GCC / Global executive role search via direct & open-web site-targeted scraping)
    3. **Dubizzle Live Jobs Search** (`dubai.dubizzle.com/jobs` / UAE executive roles)
    4. **Bayt & Naukrigulf Live Search** (`bayt.com`, `naukrigulf.com` executive vacancies)
    5. **GulfTalent, Michael Page, Page Executive, Charterhouse, Departer, AHK, Arbeitnow, Remotive**
  - Strict role-title matching helper (`matchesTargetRolesStrict`) so results strictly honor the user's selected roles.
- **`api/match.js`**:
  - Accepts `targetRoles` (array of strict target roles such as `["General Manager", "Managing Director", "Operations Director"]`), `strictRoleOnly: true`, `location`, and `text` (CV text).
  - Queries all boards in parallel for the exact target roles, hydrates top matches with full descriptions, and applies strict title filtering when `strictRoleOnly` is enabled.
- **`api/job-detail.js` & `api/site.js`**:
  - Full live job description hydration and company domain / HR email discovery.
- **`index.html`**:
  - Redesigned **Award-Winning 4-Step Guided Executive Portal** implementing:
    - Floating 4-Step Guided Progress Stepper + persistent **"What's Next"** CTA button.
    - Step 1: Universal CV Upload + **HR Director CV Analyzer & 1-Click Auto-Improver** alongside the live A4 CV preview.
    - Step 2: **Strict Role-Locked Live Internet Search** with interactive role chips (`General Manager`, `Managing Director`, `Operations Director`, etc.), source badges (`Indeed`, `Dubizzle`, `LinkedIn`, `Bayt`, `GulfTalent`, `Naukrigulf`, `Michael Page`, `Page Executive`, `Charterhouse`), and 1-click job-to-application conversion.
    - Step 3: **Tailored CV & Cover Letter Studio** with 1-click ATS keyword injection and multi-language cover letters (`EN`/`DE`/`AR`/`FR`/`ES`).
    - Step 4: **Ready-to-Send Application Export Hub** (`.eml` with attached ATS PDF, standalone ATS PDF, 1-click HR email finder).
