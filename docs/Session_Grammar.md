# Hypnosis Session Grammar Specification

This document defines the grammar for configuring hypnosis sessions using a structured format. The grammar is compatible with the application's session generation system and can be extended or simplified as needed.

## Overview

The grammar defines:
- **Sessions**: Top-level configuration for an entire hypnosis experience.
- **Phases**: Sequential segments of the session, each with distinct timing, players, and cyclers.
- **Items**: Content within a phase, such as script segments, mantras, or visual elements.
- **Filters**: Options for selecting specific lines or media from theme files.
- **Effects**: Audio modifications like reverb, echo, and pitch shift.

---

## Grammar

### Session

```ebnf
Session ::= "SESSION" "{" 
              ( "duration:" Number "seconds" )?
              PhaseList
            "}"
```

- **SESSION**: Declares the start of a session configuration.
- **duration**: (Optional) Total duration of the session in seconds.
- **PhaseList**: List of phases in the session.

---

### Phase

```ebnf
PhaseList ::= Phase | Phase PhaseList

Phase ::= "PHASE" PhaseName "{"
            PhaseTiming
            PlayerDeclaration
            CyclerDeclaration
            (AudioEffectSection)?
            ItemList
          "}"
```

- **PHASE**: Declares a phase in the session.
- **PhaseName**: Identifier for the phase (e.g., induction, deepener).
- **PhaseTiming**: Specifies how long the phase lasts.
- **PlayerDeclaration**: Defines the player used in the phase.
- **CyclerDeclaration**: Defines the cycler used in the phase.
- **AudioEffectSection**: (Optional) Effects applied to audio in the phase.
- **ItemList**: List of items (mantras, segments, visuals) in the phase.

---

### Phase Timing

```ebnf
PhaseTiming ::= "timing:" (("fixed:" Number "seconds") 
                        | ("match_length_of:" SegmentFileReference))
```

- **fixed**: Runs the phase for a set duration (e.g., `fixed: 60 seconds`).
- **match_length_of**: Matches the duration of a specified script segment.

---

### Items

```ebnf
ItemList ::= Item | Item ItemList

Item ::= SegmentItem | MantraItem | VisualItem

SegmentItem ::= "SEGMENT" "{"
                  "file:" String ","
                  "channel:" Channel ","
                  "voice:" Voice
                "}"

MantraItem ::= "MANTRA" "{"
                  "theme_file:" String ","
                  "channel:" Channel ","
                  "voice:" Voice ","
                  Filters?
                "}"

VisualItem ::= "VISUAL" "{"
                  "theme_file:" String ","
                  "flash_rate:" Number "hz" ","
                  Filters?
                "}"
```

- **SEGMENT**: A script segment file, played in a specified channel with a TTS voice.
- **MANTRA**: A theme file containing lines of text or audio, filtered by specific criteria.
- **VISUAL**: A theme file containing images or visuals, flashed at a specified rate.

---

### Filters

```ebnf
Filters ::= "filters:" "{" FilterList "}"

FilterList ::= Filter | Filter FilterList

Filter ::= "difficulty:" DifficultyRange
          | "dominant:" String
          | "theme:" String
          | "submissive:" String
          | "filepath_match:" String

DifficultyRange ::= "{" "min:" DifficultyLevel "," "max:" DifficultyLevel "}"
DifficultyLevel ::= "light" | "medium" | "hard"
```

- **difficulty**: Filters lines by difficulty level (light, medium, hard).
- **dominant**: Filters lines referencing a specific dominant (e.g., Master).
- **theme**: Filters lines by theme (e.g., relaxation, obedience).
- **submissive**: Filters lines referencing a specific submissive.
- **filepath_match**: Matches media by file path patterns.

---

### Effects

```ebnf
AudioEffectSection ::= "EFFECTS" "{"
                         EffectList
                       "}"

EffectList ::= Effect | Effect EffectList

Effect ::= ReverbEffect | EchoEffect | PitchShiftEffect | CustomEffect

ReverbEffect ::= "REVERB" "{" "roomSize:" Number "," "damp:" Number "}"
EchoEffect ::= "ECHO" "{" "delay:" Number "ms" "," "decay:" Number "}"
PitchShiftEffect ::= "PITCH_SHIFT" "{" ("random_range:" Number "%" | "shift:" Number "%") "}"
CustomEffect ::= Identifier "{" EffectParams "}"

EffectParams ::= (Identifier ":" (Number | String)) { "," Identifier ":" (Number | String) }
```

- **REVERB**: Adds reverb to audio.
- **ECHO**: Adds echo with a delay and decay.
- **PITCH_SHIFT**: Adjusts pitch by a fixed percentage or within a random range.
- **CustomEffect**: Placeholder for user-defined effects.

---

### Supporting Elements

#### Channels

```ebnf
Channel ::= "L" | "R" | "C"
```

- **L**: Left audio channel.
- **R**: Right audio channel.
- **C**: Center audio channel.

#### Voice

```ebnf
Voice ::= "SALLI"
```

- Currently fixed to **SALLI**.

#### Identifiers, Strings, Numbers

```ebnf
Identifier ::= Letter { Letter | Digit | "_" }
String ::= '"' { Character } '"'
Character ::= Any character except '"'
Letter ::= "a".."z" | "A".."Z"
Digit ::= "0".."9"
Number ::= Digit { Digit | "." }
```

---


## Example: JSON Representation

Below is an example of how a session configuration might look in JSON format:

