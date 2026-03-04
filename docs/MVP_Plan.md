# MVP Development Plan: AI Conditioner Web Application

## Executive Summary

This document outlines the development plan for converting the existing AI Conditioner hypnotic content generation system into a NextJS web application. The MVP will enable users to log in, select themes, manage hypnotic content lines through a spreadsheet interface, and generate downloadable MP3 sessions with AWS Polly text-to-speech integration.

## Current System Analysis

### Legacy Templating System (Superior) 
**Location:** `old code/data/converted/worship.txt`

The original system featured sophisticated templating capabilities:

```
{subject_subjective} [worship|worships] {dominant_name}, and {dominant_subjective} [give|gives] {subject_objective} pleasure.
```

**Key Features:**
- **Advanced Variable System**: `{subject_subjective}`, `{dominant_possessive}`, etc.
- **Automatic Verb Conjugation**: `[am|are|are|is]` syntax handles grammatical correctness
- **Flexible Personas**: Support for any subject/dominant names and pronouns
- **Grammatical Intelligence**: Complex pronoun/verb agreements handled automatically

**Output Examples:**
- First Person: "I worship Master, and he gives me pleasure"
- Third Person: "Bambi worships Mistress, and she gives her pleasure"

### Current JSON Format (Simplified)
**Location:** `hypnosis/mantras/Hypnosis/Mindbreak.json`

**Structure:**
```
Description | Intensity | FirstPerson | ThirdPerson | DomType
```

**Limitations:**
- Fixed to "Bambi" as subject
- Only first/third person variants  
- No automatic verb conjugation
- Lost grammatical flexibility
- Manual content duplication required

### Audio Generation Pipeline (Working)
**Location:** `utils/convert_v1_json_to_audio.ipynb`, `utils/convert_v1_json_to_sessions.ipynb`

**Current Process:**
1. **Content Hashing**: Text → SHA256 → `{hash}.mp3`
2. **AWS Polly Integration**: Neural voice synthesis 
3. **Progressive Difficulty**: BASIC → LIGHT → MODERATE → DEEP → EXTREME
4. **Session Assembly**: Concatenate audio files into complete sessions

**Pipeline Flow:**
```
Template → Rendered Text → AWS Polly → MP3 Storage → Session Assembly
```

## Technical Architecture

### Technology Stack
- **Frontend**: NextJS 15 with App Router
- **Database**: PostgreSQL with Prisma ORM
- **Authentication**: NextAuth.js
- **UI Components**: Shadcn/ui
- **Data Tables**: React Table (TanStack Table)
- **Audio Generation**: AWS Polly via API routes
- **File Storage**: Local filesystem
- **Deployment**: Local

### Database Schema (Prisma)

```prisma
model User {
  id              String   @id @default(cuid())
  email           String   @unique
  name            String?
  subjectName     String?  
  dominantName    String?
  subjectGender   Gender?
  dominantGender  Gender?
  favoriteThemes  UserFavoriteTheme[]
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model Theme {
  id              Int      @id @default(autoincrement())
  name            String   @unique
  description     String?
  category        String?
  templates       Template[]
  favoriteBy      UserFavoriteTheme[]
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model Template {
  id              Int        @id @default(autoincrement())
  templateText    String     // Old-style templating: "{subject_subjective} [worship|worships]..."
  difficulty      Difficulty
  lineType        LineType?
  themeId         Int
  theme           Theme      @relation(fields: [themeId], references: [id])
  lines           Line[]
  createdAt       DateTime   @default(now())
  updatedAt       DateTime   @updatedAt
}

model Line {
  id              Int      @id @default(autoincrement())
  templateId      Int
  renderedText    String   // Final rendered text for TTS
  pollyText       String?  // Override for pronunciation
  subject         String?
  dominant        String?
  audioHash       String?  // SHA256 hash for audio file
  audioPath       String?  // Path to MP3 file
  audioLength     Float?   // Duration in seconds
  template        Template @relation(fields: [templateId], references: [id])
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model UserFavoriteTheme {
  userId    String
  themeId   Int
  user      User   @relation(fields: [userId], references: [id])
  theme     Theme  @relation(fields: [themeId], references: [id])
  @@id([userId, themeId])
}

enum Intensity {
  BASIC
  LIGHT  
  MODERATE
  DEEP
  EXTREME
}

enum Gender {
  M
  F
  NONE
}

enum LineType {
  INDUCTION
  DEEPENER
  SUGGESTION
  EMERGENCE
  MANTRA
  AROUSAL
  BEHAVIORAL
}
```

