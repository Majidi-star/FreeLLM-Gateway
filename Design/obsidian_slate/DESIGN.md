---
name: Obsidian Slate
colors:
  surface: '#121318'
  surface-dim: '#121318'
  surface-bright: '#38393f'
  surface-container-lowest: '#0d0e13'
  surface-container-low: '#1a1b21'
  surface-container: '#1e1f25'
  surface-container-high: '#292a2f'
  surface-container-highest: '#34343a'
  on-surface: '#e3e1e9'
  on-surface-variant: '#cbc3d7'
  inverse-surface: '#e3e1e9'
  inverse-on-surface: '#2f3036'
  outline: '#958ea0'
  outline-variant: '#494454'
  surface-tint: '#d0bcff'
  primary: '#d0bcff'
  on-primary: '#3c0091'
  primary-container: '#a078ff'
  on-primary-container: '#340080'
  inverse-primary: '#6d3bd7'
  secondary: '#adc6ff'
  on-secondary: '#002e6a'
  secondary-container: '#0566d9'
  on-secondary-container: '#e6ecff'
  tertiary: '#4edea3'
  on-tertiary: '#003824'
  tertiary-container: '#00a572'
  on-tertiary-container: '#00311f'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#e9ddff'
  primary-fixed-dim: '#d0bcff'
  on-primary-fixed: '#23005c'
  on-primary-fixed-variant: '#5516be'
  secondary-fixed: '#d8e2ff'
  secondary-fixed-dim: '#adc6ff'
  on-secondary-fixed: '#001a42'
  on-secondary-fixed-variant: '#004395'
  tertiary-fixed: '#6ffbbe'
  tertiary-fixed-dim: '#4edea3'
  on-tertiary-fixed: '#002113'
  on-tertiary-fixed-variant: '#005236'
  background: '#121318'
  on-background: '#e3e1e9'
  surface-variant: '#34343a'
typography:
  headline-xl:
    fontFamily: Plus Jakarta Sans
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
    letterSpacing: -0.03em
  headline-xl-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 36px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.015em
  headline-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 26px
    letterSpacing: -0.005em
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 22px
    letterSpacing: 0em
  body-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0.01em
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.04em
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 10px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.06em
  metric-display:
    fontFamily: Plus Jakarta Sans
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 34px
    letterSpacing: -0.02em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  space-2xs: 0.25rem
  space-xs: 0.5rem
  space-sm: 0.75rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2rem
  space-2xl: 3rem
  space-3xl: 4rem
  gutter-mobile: 1rem
  gutter-desktop: 1.5rem
  sidebar-width: 16rem
  card-padding: 1.25rem
---

## Brand & Style

The design system is engineered for modern developer platforms, telemetry dashboards, and high-performance technical tools. It projects deep focus, analytical precision, and understated craft. 

The aesthetic is anchored in dark matte slate surfaces—layered, low-reflectance charcoal and obsidian tiers—punctuated by vivid yet flat jewel/neon signals (violet, electric blue, amber, coral, and soft mint). It blends **Minimalism** and **Technical Graphic Constructivism**: sprawling empty spaces are balanced by micro-detailed line graphics, parametric contour waves, dot clusters, and sharp technical badges in the corners of interactive cards. 

The emotional response should feel like entering a calibrated workspace: zero glare, maximum signal-to-noise ratio, instant typographic clarity, and purposeful chromatic anchors.

## Colors

The system uses an intentional tiered-slate surface hierarchy designed to prevent eye fatigue while preserving sharp spatial separation without heavy borders or drop shadows:

- **Canvas & Backgrounds**: `#0f1015` serves as the root viewport canvas.
- **Card Surfaces**: `#161820` provides the base for modular cards and workspace tiles.
- **Elevated Surfaces & Flyouts**: `#1e202b` supports hovered states, dropdown panels, floating toolbars, and modal elements.
- **Borders & Dividers**: Low-contrast borders use `#282b3a` (subtle) and `#35394d` (interactive/active outlines).

Accent colors are deployed systematically as functional markers, priority tiers, and category identification:
- **Violet (`#8b5cf6`)**: Primary action, API/SDK tags, developer credentials, and primary metric indicators.
- **Electric Blue (`#3b82f6`)**: Network requests, download badges, cloud infra states, and informational callouts.
- **Soft Mint (`#10b981`)**: Health status, positive delta, success badges, and runtime latency guarantees (deliberately calibrated away from harsh lime or pure green emerald).
- **Warm Amber (`#f59e0b`)**: Warnings, pending syncs, elevated queue thresholds, and medium-severity incidents.
- **Coral Red (`#f43f5e`)**: Critical alerts, failed assertions, error rates, and destructive actions.

Text colors prioritize hierarchy:
- Primary text: `#f8fafc` (high-contrast clarity)
- Secondary text: `#94a3b8` (metadata, timestamps, subtitles)
- Muted/Tertiary text: `#64748b` (labels, inactive counts, placeholders)

## Typography

The typography leverages **Plus Jakarta Sans** for headlines and standard body copy to provide an open, modern, and readable geometry with contemporary terminal cuts. For technical metadata, dates, hashes, status codes, and micro category labels, **JetBrains Mono** provides precise column alignment and authentic developer credibility.

