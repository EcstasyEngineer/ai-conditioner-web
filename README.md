# AI Conditioner Web

Web application for browsing, organizing, and playing hypnosis content. Provides the taxonomy/ontology layer and web-based session player.

## Architecture

This repo focuses on **organization and playback**, not generation:

| Repo | Purpose |
|------|---------|
| **autotranceweb** (this) | Theme taxonomy, ontologies, web UI, session playback |
| **[hypnocli](https://github.com/EcstasyEngineer/hypnocli)** | Content generation (mantras, scripts, TTS rendering) |
| **[conditioner](https://github.com/EcstasyEngineer/conditioner)** | Discord bot that consumes content |

## Key Components

### Ontologies (`ontologies/`)
115+ theme definitions with metadata:
- Theme descriptions and keywords
- Psychological appeal classifications
- CNC (consensual non-consent) flags
- Related themes and intensity levels

### Session Engine (`lib/session-engine/`)
TidalCycles-inspired pattern system for session composition:
- **Cyclers** - Content ordering strategies (adaptive, weave, cluster)
- **Players** - Spatial audio positioning (tri-chamber, rotational)
- **Pattern Compiler** - Compositional session building

### Template System (`lib/mantras/`)
Variable substitution for flexible content rendering:
- `{subject_subjective}` / `{subject_possessive}` / `{subject_objective}`
- `{dominant_name}` / `{dominant_possessive}`
- Verb conjugation patterns `[verb_1st|verb_3rd]`

## Stack

- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **Database**: Prisma ORM (PostgreSQL/SQLite)
- **Auth**: NextAuth.js

## Getting Started

```bash
npm install
npm run dev
```

### Environment

Create `.env.local`:
```env
DATABASE_URL="file:./dev.db"
NEXTAUTH_SECRET="your-secret"

# AWS Polly (if rendering audio locally)
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
AWS_REGION=us-east-1
```

### Prisma

```bash
npx prisma generate    # Regenerate client after schema changes
npx prisma db push     # Push schema to dev DB
npx prisma studio      # Browse data
```

## Content Workflow

1. **Generate content** using hypnocli:
   ```bash
   # In hypnocli repo
   python script/generate_mantras.py --theme obedience --count 20 --format conditioner
   python tts/render_polly.py script.txt output.mp3
   ```

2. **Organize** using autotranceweb ontologies for theme metadata

3. **Play** through the web session player or export for conditioner bot

## License

MIT. See `LICENSE`.
