# Deployment decisions (M0)

Recorded before implementation so D5 — "deployed and reachable at a real URL,
**hard-refresh included**" — is a configuration that already exists rather than a
bug discovered at the end. The SPA-fallback gap is the classic way that criterion
fails: everything works while clicking, and a reload on any route 404s.

`tests/repo-hygiene.test.ts` asserts that the base path recorded here matches
`vite.config.ts`, so the two cannot drift.

## 1. Base path — `/`

hypnoapp deploys at the **root of its own origin**, not under a repository
subpath.

| Option | Verdict |
|---|---|
| **`/` (root)** | **CHOSEN.** Asset URLs, the router and the shader fetches in `public/shaders/` all resolve without a prefix. One fewer thing to be wrong. |
| `/hypnoapp/` (GitHub Pages project site) | Rejected. Forces `base` into every absolute asset reference and makes local dev diverge from production — the exact class of difference that only shows up after deploy. |

If a project-subpath host is ever chosen, `base` moves to `/hypnoapp/` in
`vite.config.ts` **and** this document changes with it. The test fails otherwise.

## 2. Router mode — no router

The app has **two screens**: Configure and Play. There is no route to deep-link
to, no shareable URL state in 1.0, and nothing to bookmark mid-session — a
session is 20 minutes of held attention, not a document.

State lives in one variable in `web/app.tsx` (M7). `react-router-dom` was removed
from `package.json` in M0 along with the rest of the pre-rewrite shell.

**Consequence for hard refresh: there is nothing to break.** Every URL the app
serves is `/`. The fallback below exists to make that guarantee explicit rather
than incidental, and to survive a later change of mind.

If deep-linking is ever wanted, the mode is **history / clean URLs** with the
fallback below — not hash routing. Hash URLs are ugly and leak config into a
place users copy and paste.

## 3. SPA fallback — required on every host

Any path that is not a real file must serve `index.html` with a **200**, not a
404, and `index.html` must not be cached.

- **Static host / CDN** — a rewrite of `/*` to `/index.html`.
  - Netlify: `_redirects` with `/*  /index.html  200`
  - Vercel: `rewrites: [{ source: "/(.*)", destination: "/index.html" }]`
  - Cloudflare Pages: SPA mode, on by default.
- **GitHub Pages** — has no rewrite engine. The workaround is a `404.html`
  byte-identical to `index.html`. The deploy workflow copies it.
- **nginx** — `try_files $uri $uri/ /index.html;`
- **Caddy** — `try_files {path} /index.html`

## 4. Caching

| Path | Policy | Why |
|---|---|---|
| `/index.html`, `/404.html` | `no-cache` | Must revalidate, or a stale shell keeps pointing at deleted hashed bundles. |
| `/assets/*` | `max-age=31536000, immutable` | Vite content-hashes these; the name changes when the bytes do. |
| `/shaders/*`, `/images/*` | `max-age=3600` | Unhashed and served from `public/`. An hour is short enough to fix a bad shader and long enough to matter. |

## 5. What is deliberately not deployed

No backend, no database, no analytics, no error reporting endpoint, no
environment variables. The app is a static bundle. A session never leaves the
browser — which is the privacy posture, not an implementation shortcut, and it is
why `.env.example` documents that there is nothing to configure.
