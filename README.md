# hypnoapp

A hypnotic mantra session you sit in front of for twenty minutes.

Three lanes of text — a dominant center and two dimmer, offset sides — render a
seeded, fully-planned session over a shader backdrop and an isochronic audio bed.
No backend, no database, no accounts. A session never leaves the browser.

## Architecture

Two layers, one package:

| Layer | What it is | Rules |
|---|---|---|
| `engine/` | The whole artifact: consent filters, session planning, the pacing arc, the render model | **Pure.** No DOM, no `window`, no `fetch`, no `Date.now()`, no `Math.random()`, no Node builtins, zero third-party imports. Time enters as a parameter; randomness as a seeded RNG. |
| `web/` | Vite + React shell, plus raw DOM/rAF rendering for the three lanes | React owns the setup screen. It never sits between the session clock and the pixels. |
| `tools/` | Node-only corpus ingest and reporting | Firewalled behind `tsconfig.tools.json`; never reachable from the browser bundle. |

The engine produces a fully-materialized `SessionPlan` before a single pixel is
drawn, and the renderer is a function of `(plan, elapsedMs) → FrameState`. A
session is reproducible from `(config, seed)`, which is what makes scheduling
bugs unit-testable instead of something you watch a spiral for eight minutes to
reproduce.

Both engine rules are enforced by local ESLint rules in `eslint-rules/`, not by
convention.

## Getting started

```bash
npm install
npm run dev          # dev server
npm run build        # typecheck + production build to dist/
npm run preview      # serve the production build
```

## Verification

```bash
npm run lint         # includes the two engine-purity rules
npm run typecheck    # browser tree and Node toolchain, separately
npm test             # vitest, single run
```

CI runs all four plus the build, and **every step is blocking** — there is no
`continue-on-error` in the workflow and a test asserts none is ever added.

## Corpus

Mantras live in `corpus/pool.json` as first-class records tagged with themes,
with a person-variant sidecar in `corpus/persons.json` and per-record provenance
in `corpus/provenance.json`.

```bash
npm run corpus:lint      # schema, content and coverage report
npm run corpus:report     # per-tag coverage against the 54-record floor
npm run corpus:ingest     # re-ingest raw batches (idempotent)
```

Ingest is idempotent by design: re-ingesting the same raw files produces a
byte-identical pool, so corpus growth is reviewable as a diff.

## Documentation

- `docs/v1/DESIGN.md` — the architecture, and the authority when anything disagrees
- `docs/v1/MODULES.json` — module boundaries, interfaces and acceptance criteria
- `docs/v1/CORPUS_SPEC.md` — the record contract and the conjugation gate
- `docs/v1/DECISIONS.md` — owner overrides
- `docs/v1/DEPLOYMENT.md` — base path, router mode, SPA fallback

## License

MIT. See `LICENSE`.
