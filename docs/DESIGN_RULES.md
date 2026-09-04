# Obsidian Slate — Design Rules

**This document is the single source of truth for the FreeLLM Gateway UI.**
Every new feature, page, or component MUST follow these rules so the UI stays
cohesive as the product grows. The machine-readable token definitions live in
`src/index.css` (`@theme` block) — that file and this doc must stay in sync.

Reference prototypes: `Design/*/code.html` (Stitch exports).

---

## 1. Core Principles

1. **Dark, calm, precise.** Deep obsidian surfaces, hairline borders, one
   saturated violet accent. Never introduce bright backgrounds.
2. **Cards are the unit of composition.** Anything that groups information
   (provider, pool, metric, integration, log) is a card. Not tables, not bare
   lists — cards with icon badges and status pills.
3. **Monospace is for data.** IDs, endpoints, latencies, counts, timestamps,
   versions — always `font-mono` (`JetBrains Mono`). Human labels and body copy
   use `Plus Jakarta Sans`.
4. **Depth through elevation ladders, not shadows.** Use the surface ladder
   (§2). Shadows are reserved for the primary button inner highlight and
   floating glow accents on the active nav item.
5. **No hardcoded hex values in components.** Use theme tokens
   (`bg-surface-low`, `text-on-surface-variant`, `text-mint`, …) or the
   recipes in §7. If a color is missing, add it to `@theme` first.

## 2. Color Tokens (Tailwind classes)

| Token | Hex | Class usage | Used for |
|---|---|---|---|
| `background` | `#0d0e13` | `bg-background` | App background, sidebar |
| `surface` | `#121318` | `bg-surface` | Secondary panels |
| `surface-dim` | `#0a0b0f` | `bg-surface-dim` | Inset code/terminal blocks |
| `surface-low` | `#16171e` | `bg-surface-low` | **Cards** |
| `surface-container` | `#1c1d25` | `bg-surface-container` | Buttons, chips, inputs, icon badges |
| `surface-high` | `#23242f` | `bg-surface-high` | Hover state of controls |
| `surface-highest` | `#2e2f3c` | `bg-surface-highest` | Strongest raised state |
| `primary` | `#8b5cf6` | `bg-primary` / `text-primary` | Primary actions, active nav |
| `primary-hover` | `#7c3aed` | — | Primary button hover |
| `primary-soft` | `#a78bfa` | `text-primary-soft` | Violet text on dark surfaces |
| `azure` | `#3b82f6` | `text-azure` | Blue accents (info icons) |
| `sky` | `#38bdf8` | `text-sky` | Latency figures, info chips |
| `mint` | `#10b981` | `text-mint` | Online / success / healthy |
| `amber` | `#fbbf24` | `text-amber` | Warnings, queue, degraded |
| `coral` | `#fb7185` | `text-coral` | Errors, failover, delete hover |
| `on-surface` | `#f8fafc` | `text-on-surface` | Primary text |
| `on-surface-variant` | `#94a3b8` | `text-on-surface-variant` | Secondary text |
| `muted` | `#958ea0` | `text-muted` | Tertiary / mono labels |
| `outline` | `#475569` | `border-outline` | Strong border (rare) |

**Borders:** hairline `border-white/[0.07]` for resting, `border-white/[0.12]`
on hover. Focus ring: `border-primary` + `shadow-[0_0_0_3px_rgba(139,92,246,0.2)]`.

**Status color semantics (fixed):**
- Healthy / online / enabled / success → `mint` (+ `bg-mint/10` tint, `border-mint/25`)
- Info / latency / cache → `sky`
- Warning / queued / degraded → `amber`
- Error / offline / failover → `coral`
- Neutral / disabled → `on-surface-variant` / `muted`

## 3. Typography

| Style | Font | Size / weight | Tailwind |
|---|---|---|---|
| Page title | Jakarta | `text-2xl font-bold tracking-tight` | + `font-headline` |
| Card title | Jakarta | `text-base font-bold tracking-tight` | |
| Section label | **Mono** | `.label-mono` (11px, uppercase, 600) | |
| Body / description | Jakarta | `text-sm text-on-surface-variant` | |
| Metric value | Jakarta | `text-3xl font-extrabold tracking-tight` | |
| Code / ID / endpoint | **Mono** | `text-[11px]`–`text-xs font-mono` | in `bg-surface-dim` chips |
| Nav item | Jakarta | `text-xs font-medium` | |

## 4. Layout

- **Shell:** fixed left sidebar `w-[260px]` (`shrink-0`, `bg-background`,
  `border-r border-white/[0.07]`), main content scrolls independently.