## Development Phases

### Phase 1: MVP Foundation (Weeks 1-2)

#### Core Features
- [x] **User Authentication System**
  - Login/logout with NextAuth
  - User profile with persona settings (subject/dominant names)
  - Basic user preferences storage

- [x] **Theme Management Interface**
  - Theme selection dashboard
  - Theme browsing with categories
  - Favorite themes functionality

- [x] **Basic Line Editor**
  - Spreadsheet-like interface using React Table
  - CRUD operations for lines (Create, Read, Update, Delete)
  - Simple JSON format support initially
  - Columns: Template Text, Difficulty, Preview, Audio Status

- [x] **Audio Generation (Basic)**
  - API route: `/api/generate-audio`
  - AWS Polly integration with neural voices
  - Hash-based audio storage system
  - Progress tracking for audio generation

#### Technical Implementation
```typescript
// API Route Structure
/api/
  auth/              // Authentication endpoints
  themes/            // Theme CRUD operations
  templates/         // Template management
  lines/             // Line CRUD operations
  audio/
    generate         // Single line audio generation
    batch            // Batch audio generation
  sessions/
    create           // Session assembly and download
```

#### User Flow
```
1. User logs in → Dashboard
2. Select theme → Line editor loads
3. Edit/add lines in spreadsheet interface
4. Click "Generate Audio" → Progress bar shows generation
5. Preview individual lines with audio player
6. Generate session → Download MP3
```

### Phase 2: Enhanced Templating (Weeks 3-4)

#### Advanced Template System
- [x] **Template Engine Restoration**
  - Port original templating logic to TypeScript
  - Support for `{subject_subjective}`, `{dominant_possessive}`, etc.
  - Automatic verb conjugation: `[am|are|are|is]` → "am", "are", "is"
  - Real-time template preview

- [x] **Persona Management**
  - User-configurable subject/dominant names
  - Gender-aware pronoun selection
  - Template variable replacement engine
  - Bulk template application

- [x] **Enhanced Line Editor**
  - Template text column with syntax highlighting
  - Live preview column showing rendered text
  - Validation for template syntax
  - Bulk operations (duplicate, apply template, etc.)

#### Template Engine Implementation
```typescript
interface PersonaSettings {
  subjectName: string;
  subjectGender: 'M' | 'F' | 'NONE';
  dominantName: string;
  dominantGender: 'M' | 'F' | 'NONE';
}

class TemplateEngine {
  static render(template: string, personas: PersonaSettings): string {
    // Handle variable substitution
    // Handle verb conjugation
    // Return rendered text
  }
  
  static getVariables(template: string): string[] {
    // Extract all template variables
  }
  
  static validate(template: string): ValidationResult {
    // Validate template syntax
  }
}
```

### Phase 3: Session Generation & Audio Enhancement (Weeks 5-6)

#### Session Builder
- [x] **Session Configuration UI**
  - Difficulty progression selector
  - Duration settings
  - Theme mixing capabilities
  - Preview session structure

- [x] **Audio Session Assembly**
  - API route: `/api/sessions/generate`
  - Background job queue for long sessions
  - Progress tracking with WebSocket/SSE
  - Final MP3 assembly with silence padding

- [x] **Enhanced Audio Player**
  - In-browser playback with controls
  - Waveform visualization
  - Download functionality
  - Session sharing capabilities

#### Cyclers Integration (Future-Ready)
```typescript
// Foundation for integrating existing cycler logic
interface CyclerConfig {
  type: 'random' | 'chain' | 'weave' | 'bridge' | 'adaptive';
  parameters: Record<string, any>;
}

interface SessionConfig {
  themes: string[];
  difficulties: Difficulty[];
  duration: number;
  cycler: CyclerConfig;
  personas: PersonaSettings;
}
```

## File Structure

