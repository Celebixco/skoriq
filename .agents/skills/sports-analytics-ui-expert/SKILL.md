---
name: sports-analytics-ui-expert
description: Advanced sports data analytics UI/UX engineering skill for modern React, TypeScript, and sports intelligence dashboards. Use when designing, building, styling, or refactoring sports analytics interfaces, match telemetry displays, live scoreboards, prediction cards, league tables, form visualizers, or high-performance responsive web dashboards.
---

# Sports Analytics UI/UX Expert Skill

Specialized engineering and design guide for constructing world-class sports analytics platforms, match centers, and predictive intelligence dashboards.

## Core Design Philosophy

Sports analytics applications demand a balance between **extreme information density** and **effortless visual hierarchy**. Users need to scan dozens of data points (form guides, odds, expected goals, head-to-head metrics, probability distributions) within seconds while experiencing a premium, exhilarating sports broadcast feel.

### 1. Visual Identity & Atmosphere

- **Stadium-Grade Dark Theme**: Base background `#07111f` to `#0a1627` (deep stadium night). Surfaces in semi-translucent dark glass (`rgba(15, 27, 45, 0.78)`) with subtle hairline borders (`rgba(148, 163, 184, 0.18)`).
- **High-Contrast Telemetry Accents**:
  - Primary Telemetry / Focus: Electric Cyan (`#38bdf8`) and Royal Blue (`#2563eb`).
  - Positive / Won / Form Win: Emerald Green (`#22c55e`, `rgba(34, 197, 94, 0.16)`).
  - Pending / Draw / Moderate Risk: Amber Gold (`#f59e0b`, `rgba(245, 158, 11, 0.16)`).
  - Risk / Loss / Conflict / High Risk: Crimson Coral (`#ef4444`, `rgba(239, 68, 68, 0.16)`).
- **Atmospheric Depth**: Subtle radial gradients resembling stadium spotlights or ambient glow beneath active match cards. Avoid flat opaque boxes.

### 2. Typography & Numeric Precision

- **Tabular Numerals**: Always apply `font-variant-numeric: tabular-nums` (or CSS class) on scores, percentages, minutes, and odds to prevent layout jitter when numbers update.
- **Font Pairing**:
  - Headers & Displays: Modern geometric sans with character (e.g., Plus Jakarta Sans, Outfit, Cabinet Grotesk).
  - Data / Metrics / Telemetry: High-readability monospace or technical sans (e.g., JetBrains Mono, Space Grotesk, IBM Plex Sans).
  - Body: Crisp neutral sans with high legibility at 12px-14px.
- **Micro-Badges**: Form ribbons (W-D-L or G-B-M) should have fixed aspect ratios, bold uppercase typography, and distinct rounded pill styling (`0.35rem` radius).

### 3. Key Sports Components & Patterns

#### A. Match Cards (List & Explorer View)
- Structure: Team crests, team names, kickoff countdown / live clock, telemetry badges (Coverage %, Confidence Score, Readiness Badge).
- Form Pill Ribbon: Last 5 matches (`W`, `D`, `L`) displayed with instant tooltip/popover context.
- Progress Meters: Split-bar metrics for home/away possession, dangerous attacks, or head-to-head dominance.

#### B. Match Detail Telemetry
- Header: Grand match fixture showcase with official team crests, competition logo, kickoff time with timezone awareness.
- Split Comparative Form Cards: Home vs Away form, average goals scored/conceded, home form vs away form specifically.
- Head-to-Head (H2H) Breakdown: Historical encounters with scorelines, dates, and aggregate goal trends.
- Risk & Positive Signal Badges: Categorized, icon-backed telemetry items explaining reasoning without technical jargon overload.

#### C. Standings & Competitions Grid
- Sticky table headers with compact row heights (`2.25rem` to `2.75rem`).
- Highlight zones: Champions League / Promotion (green border accent), Relegation (red border accent).
- Responsive overflow: Horizontal scroll wrapper with subtle fade gradients on scroll edges.

### 4. Motion & Micro-Interactions

- **Performant Animations**: Restrict all CSS animations to `transform` and `opacity`.
- **Card Hover Elevation**: `transform: translateY(-2px); box-shadow: 0 12px 30px rgba(2, 6, 23, 0.5);` with smooth transition (`cubic-bezier(0.16, 1, 0.3, 1)`).
- **Skeleton Shimmer**: Ambient pulse shimmer during data fetching that mimics the component's exact wireframe shape.
- **Prefers-Reduced-Motion**: Always respect user motion preferences via `@media (prefers-reduced-motion: reduce)`.

### 5. Architectural Standards in React 19 & TypeScript

- **Component Decomposition**: Keep individual component files under 300 lines. Break massive views into:
  - `MatchHeader.tsx`
  - `TeamFormCard.tsx`
  - `HeadToHeadCard.tsx`
  - `PredictionCandidateCard.tsx`
  - `SignalList.tsx`
- **Zero Layout Shift (CLS = 0)**: Always reserve explicit width/height for team crests and badges with fallback initials avatar.
- **State Management**: Clean local state or TanStack Query caching; clear separation between presentation and data fetching (`api.ts`).

### 6. SkorIQ Domain & Compliance Rules

- **Safety Disclaimers**: Never hide or remove required product disclaimers:
  - *"Bu bir maç analizi raporudur, nihai tahmin değildir."*
  - *"Güven skoru kazanma olasılığı değildir."*
  - *"Bu sonuç iç denetim amaçlıdır."*
- **Role-Based Guards**: Member-safe views must NEVER display admin internals, draft candidate conflict logs, provider IDs, or internal settlement raw payloads.