Key typographic rules:
- **Metric Emphasis**: Quantities and status values use bold weights with tight letter tracking (`-0.02em`) to remain compact alongside trailing percentages.
- **Micro Overlines & Timestamps**: Always rendered in `label-sm` or `body-sm` with dimmed opacity (`#94a3b8` or `#64748b`) to prevent visual friction with primary titles.
- **Numbers & Data Rows**: Numbers in tabular interfaces should inherit tabular figures (`font-variant-numeric: tabular-nums`) to maintain vertical rhythm across dashboards.

## Layout & Spacing

The layout model is built on an 8pt architectural grid with a fluid multi-column arrangement:

- **Desktop (1280px+)**: A static navigation rail or drawer (`16rem`), accompanied by a 12-column fluid grid. Column gutters are fixed at `1.5rem` (`24px`), with outer canvas padding scaling between `1.5rem` and `2.5rem`.
- **Tablet (768px - 1024px)**: Collapses the sidebar into an icon-dock or overlay drawer; grids collapse to 6 columns with `1rem` gutters.
- **Mobile (< 768px)**: Single or 2-column stacked flow. Outer gutters step down to `1rem` (`16px`). Metric tiles collapse into horizontally swipeable ribbons or 2-column key-value pairs.

Cards leverage internal padding of `1.25rem` (`20px`) to maximize surface density while giving large graphic corner flourishes and vector path lines enough room to breathe without colliding with typography.

## Elevation & Depth

Visual hierarchy is maintained through **tonal layering** and **fine ghost borders**, avoiding heavy, muddy shadows.

1. **Base Surface (`#0f1015`)**: Deep canvas base.
2. **Container Tier 1 (`#161820`)**: Standard dashboard cards, list groups, and sidebars. Defined with an hairline perimeter border: `1px solid rgba(255, 255, 255, 0.06)` or `#282b3a`.
3. **Container Tier 2 (`#1e202b`)**: Popovers, tooltips, flyout action sheets, and hovered card states. Uses `1px solid rgba(255, 255, 255, 0.12)`.
4. **Ambient Depth**: For floating elements (modals, active dropdowns), employ a crisp, tinted glow shadow: `0 12px 32px -4px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.08)`.
5. **Graphic Depth**: Corner accents (parametric wave lines, dot matrices, diagonal hatching) are rendered directly inside the card background with 12% to 25% opacity or in high-contrast saturated vector strokes clipped cleanly by card corner radiuses.

## Shapes

The design system embraces a **Rounded (Level 2)** shape language, balancing precision engineered edges with comfortable software ergonomics:

- **Containers & Metric Cards**: `0.75rem` (`12px`) to `1rem` (`16px`) radius, creating cohesive rounded rectangles that house both square corner app icons and organic corner illustrations.
- **App/Service Badges**: `0.75rem` (`12px`) rounded squares hosting service icons.
- **Buttons & Action Pills**: `0.5rem` (`8px`) for standard controls; fully pill-shaped (`9999px`) exclusively for status chips, numeric deltas (`+38%`), and rating capsules.
- **Input Fields & Search**: `0.5rem` (`8px`) for clean alignment with adjacent action items.

## Components

### 1. Developer Metric & Feature Cards
- **Structure**: Surface `#161820`, `1px solid #282b3a`, `rounded-xl`.
- **Upper Header**: Service app icon (40x40px rounded square in saturated violet, electric blue, amber, or coral) on the top left; mono timestamp (`label-sm` in `#64748b`) on the top right.
- **Body**: Micro category label (`label-sm` in `#94a3b8`) stacked above a bold title (`headline-sm` or `headline-md` in `#f8fafc`).
- **Footer/Region**: Secondary contextual meta (e.g., location, branch, deployment ID) seated at the bottom left.
- **Graphic Accent**: Bottom-right quadrant reserved for flat graphic motifs (topographical contours, chevron arrays, dense dot arrays, or gestural dashes) styled in the card's accent hue.

### 2. Buttons
- **Primary**: Solid accent color (`#8b5cf6` or `#3b82f6`) with `#ffffff` text, bold `0.5rem` radius, subtle inner highlight `inset 0 1px 0 rgba(255, 255, 255, 0.2)`.
- **Secondary / Slate**: Surface `#1e202b`, border `1px solid #35394d`, text `#f8fafc`. On hover, background shifts to `#282b3a`.
- **Ghost / Subtle**: Transparent background, text `#94a3b8`, hover background `rgba(255, 255, 255, 0.05)` and text `#f8fafc`.

### 3. Status Badges & Category Chips
- **Trend Pills**: Pill-shaped capsules (`rounded-full`), featuring a low-opacity background tint (`rgba(16, 185, 129, 0.12)`) and saturated foreground text (`#10b981`) paired with directional arrows (`↑ 38%`).
- **Category Tags**: JetBrains Mono uppercase labels with a 6px circular neon dot indicator marking component state (live, building, degraded, queued).

### 4. Input Fields & Selects
- **Base**: Surface `#0f1015`, border `1px solid #282b3a`, padding `0.625rem 0.875rem`, text `#f8fafc`, placeholder `#64748b`.
- **Focus State**: Border color snaps to `#8b5cf6` with a soft halo: `box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.2)`.

### 5. Checkboxes & Radio Controls
- **Unchecked**: Crisp `1px solid #35394d` border against `#161820` surface.
- **Checked**: Filled with `#8b5cf6` featuring a sharp white checkmark or center pip.

### 6. Code Snippets & Terminal Blocks
- **Container**: Slate-tinted `#0a0b0e` inset block with `1px solid #1e202b`. Monospace font (`jetbrainsMono`) syntax-highlighted using the neon accent palette (violet, electric blue, soft mint, warm amber).