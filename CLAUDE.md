# CLAUDE.md

Guidance for working in this repository.

## What this is

hypnoapp renders a hypnotic mantra session as three lanes of text over a shader
backdrop and an isochronic audio bed. Static SPA, no backend, no accounts.

**`docs/v1/DESIGN.md` is the authority.** When anything here disagrees with it,
DESIGN.md wins. `docs/v1/MODULES.json` defines module boundaries, interfaces and
acceptance criteria; `docs/v1/DECISIONS.md` carries owner overrides that outrank
both.

## The rules that are not negotiable

### `engine/` imports nothing

No `web/`, no DOM types, no `window`, no `fetch`, no `Date.now()`, no
`Math.random()`, no Node builtins, no third-party packages. Time enters as an
explicit parameter. Randomness enters as a seeded RNG (mulberry32).

This is enforced by `eslint-rules/no-platform-imports-in-engine.cjs`, tested
against a deliberate violation fixture. If it fires, the fix is the code, not the
rule.

### The session clock is `requestAnimationFrame`

`setInterval` is forbidden in the session path, enforced by
`eslint-rules/no-set-interval-in-session-path.cjs`. Backgrounded tabs throttle
timers and dump a burst of queued lines the moment the user returns. `elapsedMs`
comes from `performance.now()` inside a rAF loop, and the session pauses on
`visibilitychange`.

A one-shot `setTimeout` for a fade beat is fine. A repeating tick is not.

### `tools/` never reaches the browser

The Node-only toolchain compiles under `tsconfig.tools.json` and is excluded from
the browser `tsconfig.json`. `tools/` may import `engine/`; the arrow never
points the other way. CI proves it by building and inspecting `dist/`.

### CI is blocking

No `continue-on-error`, ever. A green check that survives a failing step is worse
than no check, because it is trusted. `tests/repo-hygiene.test.ts` asserts the
absence.

## Layout

```
engine/     pure core — planning, pacing, render model. Zero platform imports.
web/        Vite + React shell; the three lanes are raw DOM writes from a rAF loop.
tools/      Node-only corpus ingest, firewalled from the bundle.
corpus/     pool.json + persons.json + provenance.json — the live corpus.
fixtures/   hand-authored specifications, not generated output.
docs/v1/    DESIGN.md, MODULES.json, CORPUS_SPEC.md, DECISIONS.md, DEPLOYMENT.md
eslint-rules/  the two local rules above, with their violation fixtures.
```

## Commands

```bash
npm run dev
npm run build        # typecheck + vite build
npm run lint
npm run typecheck    # browser tree and Node toolchain separately
npm test             # vitest, single run

npm run corpus:lint
npm run corpus:report
npm run corpus:ingest
```

## Data model

The pool is conditioner's schema, adopted byte-compatibly — five fields, nothing
added:

```jsonc
{
  "id": "resistance_melts_away_with_each_breath",  // opaque, stable, the only key
  "text": "Resistance melts away with each breath", // raw template, never rendered at rest
  "themes": ["acceptance"],
  "base_points": 20,                                // tier is DERIVED, never stored
  "markers": { "has_operator": false, "has_subject": false,
               "permanence": false, "identity": false, "pov": "impersonal" }
}
```

- **Ids are opaque.** Nothing reconstructs an id from text at read time — only
  138 of 612 round-trip through a naive slug.
- **Tier is derived** from `base_points`, never stored: 20–44 basic, 45–74 light,
  75–109 moderate, 110–149 deep, ≥150 extreme. One ordering, in `TIER_ORDER`.
- **`pov` is exactly** `first | second | named | impersonal`. There is no
  `mixed`.
- **Exactly two placeholders** reach runtime, bare form only: `{subject}` and
  `{operator}`. `{subject_subjective}` and `[verb|verbs]` are Phase B
  intermediates and never render.

## Conventions

- Conventional commits: `type(scope): subject`.
- No `Co-Authored-By` trailers and no AI/agent/session mentions in code,
  comments, or commit messages.
- Never rename an existing key when enhancing it — same purpose, same name.
- No `-v2` / `-new` filenames. Rewrite in place; git is the version history.
- Repo belongs to **EcstasyEngineer**. Verify `gh auth status` before any `gh`
  command.
