# Maç Gecesi Implementation Plan

> For agentic workers: execute the approved design with independent frontend, authentication and media tasks, then integrate and verify in the browser.

**Goal:** Apply the user-approved Maç Gecesi visual design to SkorIQ and deploy it to the existing Coolify application.

**Architecture:** Keep React 19, Vite, the current API contracts and protected routes. Extract account forms and the arena homepage from App.tsx, share a horizontal navigation layer, and use separately generated stadium artwork behind native interface elements.

**Tech stack:** React, TypeScript, CSS custom properties, Vitest, native video and a local HyperFrames composition.

**Spec:** The user-approved three desktop concepts: stadium home with a tactile prediction card; tunnel login with an ivory ticket form; matching registration ticket. Signature colors are near-black stadium green, warm ivory and #FFC400. Barlow Condensed supplies the display hierarchy; Archivo supplies controls and body text. The forms and navigation remain native HTML.

## Global constraints

- Preserve login, registration, password-recovery/reset payloads, validation and routing.
- Preserve role isolation and confidence/risk explanations. Never present public examples as current published predictions.
- Only show member previews paired with eligible fixtures inside the analysis window.
- Do not add fake live statuses, odds, player progress, rewards or success statistics.
- Restrict UI animation to opacity/transforms. Disable decorative video for reduced motion, narrow viewports and data-saving preferences.
- Do not store credentials in the repository or deployment assets.

## Work

- [x] Produce lightweight, independent stadium and tunnel WebP assets.
- [x] Render a genuine, silent six-second ambient light loop with HyperFrames.
- [x] Extract all account pages into focused modules with a responsive ticket layout.
- [x] Implement the hero, prediction details, match filters and real member data states.
- [x] Replace the sidebar with horizontal navigation and accessible mobile/account disclosures.
- [x] Update the legacy analysis surfaces with the same palette, readable type and telemetry contrast.
- [ ] Complete data-safety tests, account interactions and desktop/mobile visual comparison.
- [ ] Build, publish to the existing release branch, deploy through Coolify and verify live routes/assets.

## Verification

Run dashboard Vitest tests, dashboard production build, and frontend ESLint. In the browser inspect the homepage at the concept size, login/registration at 1586×990, and 390×844 mobile layouts. Exercise filtering, explanations, account navigation, invalid credentials, password visibility, password confirmation, arithmetic validation and password reset without a token. Validate successful account routing with local API responses without creating a production test account.

## Fidelity and deliberate adaptations

- The approved stadium/tunnel identity, ticket geometry, heading/CTA wording, card hierarchy, yellow accents and display/body font contrast are retained.
- Backgrounds are standalone image assets. Text, buttons, forms, team crests and statistical values are native code, not baked screenshots.
- Public previews carry explicit example labels and no fabricated kickoff time. Member previews use actual fixture data and a separate risk field.
- Public signup/login actions and mandatory report warnings remain visible as functional necessities.
- Data availability can change the featured fixture or replace it with an honest loading/error/empty state.
- Header/account/mobile controls replace screenshot-only chrome with working, keyboard-accessible controls.
