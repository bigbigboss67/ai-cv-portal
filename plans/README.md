# Animation & 3D Spatial Motion Plans (`improve-animations` + `design-taste-frontend`)

## Design Read (`design-taste-frontend` Section 0.B)
> **Reading this as:** Flagship 3D Spatial Executive Career Command Portal for C-Suite & Senior Operations Leaders (General Manager, Managing Director, Operations Director, COO), with a **Cold-Luxury Spatial 3D + Liquid Glass + Precision Motion** language, leaning toward **Three.js WebGL ambient spatial architecture, GPU-accelerated 3D perspective tilt physics, and Emil Kowalski cubic-bezier micro-choreography**.

## Dial Configuration (`design-taste-frontend` Section 1)
- `DESIGN_VARIANCE: 8` (Asymmetric 2-column spatial command deck + floating 3D A4 executive paper stage)
- `MOTION_INTENSITY: 9` (60fps Three.js 3D orbital constellation canvas + rAF-interpolated 3D perspective card tilt + specular glare + staggered 3D depth reveals)
- `VISUAL_DENSITY: 5` (High-clarity executive cockpit with guided 4-step progressive disclosure)

## Vetted Motion Audit Findings (`improve-animations` Phase 2 & 3)

| # | Severity | Category | Location | Finding | Fix Summary |
| --- | --- | --- | --- | --- | --- |
| 1 | **HIGH** | Performance & Easing | `index.html` (`.step-tab`, `.btn-autofix-hero`, `.exec-job-card`, `.btn-tailor-job`) | Multiple interactive classes used `transition: all 0.2s ease`, animating layout properties off-GPU with weak default easing. | Replace `transition: all` with explicit GPU-composited `transform`, `opacity`, `box-shadow`, and `border-color` using `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`. |
| 2 | **HIGH** | Missed Opportunity (3D Spatial Depth) | `index.html` (Hero, Scoreboard, Job Cards, Live A4 CV Sheet) | Flat 2D planes lacked spatial depth, 3D perspective tilt, specular light refraction, and ambient 3D WebGL depth. | Add Three.js WebGL 3D Executive Orbital Lattice (`#webgl3dCanvas`), rAF-lerped 3D perspective card tilt (`[data-tilt-3d]`), and a 3D-tilted A4 CV stage with AI laser scan beam. |
| 3 | **MEDIUM** | Physicality & Origin | `index.html` (`.modal-card`, `.step-pane`, `.toast-bar`) | Step switches and modals toggled `display: none/block` instantaneously without 3D depth entrance or `scale(0.96 -> 1)` physicality, and buttons lacked `:active` `scale(0.97)` press feedback. | Add `scale(0.96) translate3d(0, 14px, -24px)` -> `scale(1) translate3d(0,0,0)` with `--ease-out` (240ms) and `:active { transform: scale(0.97) }` (140ms). |
| 4 | **MEDIUM** | Accessibility & Touch Gating | `index.html` (global CSS) | Hover transforms were not gated behind `@media (hover: hover) and (pointer: fine)` and lacked a complete `@media (prefers-reduced-motion: reduce)` fallback. | Gate all hover/3D tilt effects behind `(hover: hover) and (pointer: fine)` and add full `prefers-reduced-motion: reduce` + live 3D toggle button. |
| 5 | **LOW** | Cohesion & Tokens | `index.html` (`:root`) | Easing curves, durations, and 3D perspective distances were hardcoded inline rather than unified as shared design tokens. | Consolidate `--ease-out`, `--ease-in-out`, `--ease-drawer`, `--perspective-stage`, and `--glare-alpha` in `:root` and stagger card entrances (`45ms` per item). |

## Execution Order

| Plan | Title | Dependencies | Status |
| --- | --- | --- | --- |
| [001-3d-spatial-motion-and-1kk-executive-portal.md](001-3d-spatial-motion-and-1kk-executive-portal.md) | 3D WebGL Spatial Architecture, Interactive 3D Tilt Physics & Emil Kowalski Motion Tokens | None | **DONE** |