```
/src
  /app                 # NextJS App Router
    /api               # API routes
      /auth            # Authentication
      /themes          # Theme management
      /templates       # Template operations
      /audio           # Audio generation
      /sessions        # Session creation
    /dashboard         # Main app pages
    /themes            # Theme management pages
    /editor            # Line editor interface
    /sessions          # Session builder
  /components          # Reusable React components
    /ui                # Shadcn/ui components
    /audio             # Audio player components
    /editor            # Line editor components
    /forms             # Form components
  /lib                 # Utility libraries
    /audio             # Audio processing utilities
    /templates         # Template engine
    /auth              # Authentication utilities
    /db                # Database utilities
  /types               # TypeScript type definitions

/prisma
  schema.prisma        # Database schema
  /migrations          # Database migrations

/public
  /audio               # Generated MP3 files (if local storage)

/docs                  # Documentation (this file)
```

## API Endpoints

### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/logout` - User logout
- `GET /api/auth/me` - Get current user

### Themes
- `GET /api/themes` - List all themes
- `GET /api/themes/[id]` - Get specific theme
- `POST /api/themes` - Create new theme
- `PUT /api/themes/[id]` - Update theme
- `DELETE /api/themes/[id]` - Delete theme

### Templates & Lines
- `GET /api/themes/[id]/templates` - Get theme templates
- `POST /api/templates` - Create template
- `PUT /api/templates/[id]` - Update template
- `DELETE /api/templates/[id]` - Delete template
- `POST /api/templates/[id]/render` - Preview template rendering

### Audio Generation
- `POST /api/audio/generate` - Generate single audio file
- `POST /api/audio/batch` - Generate multiple audio files
- `GET /api/audio/status/[jobId]` - Check generation status
- `GET /api/audio/[hash]` - Stream audio file

### Sessions
- `POST /api/sessions/create` - Create new session
- `GET /api/sessions/[id]` - Download session MP3
- `GET /api/sessions/[id]/status` - Check session status

## User Interface Mockups

### Dashboard
```
┌─────────────────────────────────────────────────────────┐
│ AI Conditioner Dashboard                    [Profile ▼] │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Welcome back, [User]!                                   │
│                                                         │
│ Your Themes                    [+ New Theme]            │
│ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐        │
│ │ Mindbreak   │ │ Worship     │ │ Relaxation  │        │
│ │ 23 lines    │ │ 45 lines    │ │ 12 lines    │        │
│ │ [Edit]      │ │ [Edit]      │ │ [Edit]      │        │
│ └─────────────┘ └─────────────┘ └─────────────┘        │
│                                                         │
│ Recent Sessions               Quick Actions             │
│ • Mindbreak_Progressive.mp3   [Generate Session]       │
│ • Worship_Basic.mp3           [Browse Themes]          │
│                               [Account Settings]       │
└─────────────────────────────────────────────────────────┘
```

### Line Editor
```
┌─────────────────────────────────────────────────────────┐
│ Theme: Mindbreak                           [Save] [↻]   │
├─────────────────────────────────────────────────────────┤
│ [+ Add Line] [Generate Audio] [Create Session]          │
│                                                         │
│ ┌─Template Text─────────────────┬─Diff─┬─Preview──────┬─Audio─┐
│ │{subject_subjective} [let|lets]│BASIC │I let my      │ [▶]   │
│ │my thoughts dissolve          │      │thoughts      │       │
│ │completely.                   │      │dissolve...   │       │
│ ├─────────────────────────────┼──────┼─────────────┼───────┤
│ │{subject_subjective} [allow   │LIGHT │I allow my    │ [▶]   │
│ │allows] my mind to become     │      │mind to       │       │
│ │soft and open.                │      │become...     │       │
│ └─────────────────────────────┴──────┴─────────────┴───────┘
│                                                         │
│ Persona Settings                                        │
│ Subject: [I/me    ▼] Dominant: [Master   ▼]           │
└─────────────────────────────────────────────────────────┘
```

