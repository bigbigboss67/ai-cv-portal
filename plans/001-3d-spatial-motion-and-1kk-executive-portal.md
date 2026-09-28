# Plan 001: 3D WebGL Spatial Architecture, Interactive 3D Tilt Physics & Emil Kowalski Motion Tokens

- **Commit Baseline**: `0caa83e`
- **Target File**: `index.html`
- **Skills Applied**: `design-taste-frontend` + `improve-animations`

## 1. Motion & 3D Tokens (Exact Values from `AUDIT.md` & `design-taste-frontend`)

```css
:root {
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);        /* strong ease-out for UI entrances & 3D reveals */
  --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);    /* strong ease-in-out for on-screen morphing */
  --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);     /* iOS-like drawer & modal curve */
  --ease-spring: cubic-bezier(0.16, 1, 0.3, 1);      /* spatial 3D tilt return */
  --perspective-stage: 1400px;
}
```

## 2. Three.js WebGL 3D Spatial Constellation (`#webgl3dCanvas`)
- Fixed, `pointer-events: none` WebGL canvas (`z-index: 0`) rendering:
  1. **3D Executive Icosahedron Wireframe Core + Inner Energy Sphere** rotating smoothly in 3D space.
  2. **3D Orbital Node Network & Depth Particle Field** (320 spatial nodes in 3D depth) representing global executive job boards (Indeed, Dubizzle, LinkedIn, Bayt, GulfTalent, Naukrigulf, Page Executive, Michael Page, Charterhouse, Departer).
  3. **Step-Driven 3D Camera Choreography**: Switching between Step 1, Step 2, Step 3, and Step 4 smoothly interpolates (`lerp`) the Three.js camera position, rotation, and orbital speed!

## 3. GPU-Accelerated 3D Tilt & Specular Light Glare (`[data-tilt-3d]`)
- Mouse movement over `[data-tilt-3d]` cards updates `transform: perspective(1200px) rotateX(...) rotateY(...) translate3d(0, -3px, 12px)` via `requestAnimationFrame` with radial specular highlight overlay (`::after`).
- Gated strictly behind `@media (hover: hover) and (pointer: fine)` and disabled automatically when `prefers-reduced-motion: reduce` or when the user toggles `3D Motion: OFF`.

## 4. 3D Floating A4 Executive CV Stage & AI Laser Scan
- The right-hand Live A4 CV sheet sits inside `.cv-3d-stage` (`perspective: 1600px`) with a toggleable **3D Isometric Showcase Tilt** (`rotateY(-6deg) rotateX(2.5deg) translateZ(14px)`), multi-layered physical elevation shadow, and an animated **3D Emerald AI Laser Scan Beam** that sweeps across the A4 document whenever the HR Director analyzes or auto-fixes the CV!

## 5. Verification & Feel-Check
- Verify zero `transition: all` declarations remain.
- Verify all buttons respond within `140ms` on `:active` with `transform: scale(0.97)`.
- Verify `buildCvTextPdfBytes()` and `buildEml()` continue to read `#draftCvSheetEl` (`class="cv-sheet sheet"`) and attach the real selectable ATS CV PDF to `.eml` drafts without any interference from 3D transforms.
