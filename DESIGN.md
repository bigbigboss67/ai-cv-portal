# Design System: Executive Career & Live Role Portal

## 1. Visual Theme & Atmosphere
The Executive Career Portal follows a **Calm Editorial Precision** aesthetic (`swiss_grid` + `atmospheric_minimalism`). Rather than crowding every tool, score card, job board, cover letter editor, and A4 document preview onto a single multi-panel screen, the interface operates as a **4-Page Guided Executive Flow** where **one step equals one dedicated full-screen page**:
- **Page 1 (Step 1 of 4) — Upload, Audit & Write Your CV**: Dedicated solely to uploading any CV format, applying 1-click HR Director word-for-word replacements, or writing/editing sections in the built-in CV Writer.
- **Page 2 (Step 2 of 4) — Live Role Search Across 10 Job Boards**: Dedicated solely to selecting target roles (`General Manager`, `Managing Director`, `Operations Director`, `COO`), filtering regions, and browsing a spacious 2-column Bento grid of verified live listings without the A4 CV crowding half the screen.
- **Page 3 (Step 3 of 4) — Tailored Cover Letter & A4 CV Review**: Dedicated 50/50 split view comparing the tailored multi-language cover letter on the left with the live A4 executive CV sheet on the right, plus 1-click ATS keyword injection.
- **Page 4 (Step 4 of 4) — 1-Click Application Dispatch**: Dedicated confirmation and dispatch view showing recipient email, subject line, attached ATS PDF badge (`CV - Name - Role.pdf`), and the primary action button that launches the user's email program with the styled HTML cover letter and attached CV PDF via `X-Unsent: 1` RFC-822 `.eml`.

A slide-over **Live A4 CV Drawer** is available from any page via a single header button so the user can inspect their formatted A4 sheet at any moment without permanent screen clutter.

## 2. Color Palette & Roles
- **Primary Canvas Background (Light Mode Default for Readability)**: Crisp Alabaster `#F8FAFC` (`--bg`)
- **Elevated Surface / Card Canvas**: Pure Architectural White `#FFFFFF` (`--bg-elevated`)
- **Subtle Grouping Surface**: Cool Stone `#F1F5F9` (`--surface`)
- **Glass / Floating Navigation Bar**: `rgba(255, 255, 255, 0.88)` with `backdrop-filter: blur(16px)`
- **Primary Ink (Headings & Core Copy)**: Deep Slate Obsidian `#0F172A` (`--text`)
- **Secondary Body Copy**: Balanced Slate `#334155` (`--text-secondary`)
- **Muted Metadata & Technical Labels**: Neutral Zinc `#64748B` (`--text-muted`)
- **Primary Executive Accent (Single Locked Accent)**: Deep Emerald `#059669` (`--emerald`), Hover `#047857`, Soft Tint `rgba(5, 150, 105, 0.08)`
- **Secondary Action / Interactive Focus**: Architectural Slate Navy `#0F172A` with subtle Slate Blue border `#CBD5E1`
- **Semantic Status Tokens**:
  - Verified / Added Wording: `#059669` (Emerald)
  - Caution / High-Priority Gap: `#D97706` (Warm Amber)
  - Removed / Old Wording Strike: `#DC2626` (Crimson)
- **Border & Hairline Divider Token**: `#E2E8F0` (`1px solid`), Active Card Border `#CBD5E1`
- **Dark Mode Adaptation (`html.dark-mode`)**: Deep Carbon Slate `#090D16` canvas, `#111827` elevated cards, `#F8FAFC` primary ink, `#94A3B8` muted ink, `#10B981` emerald accent, and `rgba(255, 255, 255, 0.08)` hairline borders.

## 3. Typography Rules
- **Display & Page Headlines (`--font-display`)**: `'Outfit'`, sans-serif — SemiBold (`600`) to Bold (`700`), tight tracking (`-0.03em`), line-height `1.12`. Constrained to wide containers (`max-width: 68rem`) so page titles never wrap beyond 2 lines.
- **UI & Editorial Body (`--font-sans`)**: `'Plus Jakarta Sans'`, sans-serif — Regular (`400`), Medium (`500`), SemiBold (`600`), line-height `1.6`, comfortable measure (`60ch–72ch`).
- **Technical Metadata, Scores & Reference Codes (`--font-mono`)**: `'JetBrains Mono'`, monospace — Medium (`500`) with `font-variant-numeric: tabular-nums` for ATS percentages, match scores, and reference codes.

## 4. Component Stylings
- **Top Stepper Navigation Bar**: Minimal single-row bar (`height: 68px`) with Brand Identity on the left, 4 numbered page pills (`1. Your CV`, `2. Find Jobs`, `3. Tailor & Review`, `4. Send Application`) in the center, and two utility controls on the right (`Preview Live A4 CV` drawer trigger + `Light/Dark` toggle).
- **Page Header Banner**: Clean, wide header at the top of each page showing `Step X of 4`, a 1–2 line headline, a plain-English 1-sentence explanation of what to do on this page, and a direct `Next Step` button.
- **1-Click Diff Cards (Page 1)**: Clean 2-column grid of Before/After cards. Old wording appears in a subtle crimson-tinted box with strikethrough; new wording appears in an emerald-tinted box; a full-width `Replace Old Wording in 1 Click` button sits at the bottom of each card.
- **Live Job Bento Cards (Page 2)**: Full-width 2-column Bento grid (`gap: 20px`). Each card displays verified source badge, match percentage, role title, company/location, matched executive keywords, and one primary action button: `Select Role & Go to Step 3`.
- **Bottom Page Action Footer**: Every page ends with a calm, unmistakable navigation bar featuring a `Back to Step X` button on the left and a large primary `Continue to Step X` CTA on the right.

## 5. Layout Principles
- **Strict Single-Step Page Isolation**: Only one page (`#step1Panel`, `#step2Panel`, `#step3Panel`, or `#step4Panel`) is visible at any time.
- **No Unsolicited Sidebars**: Pages 1, 2, and 4 use a centered container (`max-width: 1240px`) with generous whitespace (`padding: 32px 24px 64px`). The A4 CV sheet is shown side-by-side **only** when the user is actively editing in the CV Writer or reviewing on Page 3 (or when toggled via the `Preview Live A4 CV` slide-over drawer).
- **Hidden DOM Persistence for PDF Engine**: When the A4 CV sheet is not actively displayed on screen, `#pane .sheet#draftCvSheetEl` remains mounted inside the slide-over preview container (off-canvas rather than `display: none` during PDF generation) so `buildCvTextPdfBytes()` always has live DOM metrics.

## 6. Motion & Interaction Specifications
- **GSAP Page Transitions**: Switching between Pages 1, 2, 3, and 4 triggers a smooth `0.38s` GSAP `power3.out` fade-and-rise (`y: 14 -> 0`, `opacity: 0 -> 1`) and smoothly scrolls the viewport to the top of the new page.
- **Tactile Button Feedback**: Primary action buttons use `cubic-bezier(0.22, 1, 0.36, 1)` transitions with subtle `-1px` hover lift and crisp focus rings.

## 7. Anti-Patterns (Banned Patterns)
- **Banned**: Showing all 4 steps, telemetry decks, context banners, and permanent split panes simultaneously on one crowded screen.
- **Banned**: Emojis in UI buttons, navigation pills, headings, or status badges — use crisp inline SVG icons and typographic badges instead.
- **Banned**: Neon purple/magenta AI gradients or distracting spinning 3D gimmicks that compete with reading CV text and job descriptions.
- **Banned**: Narrow multi-line wrapped headlines (enforce the 2-line maximum headline rule).
