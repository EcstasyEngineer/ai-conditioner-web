# Hypnoapp

A stateless Vite + React SPA for generating and playing hypnotic mantra sessions. Designed for GitHub Pages deployment with no backend dependencies.

## Stack
- **Framework**: Vite + React 19 + TypeScript
- **Styling**: Tailwind CSS 4
- **Routing**: React Router DOM
- **Audio**: Web Audio API (isochronic drone generator)
- **State**: React useState (no state management library needed for current scope)

## Getting Started
```bash
npm install              # install deps
npm run dev              # dev server at localhost:5173
npm run build            # production build to dist/
npm run preview          # preview production build
```

## Project Structure

```
src/
├── main.tsx                 # Entry point, providers
├── App.tsx                  # React Router setup
├── routes/
│   ├── Builder.tsx          # Session configuration form
│   └── Player.tsx           # Playback UI with spiral + drone
├── components/
│   ├── ThemeContext.tsx     # Visual theme provider
│   ├── ThemeSwitcher.tsx    # Theme selector dots
│   └── Spiral.tsx           # Animated spiral canvas
└── lib/
    └── themes.ts            # Theme definitions (clinical, bimbo, void, evil)

lib/
├── drone.ts                 # Web Audio isochronic drone (port of hypnocli binaural.py)
├── theme-loader.ts          # Load mantra themes from JSON
├── url-params.ts            # Shareable URL encoding/decoding
├── pattern-compiler/        # TidalCycles-inspired pattern language (future use)
├── session-engine/          # Cyclers and players (future use)
├── mantras/
│   └── template-renderer.ts # Variable substitution ({subject}, {controller})
└── tts/
    └── verb-conjugations.ts # Verb form data

public/data/mantras/         # Theme JSON files (from conditioner repo)
docs/                        # Architecture and design docs
ontologies/                  # Theme metadata (legacy, may be removed)
```

## Current Features

### Session Builder (`/`)
- Select mantra theme (obedience, submission, etc.)
- Enter pet name (substitutes `{subject}`)
- Enter dominant name (substitutes `{controller}`)
- Set duration (5-60 minutes)
- Generate shareable URL

### Session Player (`/play?theme=...&pet=...&dom=...&dur=...`)
- Displays rendered mantras with variable substitution
- Auto-advances every 4 seconds when playing
- Isochronic drone audio (4-tone, L/R ping-pong at 180°)
- Animated spiral background (fades in when playing)
- Play/pause, skip prev/next controls
- Copy shareable link

### Visual Themes
Four color schemes, persisted to localStorage:
- **Clinical** (default): Teal & gray
- **Bimbo**: Pink & magenta
- **Void**: Purple & black
- **Evil**: Red & black

## Audio System

The drone is a Web Audio API port of `hypnocli/audio/binaural.py --preset drone`:
- High band: 310 Hz (L) / 314 Hz (R) pulsing at 5 Hz
- Low band: 58 Hz (L) / 62 Hz (R) pulsing at 3.25 Hz, -6 dB
- True 180° phase offset between L/R channels
- 1.75s fade in/out

## Content

Mantras are loaded from `public/data/mantras/*.json`, sourced from the `conditioner` repo. Each theme has:
- `theme`: Theme name
- `description`: What the theme does
- `mantras`: Array of `{text, base_points}`

Template variables:
- `{subject}` → pet name
- `{controller}` → dominant name

## Future / Out of Scope

These exist in `lib/` but aren't wired up yet:
- **Pattern compiler**: TidalCycles-inspired session composition
- **Session engine**: Cyclers (adaptive, weave, cluster) and players (rotational, tri-chamber)
- **Full template system**: Gender/POV pronouns, verb conjugation

Not planned for MVP:
- User accounts / auth
- Server-side persistence
- TTS voice generation (would need external audio hosting)
- Adaptive/dynamic content based on telemetry

## Development Notes

- Mantras use simplified placeholders (`{subject}`, `{controller}`) - full gender/POV support requires enhancing the mantra JSON files
- No database - all state is URL params + localStorage
- Designed for static hosting (GitHub Pages, Netlify, etc.)

## Related Repos
- `conditioner` - CLI tools, mantra content source
- `hypnocli` - Audio generation (binaural.py)
