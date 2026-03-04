# AI Conditioner Web App Development Plan

## Context from Discord Bot Work

I just finished normalizing the mantra system in the Discord bot, including:
- Fixed difficulty progression issues (emptiness theme had 0% accuracy in blind tests)
- Normalized point values across all themes
- Created comprehensive documentation for theme development
- Applied learnings from a blind difficulty test that achieved 62.7% accuracy

## Core Architecture Understanding

Based on the docs, this is a sophisticated hypnosis content generation system with:

### Key Components
1. **Themes**: JSON ontologies with tags (e.g., mindlessness overlaps with bimbo/vanity)
2. **Sessions**: Configured experiences with phases, timing, and adaptive content
3. **Cyclers**: Decide WHAT content to present and in what sequence
   - RandomCycler, ChainCycler, WeaveCycler, BridgeCycler, AdaptiveCycler
4. **Players**: Decide HOW content is presented (spatial, timing, layering)
   - DirectPlayer, StereoSplitPlayer, RotationalPlayer, LayeredPlayer
5. **State Tracking**: Arousal, Focus, Depth for adaptive content

### Session Structure
- **Phases**: Sequential segments (induction → deepeners → suggestions)
- **Items**: SEGMENT (script files), MANTRA (theme content), VISUAL (images)
- **Effects**: Audio modifications (reverb, echo, pitch shift)

## Development Plan

### Phase 1: Core Infrastructure

#### Database Setup (Prisma + PostgreSQL)
```bash
npm install @prisma/client prisma next-auth @auth/prisma-adapter bcryptjs @types/bcryptjs zustand @tanstack/react-query axios socket.io socket.io-client react-hook-form @hookform/resolvers zod lucide-react clsx tailwind-merge
```

#### Schema Design
Based on old SQLAlchemy models but modernized:

```prisma
model User {
  id            String   @id @default(cuid())
  email         String   @unique
  password      String
  role          Role     @default(SUBMISSIVE)
  
  // Preferences from Discord bot learnings
  subjectName   String?
  dominantName  String?
  dominantTitle String?  // Master/Mistress
  
  // Session data
  sessions      Session[]
  telemetry     Telemetry[]
  
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

model Theme {
  id          String   @id @default(cuid())
  name        String   @unique
  description String
  tags        String[] // Experience, Personality, Hypnosis, etc.
  keywords    String[]
  cnc         Boolean  @default(false)
  
  // Content
  mantras     Mantra[]
  
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model Mantra {
  id         String     @id @default(cuid())
  themeId    String
  theme      Theme      @relation(fields: [themeId], references: [id])
  
  text       String
  difficulty Difficulty
  points     Int
  
  createdAt  DateTime   @default(now())
  updatedAt  DateTime   @updatedAt
}

model Session {
  id          String      @id @default(cuid())
  userId      String
  user        User        @relation(fields: [userId], references: [id])
  
  name        String
  duration    Int?        // seconds
  phases      Phase[]
  
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt
}

model Phase {
  id          String      @id @default(cuid())
  sessionId   String
  session     Session     @relation(fields: [sessionId], references: [id])
  
  name        String
  order       Int
  duration    Int         // seconds
  player      PlayerType
  cycler      CyclerType
  
  items       PhaseItem[]
  effects     Effect[]
  
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt
}

enum Role {
  DOMINANT
  SUBMISSIVE
  SWITCH
}

enum Difficulty {
  BASIC
  LIGHT
  MODERATE
  DEEP
  EXTREME
}

enum PlayerType {
  DIRECT
  STEREO_SPLIT
  ROTATIONAL
  LAYERED
  TRI_CHAMBER
  COMPOSITE
}

enum CyclerType {
  CHAIN
  RANDOM
  WEAVE
  BRIDGE
  ADAPTIVE
  CLUSTER
}
```

### Phase 2: Core Application Structure

