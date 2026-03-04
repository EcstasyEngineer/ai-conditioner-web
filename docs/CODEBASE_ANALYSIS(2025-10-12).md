# Codebase Analysis — 2025-10-12

## Project Snapshot
- Modern Next.js 15 app with TypeScript, NextAuth, and Prisma; UI shells live in `app/` for marketing (`page.tsx`), dashboard, session builder, and player views.
- Domain content lives outside the database: ontologies (`ontologies/*.json`) and mantra corpora (`hypnosis/mantras/**`) remain file-based.
- Backend surface is thin: credential auth, `/api/themes` ingest/listing, and `/api/tts/generate` mock out future services.
- Prisma schema models a fully normalized content system with rendered mantra caching, session phases, and telemetry (`prisma/schema.prisma`), but no migrations or seed scripts exist yet.

## Strengths
- Comprehensive domain documentation (`docs/*.md`) and data assets provide a clear blueprint for future features.
- Front-end scaffolding already sketches out the intended UX for browsing themes, composing sessions, and playing content (`app/dashboard/page.tsx`, `app/session/builder/page.tsx`, `app/session/player/[id]/page.tsx`).
- Mantra templating and AWS Polly utilities are in place (`lib/tts/aws-polly.ts`, `lib/mantras/*`), ready to power richer generation once the data layer stabilizes.

## Critical Gaps
- **Theme ingestion breaks against the current Prisma schema.** The loader writes `tags` and raw mantra `text`, but the schema requires `categories`, `appeal`, `relatedThemes`, and `template` fields; it also imports a non-existent `lib/prisma`. This means `/api/themes` cannot seed or read data successfully (`app/api/themes/route.ts:2`, `lib/themes.ts:3`, `lib/themes.ts:49-140`, `prisma/schema.prisma:73-114`, `app/dashboard/page.tsx:9-20`).
- **Authentication flow cannot succeed.** Registration never persists a password, yet login insists on a bcrypt hash and the UI advertises a dummy password, so every credential attempt fails (`app/api/auth/register/route.ts:27-35`, `lib/auth.ts:23-33`, `components/auth/login-form.tsx:98-101`).
- **Session builder/player are prototypes with no persistence or data binding.** Saving only logs to the console, and the player loops hard-coded phases/mantras, so the end-to-end experience is entirely mocked (`app/session/builder/page.tsx:102-123`, `app/session/player/[id]/page.tsx:19-53`).
- **Rendering plumbing needs stabilization before shipping visuals.** The `SpiralViewer` effect reinitializes WebGL every render because `currentTime` sits in the dependency list, which will thrash performance once exposed (`components/ui/spiral-viewer.tsx:26-209`).

## Recommended Next Steps
1. **Realign Prisma usage with the actual schema.** Create a shared `lib/prisma` (or point imports at `lib/db`), update `ThemeLoader` to populate `appeal`, `categories`, `relatedThemes`, and template-based mantras, and adjust `/api/themes` plus dashboard typing to the normalized structure.
2. **Fix authentication end-to-end.** Hash passwords during registration, persist them, tone down the demo messaging, and add minimal validation/error handling so onboarding works in practice.
3. **Introduce session persistence APIs.** Define Prisma models/services for authoring sessions, expose CRUD routes, and update the builder/player to consume live data instead of mocks.
4. **Productize content ingestion.** Convert the JSON mantra archives into templates (see `scripts/full-content-migration.ts`), seed Prisma via a repeatable script, and document the workflow so new content can be added safely.
5. **Harden front-end scaffolding.** Remove or guard navigation to unfinished routes (`components/layout/header.tsx:17-27`), trim `.next/` from the workspace, and resolve the WebGL effect lifecycle so the experience stays responsive.
6. **Establish local environment and migrations.** Stand up `.env.local` defaults for Prisma/NextAuth, generate an initial migration, and wire a seed command that ensures new developers can boot the stack quickly.

## Supporting Notes
- `/api/tts/generate` currently returns template variants without touching AWS; wiring storage and signed URLs can follow once the core content flow is stable (`app/api/tts/generate/route.ts:1-83`).
- Legacy Python and research assets remain in `legacy/` and `research/`; keep them quarantined to avoid confusing the TypeScript runtime until the new pipeline is live.