### Session Builder
```
┌─────────────────────────────────────────────────────────┐
│ Create New Session                                       │
├─────────────────────────────────────────────────────────┤
│ Session Settings                                         │
│ Duration: [20 minutes ▼]                                │
│ Progression: [☑] Basic → Light → Moderate → Deep       │
│                                                         │
│ Selected Themes                                         │
│ ☑ Mindbreak (45 lines)                                 │
│ ☑ Relaxation (23 lines)                                │
│ ☐ Worship (67 lines)                                   │
│                                                         │
│ Persona                                                 │
│ Subject: [Bambi    ▼] Dominant: [Master  ▼]           │
│                                                         │
│ ┌─Preview────────────────────────────────────────────┐ │
│ │ Estimated Duration: 18:32                          │ │
│ │ Total Lines: 89                                    │ │
│ │ • Basic: 12 lines                                  │ │
│ │ • Light: 23 lines                                  │ │
│ │ • Moderate: 31 lines                               │ │
│ │ • Deep: 23 lines                                   │ │
│ └────────────────────────────────────────────────────┘ │
│                                                         │
│                            [Generate Session]          │
└─────────────────────────────────────────────────────────┘
```

## Implementation Timeline

### Week 1: Foundation Setup
- [ ] NextJS project initialization with TypeScript
- [ ] Database setup with Prisma and PostgreSQL
- [ ] Authentication system implementation
- [ ] Basic UI components with Shadcn/ui
- [ ] User dashboard and theme browsing

### Week 2: Core Functionality  
- [ ] Theme and template CRUD operations
- [ ] Basic line editor with React Table
- [ ] AWS Polly integration and API routes
- [ ] Audio file management system
- [ ] Simple session generation

### Week 3: Enhanced Templating
- [ ] Template engine development and testing
- [ ] Advanced line editor with template support
- [ ] Persona management system
- [ ] Real-time preview functionality
- [ ] Template validation and error handling

### Week 4: Polish & Testing
- [ ] Enhanced UI/UX improvements
- [ ] Comprehensive testing suite
- [ ] Performance optimization
- [ ] Error handling and user feedback
- [ ] Documentation completion

### Week 5: Advanced Features
- [ ] Session builder interface
- [ ] Background job processing
- [ ] Advanced audio features
- [ ] User preferences and settings
- [ ] Export/import functionality

### Week 6: Deployment & Launch
- [ ] Production deployment setup
- [ ] Security audit and testing
- [ ] Performance monitoring
- [ ] User acceptance testing
- [ ] Launch preparation and documentation

## Future Enhancements (Post-MVP)

### Advanced Audio Processing
- Integration of cyclers and players system from existing codebase
- Real-time audio effects and spatial positioning
- Custom voice training and synthesis options

### User-Generated Content
- Theme sharing and community features
- Collaborative editing capabilities
- Content rating and recommendation system

### Mobile Application
- React Native app for mobile access
- Offline session downloads
- Push notifications for new content

### Analytics & Personalization
- Usage analytics and user behavior tracking
- AI-powered content recommendations
- Adaptive difficulty based on user engagement

### Enterprise Features
- Multi-user workspace management
- Advanced permissions and roles
- Custom branding and white-label options

## Technical Considerations

### Security
- Input sanitization for template text
- Rate limiting for audio generation
- Secure file storage and access controls
- User data privacy and GDPR compliance

### Performance
- Efficient audio file caching and delivery
- Background job processing for long tasks
- Database query optimization
- CDN integration for static assets

### Scalability
- Horizontal scaling for audio generation
- Database optimization and indexing
- Caching strategies for frequently accessed content
- Load balancing and auto-scaling capabilities

## Success Metrics

### User Engagement
- Daily/monthly active users
- Session generation frequency
- Time spent in line editor
- User retention rates

### Technical Performance
- Audio generation success rate
- Average session creation time
- System uptime and reliability
- User satisfaction scores

### Content Quality
- Number of themes created
- Lines per theme average
- Audio quality ratings
- User feedback and testimonials

## Conclusion

This MVP plan leverages the existing sophisticated templating and audio generation systems while modernizing the interface and user experience. The phased approach ensures rapid delivery of core functionality while maintaining the flexibility to enhance and expand the system based on user feedback and requirements.

The plan preserves the valuable intellectual property in the original templating system while creating a scalable, user-friendly web application that can serve as the foundation for future enhancements and business growth.