#### App Structure
```
app/
├── auth/
│   ├── login/page.tsx
│   └── register/page.tsx
├── dashboard/page.tsx      # Main session management
├── session/
│   ├── builder/page.tsx    # Session design interface
│   ├── player/[id]/page.tsx # Session playback
│   └── control/[id]/page.tsx # Dominant control interface
├── themes/page.tsx         # Theme management
└── api/
    ├── auth/[...nextauth]/route.ts
    ├── sessions/route.ts
    ├── themes/route.ts
    └── websocket/route.ts  # Real-time session control
```

#### Key Features to Implement

1. **Login System**: NextAuth with role-based access
2. **Dashboard**: Session list, quick start, theme browser
3. **Session Builder**: 
   - Drag-and-drop phase creation
   - Theme selection with tag filtering
   - Cycler/Player selection with previews
   - Duration and timing controls
4. **Session Player**: 
   - Real-time content delivery
   - State tracking (arousal/focus/depth)
   - Visual + audio synchronization
5. **Dominant Control Panel**:
   - Live session monitoring
   - Real-time theme switching
   - Notes and observations
   - Subject state indicators

### Phase 3: Content Integration

#### Theme System
- Load ontologies from `/ontologies/` directory
- Implement tag-based filtering (mindlessness + bimbo overlap)
- Create mantra difficulty system using Discord bot learnings
- Point normalization: Basic(10-15), Light(20-30), Moderate(35-45), Deep(60-80), Extreme(100-120)

#### Mantra Loading
Convert existing text files to normalized JSON:
```typescript
interface NormalizedMantra {
  text: string;
  difficulty: 'basic' | 'light' | 'moderate' | 'deep' | 'extreme';
  points: number;
  tags: string[];
}
```

### Phase 4: Session Engine

#### Cycler Implementation
```typescript
abstract class Cycler {
  abstract getSequence(items: MantraItem[]): MantraItem[];
}

class AdaptiveCycler extends Cycler {
  getSequence(items: MantraItem[], state: SessionState): MantraItem[] {
    // Adjust based on arousal/focus/depth
  }
}
```

#### Player Implementation
```typescript
abstract class Player {
  abstract arrangeSequence(sequence: MantraItem[]): ArrangedItem[];
}

class TriChamberPlayer extends Player {
  arrangeSequence(sequence: MantraItem[]): ArrangedItem[] {
    // Left/Right/Center arrangement
  }
}
```

### Phase 5: Real-time Features

#### WebSocket Integration
- Live session state synchronization
- Dominant-submissive real-time communication
- Session control commands
- State tracking updates

#### Adaptive Content
- Monitor user responses (heart rate integration planned)
- Adjust difficulty based on session progress
- Theme switching based on dominant observations

## Implementation Priority

1. **Start with**: Basic auth, dashboard, theme browsing
2. **Core functionality**: Session builder with static content
3. **Session player**: Basic playback without real-time features
4. **Advanced features**: Real-time control, adaptive content
5. **Polish**: WebSocket integration, dominant control panel

## Key Learnings to Apply

From Discord bot normalization:
- Use standardized point values across difficulties
- Ensure clear progression in content intensity
- Reserve permanence language ("forever", "permanently") for extreme difficulty
- Implement blind testing for content validation
- Create clear guidelines for content creators

## Files to Start With

1. `prisma/schema.prisma` - Database schema
2. `lib/auth.ts` - NextAuth configuration
3. `components/ui/` - Base UI components
4. `app/dashboard/page.tsx` - Main dashboard
5. `lib/themes.ts` - Theme loading and management
6. `lib/session-engine/` - Cyclers and Players

## Technical Stack

- **Frontend**: Next.js 15, React 19, TypeScript, Tailwind CSS
- **Backend**: Next.js API routes, Prisma ORM
- **Database**: PostgreSQL
- **Auth**: NextAuth.js
- **Real-time**: Socket.IO
- **State**: Zustand
- **Forms**: React Hook Form + Zod
- **UI**: Lucide icons, custom components

This plan incorporates the mantra difficulty learnings and provides a solid foundation for the sophisticated session design system described in the docs.