- **Content gutter:** `p-6 lg:p-8`, content stacks `space-y-6`.
- **Card grids:** `grid gap-4 sm:grid-cols-2 xl:grid-cols-3` for uniform cards
  (metric cards, directory entries); single-column stack for large
  "workstation" cards (providers, pools).
- **Page header pattern:** mono category chip (`SECTION • live hint`),
  `text-2xl font-bold` title, one-line `text-sm text-on-surface-variant`
  description, then a right-aligned control cluster on the same row
  (`flex flex-col xl:flex-row justify-between gap-4`).


## 5. Card Anatomy (the signature element)

Every card follows this skeleton (see provider/pool/metric cards in prototypes):

```
┌────────────────────────────────────────────────────────┐
│ [icon badge]  TITLE  (status pill)          mono meta  │  ← header row
│               sub-label / endpoint code chip            │
│ ──────────────────────────────────────────────────────  │
│   body: stats (mono), controls, lists                   │
│                                     [graphic accent ◦◦] │
└────────────────────────────────────────────────────────┘
```

- **Base:** `card` class (=`bg-surface-low`, hairline border, `rounded-2xl`).
- **Icon badge:** `w-10 h-10 rounded-xl bg-surface-container border
  border-white/[0.08]` containing a Material Symbol. Choose ONE accent hue per
  card (violet / blue / mint / amber) and reuse it for the pill + graphic.
- **Status pill:** `rounded-full px-2.5 py-0.5 text-[10px] font-mono` with
  10–12% tinted bg + 25% border + colored text + optional pulse dot.
- **Graphic accent (metric cards):** decorative contour SVG in the
  bottom-right corner, `opacity-10 pointer-events-none`, clipped by
  `overflow-hidden` on the card. Purely decorative — never carries data.
- **Footer / controls:** bottom row with mono stats left, actions
  (`btn-secondary`, toggles) right, separated by `border-t border-white/[0.06]`.

## 6. Components

- **Buttons**
  - Primary: `.btn-primary` + `text-xs px-3 py-1.5` (one per view max).
  - Secondary: `.btn-secondary` + `text-xs px-3 py-1.5` (default action).
  - Ghost/icon: `.btn-ghost` + `p-1.5` + Material Symbol.
  - Destructive: `.btn-secondary` with `hover:bg-coral/15 hover:text-coral hover:border-coral/40`.
- **Toggles:** peer checkbox pattern, `w-9 h-5` track `bg-surface-high`,
  `peer-checked:bg-primary`, white knob (see prototypes). Sizes scale with
  context (`w-8 h-4` in card headers).
- **Inputs / selects:** `.input`. Labels are `.label-mono` above the field.
- **Chips (code/endpoint):** `font-mono text-[11px] px-2 py-0.5 rounded-md
  bg-surface-dim border border-white/[0.06] text-primary-soft`.
- **Icon library:** Material Symbols Outlined ONLY (`.material-symbols-outlined`,
  ligature names, `text-[18px]`/`text-[20px]`). Never mix emoji or other sets.
- **Empty state:** card with centered `text-muted` Material Symbol, title,
  one-line hint, and the action that fills it.

## 7. Shared Recipes (defined in `src/index.css`)

`.card` · `.label-mono` · `.btn-primary` · `.btn-secondary` · `.btn-ghost` · `.input`
— always prefer these over re-deriving styles; add utilities in markup for
spacing/layout only.

## 8. Do / Don't

**Do**
- Map every data group to a card with an icon badge + status pill.
- Use mono for machine data, Jakarta for human text.
- Bind pills/chips to real state (enabled, healthy, cached…), never fake data.
- Keep one accent hue per card; violet is reserved for primary actions and
  the active nav item.

**Don't**
- Don't hardcode hex values or invent new grays — extend `@theme`.
- Don't use bright/white large surfaces or heavy drop shadows.
- Don't use full-radius pills except status chips and numeric deltas.
- Don't put business logic in view handlers; UI is a consumer of `utils/api.ts`.
- Don't add new icon fonts or emoji icons.

## 9. Navigation (Sidebar)

Order & icons (fixed): Directory `explore` · Gateway & Providers `cell_tower` ·
Routing Pools `alt_route` · Playground `terminal` · Tool Connectors `extension` ·
Usage & Telemetry `monitoring` · Alerts & Failover `crisis_alert`.

- Idle: `text-on-surface-variant hover:text-white hover:bg-surface-low`.
- Active: `text-white bg-surface-container border border-primary/35` with
  icon `text-primary-soft` and a `w-1.5 h-1.5 bg-primary` glow dot.
- Sidebar footer: live status chip (mint pulse dot when online) + gateway
  endpoint code chip.
