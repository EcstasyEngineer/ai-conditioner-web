# Dead Code Analysis - hypno-pwa

**Analysis Date:** 2026-01-03
**Analyzed By:** Claude Code
**Goal:** Identify unused code, orphaned files, and prepare for PWA/optional-auth refactor

---

## Table of Contents
1. [Executive Summary](#executive-summary)
2. [Unused Dependencies](#unused-dependencies)
3. [Dead/Unused Library Code](#deadunused-library-code)
4. [Orphaned Routes](#orphaned-routes)
5. [One-off/Migration Scripts](#one-offmigration-scripts)
6. [Legacy Code](#legacy-code)
7. [Stub/Incomplete Code](#stubincomplete-code)
8. [Duplicate/Redundant Code](#duplicateredundant-code)
9. [Auth-Related Code for Optional Auth Refactor](#auth-related-code-for-optional-auth-refactor)
10. [Recommendations](#recommendations)

---

## Executive Summary

The hypno-pwa codebase is relatively clean for a greenfield project, but contains several categories of dead or potentially removable code:

- **6 unused npm dependencies** (never imported in source code)
- **2 migration scripts** that have likely completed their purpose
- **1 entire legacy directory** with old Python implementation
- **Several session engine files** that are defined but never instantiated
- **Significant auth coupling** that will need refactoring for optional login

---

## Unused Dependencies

The following packages are listed in `package.json` but are **never imported** in any source file:

### Completely Unused (Safe to Remove)

| Package | Type | Notes |
|---------|------|-------|
| `@hookform/resolvers` | dependency | Never imported - only in docs |
| `react-hook-form` | dependency | Never imported - only in docs |
| `@tanstack/react-query` | dependency | Never imported - only in docs |
| `zustand` | dependency | Never imported anywhere |
| `axios` | dependency | Never imported - all fetches use native `fetch` |
| `socket.io` | dependency | Never imported (server-side) |
| `socket.io-client` | dependency | Never imported (client-side) |
| `zod` | dependency | Never imported - validation not implemented |
| `tailwind-merge` | dependency | Never imported |

### Potentially Unused

| Package | Status | Notes |
|---------|--------|-------|
| `@types/bcryptjs` | devDependency | Listed in both deps and devDeps - remove from one |

### Still Used

All remaining dependencies are actively used:
- `next`, `react`, `react-dom` - Core framework
- `next-auth`, `@auth/prisma-adapter` - Authentication
- `@prisma/client`, `prisma` - Database
- `bcryptjs` - Password hashing
- `aws-sdk` - TTS integration
- `clsx` - Classname utilities
- `lucide-react` - Icons

---

## Dead/Unused Library Code

### Session Engine (`lib/session-engine/`)

The session engine has extensive infrastructure that is **never actually instantiated** in the application:

| File | Status | Issue |
|------|--------|-------|
| `/lib/session-engine/cyclers/adaptive.ts` | UNUSED | Class defined but never instantiated |
| `/lib/session-engine/cyclers/cluster.ts` | UNUSED | Class defined but never instantiated |
| `/lib/session-engine/cyclers/weave.ts` | UNUSED | Class defined but never instantiated |
| `/lib/session-engine/cyclers/base.ts` | UNUSED | Abstract base, no implementations used |
| `/lib/session-engine/players/direct.ts` | UNUSED | Class defined but never instantiated |
| `/lib/session-engine/players/rotational.ts` | UNUSED | Class defined but never instantiated |
| `/lib/session-engine/players/tri-chamber.ts` | UNUSED | Class defined but never instantiated |
| `/lib/session-engine/players/base.ts` | UNUSED | Abstract base, no implementations used |
| `/lib/session-engine/director.ts` | UNUSED | `HypnoDirector` class never instantiated |
| `/lib/session-engine/session-parser.ts` | UNUSED | `SessionParser` class never instantiated |
| `/lib/session-engine/types.ts` | PARTIALLY USED | Types defined but most are unused |

**Current Usage:** The session builder/player pages store cycler/player names as strings in the database but never actually instantiate these classes. The player page (`/app/session/player/[id]/page.tsx`) has its own simple timer logic instead.

### Mantras Library (`lib/mantras/`)

| File | Status | Issue |
|------|--------|-------|
| `/lib/mantras/template-renderer.ts` | UNUSED | `TemplateRenderer` class never instantiated |
| `/lib/mantras/generation-logic.ts` | UNUSED | All functions never called |

**Note:** The mantra editor page uses `TemplateProcessor` from `/lib/tts/aws-polly.ts` instead, which duplicates some functionality.

### TTS Library (`lib/tts/`)

| File | Status | Issue |
|------|--------|-------|
| `/lib/tts/aws-polly.ts` | PARTIALLY USED | `AWSPollyTTS` class never instantiated; only `TemplateProcessor` and `TEMPLATE_VARIABLES` used |
| `/lib/tts/verb-conjugations.ts` | UNUSED | Imported by `template-renderer.ts` which is unused |

---

## Orphaned Routes

### Potentially Orphaned (No Navigation Links)

| Route | File | Linked From |
|-------|------|-------------|
| `/admin/mantra-editor` | `app/admin/mantra-editor/page.tsx` | **NOWHERE** - No links in navigation |
| `/profile` | `app/profile/page.tsx` | User dropdown only (not discoverable) |

### Well-Connected Routes

| Route | Linked From |
|-------|-------------|
| `/` | Always accessible |
| `/auth/signin` | Home page, signup form, header |
| `/auth/signup` | Home page, signin form |
| `/dashboard` | Header, user dropdown |
| `/session/builder` | Dashboard, header |
| `/session/player/[id]` | Dashboard session cards |

---

## One-off/Migration Scripts

### Scripts Directory (`scripts/`)

| File | Purpose | Status |
|------|---------|--------|
| `/scripts/migrate-mantras-to-templates.ts` | Convert old mantra format to templates | LIKELY COMPLETED |
| `/scripts/full-content-migration.ts` | Migrate ontologies and mantras to DB | LIKELY COMPLETED |

Both scripts appear to be one-time migration utilities. They have:
- No recent modifications
- Output paths that don't exist (`content/mantras/`, `prisma/migrations/*.sql`)
- Manual execution instructions in comments

**Recommendation:** Keep for documentation purposes or move to a `/scripts/archive/` folder.

---

## Legacy Code

### Legacy Directory (`legacy/`)

The entire `/legacy/python-implementation/` directory contains an old Python version of the application:

```
legacy/python-implementation/
├── database/
├── src/
├── templates/
└── utils/
```

**Status:** Completely unused by the Next.js application.

**Recommendation:** Archive or remove. If keeping for reference, add to `.gitignore` and compress.

---

## Stub/Incomplete Code

### Incomplete Implementations

| Location | Issue |
|----------|-------|
| `/lib/session-engine/director.ts:32-38` | `selectNextItem` has TODO comment: "Implement semantic embedding-based selection" |
| `/lib/session-engine/director.ts:95-98` | `getSessionProgress()` returns hardcoded `0.5` placeholder |
| `/lib/session-engine/director.ts:100-125` | `loadSemanticVectors()` and `calculateSimilarity()` marked as "Future" |
| `/lib/tts/aws-polly.ts:80-84` | Comment: "In a real implementation, you'd save this to a CDN or file system" |
| `/app/api/tts/generate/route.ts:73-77` | Comment: "In a real implementation, this would: 1. Generate audio... 4. Return actual audio URLs" |
| `/app/session/player/[id]/page.tsx` | Volume slider exists but doesn't control any audio |
| `/app/dashboard/page.tsx:289` | "Hours Listened" hardcoded to `0` |

### Missing Features

- No actual TTS audio generation - only metadata/placeholders returned
- Session player displays mantras as text only, no audio playback
- Telemetry system in schema but no data collection implemented

---

## Duplicate/Redundant Code

### Template Processing (Duplicated)

Two separate template processing implementations exist:

1. **`/lib/mantras/template-renderer.ts`** - `TemplateRenderer` class
   - Uses Prisma enums (`POV`, `Gender`)
   - Has verb conjugation via `loadVerbConjugations()`
   - Never used

2. **`/lib/tts/aws-polly.ts`** - `TemplateProcessor` class
   - Uses simple string-based variables
   - Inline verb conjugation logic
   - Actually used by mantra-editor and TTS route

**Recommendation:** Consolidate into one solution. The `TemplateRenderer` is more complete but unused; `TemplateProcessor` is simpler and actually used.

### Verb Conjugations (Potentially Duplicated)

- `/lib/tts/verb-conjugations.ts` - Comprehensive list exported
- `/lib/tts/aws-polly.ts` - Has inline verb conjugation in `TemplateProcessor`
- `/lib/mantras/template-renderer.ts` - Has `processVerbConjugations()` method

### Theme Interface Definitions

The `Theme` interface is defined multiple times with slight variations:
- `/app/dashboard/page.tsx:9-21`
- `/app/session/builder/page.tsx:8-19`
- `/app/session/player/[id]/page.tsx:25-29`

---

## Auth-Related Code for Optional Auth Refactor

For the PWA vision with optional login, the following code will need refactoring:

### Hard Auth Dependencies

| File | Lines | Issue |
|------|-------|-------|
| `/app/page.tsx` | 5-10 | Redirects to dashboard if logged in |
| `/app/dashboard/page.tsx` | 46-52 | Redirects to signin if not logged in |
| `/app/profile/page.tsx` | 23-28 | Redirects to signin if not logged in |
| `/app/api/sessions/route.ts` | 22-25, 54-57 | Returns 401 if not logged in |
| `/app/api/profile/route.ts` | 8-11, 46-49 | Returns 401 if not logged in |

### Auth Infrastructure

| File | Purpose | PWA Impact |
|------|---------|------------|
| `/lib/auth.ts` | NextAuth configuration | Keep for optional auth |
| `/components/providers/auth-provider.tsx` | SessionProvider wrapper | Keep for optional auth |
| `/components/auth/user-nav.tsx` | User dropdown | Needs "guest mode" |
| `/components/auth/login-form.tsx` | Login form | Keep for optional |
| `/components/auth/signup-form.tsx` | Signup form | Keep for optional |
| `/components/layout/header.tsx` | Has auth navigation | Needs "guest mode" |
| `/app/api/auth/[...nextauth]/route.ts` | NextAuth API | Keep for optional |
| `/app/api/auth/register/route.ts` | Registration API | Keep for optional |

### Database Schema (Auth-tied)

The Prisma schema has several models tied to user authentication:
- `UserSession` requires `userId`
- `Telemetry` requires `userId`
- `User` is central to many relations

**PWA Considerations:**
- Sessions could be stored in localStorage for anonymous users
- Themes/mantras could be served from CDN without auth
- Optional sync to server when user logs in

---

## Recommendations

### Immediate Actions (Low Risk)

1. **Remove unused dependencies** from `package.json`:
   ```bash
   npm uninstall @hookform/resolvers react-hook-form @tanstack/react-query zustand axios socket.io socket.io-client zod tailwind-merge
   ```

2. **Remove duplicate devDependency**:
   - `@types/bcryptjs` appears in both `dependencies` and `devDependencies`

3. **Add link to mantra editor**:
   - Either add to navigation or remove if not needed
   - Currently at `/admin/mantra-editor` but unreachable

### Medium-Term Refactoring

4. **Consolidate template processing**:
   - Merge `TemplateRenderer` and `TemplateProcessor` into one module
   - Keep the Prisma-aware version for server-side
   - Create a lightweight client version for PWA

5. **Archive migration scripts**:
   - Move `scripts/migrate-mantras-to-templates.ts` and `scripts/full-content-migration.ts` to `scripts/archive/`

6. **Archive or remove legacy directory**:
   - The Python implementation is not used
   - Consider compressing and archiving for reference

### For PWA/Optional Auth Vision

7. **Create guest mode infrastructure**:
   - Implement localStorage-based session storage
   - Create anonymous user context
   - Add "save to account" flow for guests who sign up

8. **Refactor API routes**:
   - Add optional auth to session routes
   - Create CDN-servable static JSON for themes/mantras
   - Implement service worker for offline access

9. **Complete or remove session engine**:
   - The cyclers/players are sophisticated but unused
   - Either implement them in the player UI or document as future work
   - Consider simpler client-side alternatives for PWA

### Content/Assets Review

10. **Review public assets**:
    - `/public/images/yukari.png` is 4.5MB - consider optimizing
    - `/public/shaders/` - Used by SpiralViewer, keep

11. **Review content directories**:
    - `/ontologies/` - Used by ThemeLoader, keep
    - `/hypnosis/mantras/` - Used by ThemeLoader, keep
    - `/assets/` - Contains source versions of shaders/images

---

## Files Summary

### Safe to Remove

```
# Unused dependencies (run npm uninstall)
@hookform/resolvers
react-hook-form
@tanstack/react-query
zustand
axios
socket.io
socket.io-client
zod
tailwind-merge

# Legacy code
legacy/python-implementation/  (entire directory)
```

### Should Archive

```
scripts/migrate-mantras-to-templates.ts
scripts/full-content-migration.ts
```

### Dead Code (Keep for Future or Remove)

```
lib/session-engine/cyclers/adaptive.ts
lib/session-engine/cyclers/cluster.ts
lib/session-engine/cyclers/weave.ts
lib/session-engine/cyclers/base.ts
lib/session-engine/players/direct.ts
lib/session-engine/players/rotational.ts
lib/session-engine/players/tri-chamber.ts
lib/session-engine/players/base.ts
lib/session-engine/director.ts
lib/session-engine/session-parser.ts
lib/mantras/template-renderer.ts
lib/mantras/generation-logic.ts
lib/tts/verb-conjugations.ts (only used by unused code)
```

### Needs Refactoring

```
lib/tts/aws-polly.ts  (AWSPollyTTS class unused, TemplateProcessor used)
app/dashboard/page.tsx (auth guards)
app/profile/page.tsx (auth guards)
app/api/sessions/route.ts (auth guards)
app/api/profile/route.ts (auth guards)
```

---

*This analysis was generated automatically. Manual review recommended before making changes.*