```json
{
  "session": {
    "duration": 900,
    "phases": [
      {
        "name": "induction",
        "timing": {
          "type": "fixed",
          "value": 120
        },
        "player": "DirectPlayer",
        "cycler": "ChainCycler",
        "effects": [
          {
            "type": "REVERB",
            "roomSize": 0.7,
            "damp": 0.2
          }
        ],
        "items": [
          {
            "type": "SEGMENT",
            "file": "intro_relaxation_script.wav",
            "channel": "C",
            "voice": "SALLI"
          },
          {
            "type": "MANTRA",
            "theme_file": "relaxation.txt",
            "channel": "L",
            "voice": "SALLI",
            "filters": {
              "difficulty": {
                "min": "light",
                "max": "medium"
              },
              "theme": "Relaxation"
            }
          },
          {
            "type": "VISUAL",
            "theme_file": "calm_images.json",
            "flash_rate": 2.0,
            "filters": {
              "theme": "Acceptance"
            }
          }
        ]
      },
      {
        "name": "somnophilia_intro",
        "timing": {
          "type": "fixed",
          "value": 180
        },
        "player": "TriChamberPlayer",
        "cycler": "AdaptiveCycler",
        "effects": [
          {
            "type": "ECHO",
            "delay": 250,
            "decay": 0.4
          },
          {
            "type": "PITCH_SHIFT",
            "random_range": 3
          }
        ],
        "items": [
          {
            "type": "SEGMENT",
            "file": "somnophilia_induction_segment.wav",
            "channel": "C",
            "voice": "SALLI"
          },
          {
            "type": "MANTRA",
            "theme_file": "somnophilia.txt",
            "channel": "R",
            "voice": "SALLI",
            "filters": {
              "difficulty": {
                "min": "light",
                "max": "hard"
              },
              "dominant": "Master",
              "theme": "Somnophilia"
            }
          },
          {
            "type": "VISUAL",
            "theme_file": "dreamy_images.json",
            "flash_rate": 2.5,
            "filters": {
              "theme": "Dreaming"
            }
          }
        ]
      },
      {
        "name": "worship_build",
        "timing": {
          "type": "fixed",
          "value": 180
        },
        "player": "RotationalPlayer",
        "cycler": "ClusterCycler",
        "effects": [
          {
            "type": "REVERB",
            "roomSize": 0.9,
            "damp": 0.4
          }
        ],
        "items": [
          {
            "type": "SEGMENT",
            "file": "worship_suggestion.wav",
            "channel": "C",
            "voice": "SALLI"
          },
          {
            "type": "MANTRA",
            "theme_file": "worship.txt",
            "channel": "L",
            "voice": "SALLI",
            "filters": {
              "difficulty": {
                "min": "light",
                "max": "medium"
              },
              "dominant": "Master",
              "theme": "Worship"
            }
          },
          {
            "type": "VISUAL",
            "theme_file": "entrainment_spirals.json",
            "flash_rate": 3.0,
            "filters": {
              "theme": "Focus"
            }
          }
        ]
      },
      {
        "name": "deepening_somnophilia_worship",
        "timing": {
          "type": "fixed",
          "value": 240
        },
        "player": "CompositePlayer",
        "cycler": "RandomCycler",
        "effects": [
          {
            "type": "ECHO",
            "delay": 300,
            "decay": 0.5
          },
          {
            "type": "PITCH_SHIFT",
            "shift": -2
          }
        ],
        "items": [
          {
            "type": "SEGMENT",
            "file": "deepening_obedience_segment.wav",
            "channel": "C",
            "voice": "SALLI"
          },
          {
            "type": "MANTRA",
            "theme_file": "submission.txt",
            "channel": "R",
            "voice": "SALLI",
            "filters": {
              "difficulty": {
                "min": "medium",
                "max": "hard"
              },
              "dominant": "Master",
              "theme": "Obedience"
            }
          },
          {
            "type": "MANTRA",
            "theme_file": "somnophilia.txt",
            "channel": "L",
            "voice": "SALLI",
            "filters": {
              "difficulty": {
                "min": "light",
                "max": "hard"
              },
              "dominant": "Master",
              "theme": "Somnophilia"
            }
          },
          {
            "type": "VISUAL",
            "theme_file": "mindbreak_images.json",
            "flash_rate": 4.0,
            "filters": {
              "theme": "Mindbreak"
            }
          }
        ]
      },
      {
        "name": "ego_loss_worship_finale",
        "timing": {
          "type": "fixed",
          "value": 180
        },
        "player": "LayeredPlayer",
        "cycler": "WeaveCycler",
        "effects": [
          {
            "type": "REVERB",
            "roomSize": 0.95,
            "damp": 0.5
          },
          {
            "type": "PITCH_SHIFT",
            "random_range": 5
          }
        ],
        "items": [
          {
            "type": "SEGMENT",
            "file": "ego_loss_worship_ending.wav",
            "channel": "C",
            "voice": "SALLI"
          },
          {
            "type": "MANTRA",
            "theme_file": "worship.txt",
            "channel": "L",
            "voice": "SALLI",
            "filters": {
              "difficulty": {
                "min": "light",
                "max": "hard"
              },
              "dominant": "Master",
              "theme": "Worship"
            }
          },
          {
            "type": "VISUAL",
            "theme_file": "emptiness_images.json",
            "flash_rate": 5.0,
            "filters": {
              "theme": "Emptiness"
            }
          }
        ]
      }
    ]
  }
}

```