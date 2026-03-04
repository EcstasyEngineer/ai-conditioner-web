# Mantra System Refactor Documentation

## Overview

This document outlines the refactored mantra content system for AI Conditioner Web, streamlining the pipeline from theme definition to runtime audio generation while enabling rich cross-theme tagging and efficient storage.

## Core Concepts

### 1. Theme Ontology Structure

Themes exist at two levels:
- **Categories** (high-level): Hypnosis, Experience, Identity, Personality, Behavior, Ds
- **Themes** (specific): Acceptance, Mindbreak, Bimbo, etc.

Each theme can be tagged with:
- One or more categories it belongs to
- Other themes it overlaps with or references

### 2. Mantra Template System

Mantras are stored as templates with variable substitution patterns:
```
{subject_subjective} [trust|trusts] {dominant_name}'s guidance completely.
```

Variables:
- `{subject_subjective}` - I/you/she/he/they/we
- `{subject_objective}` - me/you/her/him/them/us
- `{subject_possessive}` - my/your/her/his/their/our
- `{subject_name}` - User's chosen name (e.g., "Bambi")
- `{dominant_subjective}` - I/you/she/he/they
- `{dominant_objective}` - me/you/her/him/them
- `{dominant_possessive}` - my/your/her/his/their
- `{dominant_name}` - Dominant's name (e.g., "Master")
- `{dominant_title}` - Master/Mistress/etc.
- `{subject_gender_noun}` - boy/girl/one

Verb conjugations use bracket syntax: `[base|third-person|plural|special]`

## File Organization

### Current Structure (To Be Cleaned)
```
ontologies/
  ├── Acceptance.json      # Theme metadata only
  └── ...
hypnosis/mantras/
  ├── Category/
  │   ├── Theme.txt       # Tab-separated with Bambi columns
  │   └── Theme.json      # Duplicate first/third person
  └── ...
```

### New Structure
```
content/
  ├── themes/
  │   ├── acceptance.json  # Complete theme definition with metadata
  │   └── ...
  └── mantras/
      ├── acceptance.txt   # Template format mantras
      └── ...
```

## Database Schema Updates

### 1. Enhanced Theme Model
```prisma
model Theme {
  id          String   @id @default(cuid())
  name        String   @unique
  description String
  appeal      String   // Psychological appeal text
  
  // Hierarchical tagging
  categories  String[] // ["Hypnosis", "Experience"]
  relatedThemes String[] // ["Suggestibility", "Openness"]
  keywords    String[]
  
  cnc         Boolean  @default(false)
  
  // Relations
  mantras     Mantra[]
  
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

### 2. Template-Based Mantra Model
```prisma
model Mantra {
  id         String     @id @default(cuid())
  themeId    String
  theme      Theme      @relation(fields: [themeId], references: [id], onDelete: Cascade)
  
  // Template storage
  template   String     // "{subject_subjective} [trust|trusts]..."
  difficulty Difficulty
  points     Int
  
  // Flags
  hasDominant Boolean   // Whether template includes dominant references
  lineType   LineType?  // INDUCTION, DEEPENER, etc.
  
  // Cross-theme tagging
  crossThemes String[]  // Other themes this mantra relates to
  
  // Relations
  renderedMantras RenderedMantra[]
  
  createdAt  DateTime   @default(now())
  updatedAt  DateTime   @updatedAt
  
  @@unique([themeId, template])
}
```

### 3. Rendered Mantra Cache
```prisma
model RenderedMantra {
  id          String   @id @default(cuid())
  mantraId    String
  mantra      Mantra   @relation(fields: [mantraId], references: [id], onDelete: Cascade)
  
  // Rendering parameters
  subjectPOV   POV
  subjectName  String?
  subjectGender Gender
  dominantPOV  POV
  dominantName String?
  dominantGender Gender
  
  // Rendered content
  text        String   // Final rendered text
  textHash    String   // SHA256 for deduplication
  
  // Audio properties
  audioPath   String?
  audioLength Float?
  voice       String
  
  createdAt   DateTime @default(now())
  
  @@unique([textHash])
  @@index([mantraId, subjectPOV, dominantPOV])
}
```

## Content Pipeline

### 1. Theme Definition → Mantra Generation

**Input**: Theme definition with metadata
```json
{
  "name": "Acceptance",
  "description": "Embracing new ideas and changes...",
  "appeal": "Provides safe haven from judgment...",
  "categories": ["Hypnosis", "Experience"],
  "relatedThemes": ["Openness", "Suggestibility", "Trust"],
  "keywords": ["open mind", "receptive", "embrace change"],
  "cnc": false
}
```

**Prompt Enhancement**: When generating mantras, include:
- Primary theme context
- Related themes for cross-pollination
- Category-specific language patterns
- Instruction to tag mantras that overlap with other themes

**Output**: Template-format mantras with cross-theme tags
```
BASIC	{subject_subjective} [accept|accepts] new ideas with an open heart.	NoDom	[]
BASIC	{subject_subjective} [trust|trusts] {dominant_name}'s guidance.	Dom	["Trust", "Submission"]
MODERATE	{subject_possessive} mind [become|becomes] fluid and adaptable.	NoDom	["Mindlessness", "Suggestibility"]
```

### 2. TXT → Database Import

Parse template mantras and store with:
- Detected cross-theme references
- Calculated difficulty scores (post-processing for consistency)
- Verb conjugation patterns validated
- Line type auto-detection based on keywords

### 3. Runtime Rendering

When user requests content:
1. Load user preferences (POV, names, gender)
2. Query mantras by theme + difficulty filters
3. Check RenderedMantra cache by textHash
4. If not cached:
   - Apply template substitutions
   - Process verb conjugations
   - Generate TTS audio
   - Store in cache
5. Return audio path

## Migration Strategy

### Phase 1: Schema Updates
1. Add new fields to Theme model (appeal, categories, relatedThemes)
2. Add Mantra.template and Mantra.crossThemes fields
3. Create RenderedMantra table

### Phase 2: Content Conversion
1. Merge ontology JSON with theme metadata
2. Convert existing mantras to template format
3. Auto-detect and tag cross-theme references
4. Remove redundant Bambi columns

### Phase 3: Pipeline Implementation
1. Update mantra generation prompts
2. Implement template parser
3. Create rendering engine with caching
4. Update session engine to use new system

## Benefits

1. **Storage Efficiency**: ~60% reduction by eliminating duplicate versions
2. **Flexibility**: Support any POV/name combination without pre-generation
3. **Discoverability**: Cross-theme tagging enables richer content mixing
4. **Maintainability**: Single source of truth for each mantra
5. **Performance**: Hash-based caching prevents duplicate TTS generation
6. **Scalability**: Easy to add new themes and cross-references

## Example: Cross-Theme Discovery

A session with "Acceptance" theme could dynamically include mantras tagged with related themes:
- Core Acceptance mantras
- Trust-tagged mantras from other themes
- Suggestibility mantras that reference acceptance
- Openness mantras that complement the experience

This creates a richer, more interconnected experience while maintaining clear theme boundaries.