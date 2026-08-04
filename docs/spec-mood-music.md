# Spec — Generative mood music via TidalCycles/Strudel (draft v0)

> Status: **DRAFT, not scheduled.** Written 2026-08-04 from a numerical analysis of a
> reference audio ("Pillow Pet Sloth", 28:21) whose background bed is a working example of
> music that affords CALM/security. The goal generalizes: parameterize a soundscape
> generator by affect (security ↔ anxiety ↔ intensity) so any mood bed — and mood
> *titration* between beds — can be produced programmatically. Companion ambitions: use the
> same pattern engine for mantra dispatching (sentence fragments patterned like samples).
> Analysis artifacts backing every claim in §1: `Desktop/pillow-pet-sloth-analysis/`
> (spectrograms, per-0.5s tone tracking, full metric report, separated stems).

---

## 0. Naming the two engines (the confusion, resolved)

- **TidalCycles** — the original: Haskell pattern language, requires SuperCollider +
  SuperDirt as the synth backend. Powerful, heavyweight install, OSC-native.
- **Strudel** — the official JavaScript port of the same pattern language, runs on Web
  Audio in a browser. Embeddable (`@strudel/web` for a custom UI, `@strudel/repl` as a
  version-pinnable web component); the strudel.cc REPL is the reference UI. **AGPL-3.0** —
  fine as a *separate process/page*, must not be linked into the trance binary.

Everything below says "Strudel" for concreteness (browser, zero native deps, we already
drive real browsers over CDP for userscript work); every pattern concept is identical in
TidalCycles if the SuperCollider route ever becomes attractive.

---

## 1. The empirical CALM recipe (measured, not vibes)

Facts extracted from the reference bed (demucs-separated music stem, so voice bleed is
excluded). These constitute the target fingerprint for a generated "security" bed:

**Harmony / pitch**
- Key: C major, unambiguous (Krumhansl correlation 0.92; runner-up C minor 0.71 — the gap
  matters, see borrowed chords below).
- **A dominant pedal (G4, 393 Hz) sounds in nearly every frame of 28 minutes** — the
  single most characteristic device. Everything happens *under* a held 5th degree, so no
  chord ever feels unanchored. This is the security affordance in one trick.
- Root drone two–three octaves down (C2/C3, with G2/F2/A2 as roots move).
- Chord vocabulary: I, IV (voiced as add9 under the pedal), V, vi, iii, **plus borrowed
  bIII (Eb), bVII (Bb), bVI (Ab)** — the flatward borrowings are what read as
  "cozy/fantasy warmth" rather than plain-diatonic blandness.
- Harmonic rhythm: one chord per **5–15 s**. Phrase blocks 30–60 s (a soft flute-like
  voice at ~850–1100 Hz switches on for a phrase, then rests).
- Signature cadence at section seams: **bIII → IV → V → I with the top voice resolving
  5̂ → 3̂** (G4 → E4). In the reference it lands at 2:35. Any generator must be able to
  express this "resolution moment" — it is the musical event that marks a section
  transition without ever raising tension (no leading-tone, no dominant 7th).

**Time / dynamics**
- No percussion; ~90% of energy is harmonic. Spectral flatness 0.003 (extremely tonal).
- Gentle pluck/arp activity ~80 onsets/min with weak-to-moderate pulse clarity; nothing
  that demands entrained movement. (Tempo estimator says 129 bpm but that is double-time
  on the arp; felt pulse is ~65.)
- **Amplitude swells at 0.4–1.2 Hz** (≈ one swell per 1–2.5 s up to one per breath-length
  8 s window) — breathing-pace modulation, no fast tremolo, no isochronic gating.
- Overall bed level ~15–20 dB under the voice. Structure: A sections (full bed) /
  a thinner B stretch (bass and mid-melody largely dropped, brighter centroid) under the
  deepener, with one near-silent seam (−59 dB) at the biggest transition, ~16:40.
- Loop length ≈ 3:15 (the bIII borrowing recurs at ~1:50, 5:00, 15:20, 18:40, 21:50).

**The mid-file "anomaly" is script-aligned (intent confirmed, 3/3 boundaries).** The
thin B-section is not filler; each of its edges lands on a script beat:
1. Bass drops out + level falls ~5 dB at ~9:30 — exactly the final resistance challenge
   resolving into the surrender line ("that's when you just give up," 10:02), preceded by
   the longest vocal pause in the whole file (2.3 s at 9:22). Groundedness leaves the
   music at the moment the listener is told they've let go: weightless drift section.
2. The deepest flatward harmonic excursion (Ab/Eb at 15:20, Bb at 15:40 — furthest from
   home in the whole piece) plus the bass's return land on the arousal pivot ("I've
   decided you're going to be my new little toy... turn you on," 15:02–15:42).
3. The −59 dB near-silence seam (~16:40) sits precisely on the shift from teasing to
   explicit touch escalation ("as I just start to run my hands up your body," 16:46),
   after which the full A-bed restarts in home-key C.
   Design lesson for the generator: **section boundaries in the bed must be placeable at
   script beats** (surrender, pivot, escalation) — arrangement against the narrative arc
   is a first-class input, not post-hoc decoration.

**Space / stereo**
- Channels near-fully decorrelated (L/R correlation −0.01): wide chorused pad, L/R
  detuned by 0–2 Hz (drifting, not fixed — this is chorus width, not an engineered
  binaural bed, though it incidentally produces slow delta-range beating on the
  E4-region carrier).
- Timbre: strong fundamentals, fast harmonic rolloff, little content above ~1.5 kHz
  except the melody voice's 2nd/3rd harmonics — soft-wind ("wood") character.

## 2. Mood parameterization (the axes)

Three author-facing axes; every musical knob derives from them. This is deliberately the
same shape as the visual grammar's modulator rule: an axis is a value a curve can move.

| Musical knob | security/CALM | anxiety | intensity ("vampire") |
|---|---|---|---|
| Mode | major (+ bIII/bVII warmth) | minor/phrygian, b2 rubs | minor, chromatic lament bass |
| Pedal | constant 5̂ pedal | **no pedal** (nothing anchors) | tonic pedal in low octaves |
| Harmonic rhythm | 5–15 s | irregular, 2–20 s unpredictable | slow, 10–30 s, heavy |
| Dissonance | none; add9 max | m2/tritone rubs against drone | dim7 / bare 5ths |
| Pulse | none felt; arp haze | none, but irregular event spikes | slow explicit pulse 50–60 bpm |
| AM / swells | 0.4–1.2 Hz breathing | jittered AM, no steady rate | deep 0.2–0.5 Hz surges |
| Register | mid + high pad, soft lows | thin highs, hollow middle | low-register mass |
| Timbre | tonal (flatness <0.01), winds | noisier (flatness ↑), metallic | organ/choir-ish, wide |
| Stereo | wide, 0–2 Hz detune | narrow→wide lurches | wide, slow rotation |
| Predictability | high (loops, exact repeats) | **low** (the anxiety lever) | high but inexorable |

The load-bearing insight from the analysis: **calm ≈ predictability + anchoring**
(pedal, drone, exact loop repeats, slow everything), and anxiety is produced by removing
exactly those two things — not by adding loud or fast material.

### 2.5 From mood to progression — the generative model (not a lookup of one progression)

The reference's Eb → F → G → C is **one draw from a distribution, not the secret sauce**.
Mood is carried mostly by the *non-progression* parameters (mode, pedal, harmonic rhythm,
register, timbre, predictability — the table above); within a mood there is an
equivalence class of progressions that all afford it. That class is exactly a
**constrained Markov chain over functional harmony**: chords are states grouped by
function (tonic: I/vi/iii — home; subdominant: IV/ii — away; dominant: V — leaning home;
borrowed: bIII/bVI/bVII — warmth/shadow), and a mood defines (a) the allowed palette,
(b) the transition weights, (c) the dwell time per state, (d) a small set of **cadence
idioms** — multi-chord closing moves like the reference's bIII→IV→V→I with the 5̂→3̂ top
voice — deployed only at section seams. Generation = sample the walk; craft = the idioms
+ the parameter table, not the sampled sequence.

So the "**rainbow table for mood**" is real and small: one row per mood =
`{mode, palette, transition matrix, harmonic-rhythm range, pedal flag, cadence idioms,
texture/timbre knobs}` — a page of data per mood, not an LLM in the loop. The
music-emotion literature (valence/arousal feature mappings) says the dominant levers are
exactly the table's: mode, tempo, register, consonance, predictability; progression
choice is a second-order effect inside the constraint set. An LLM is useful once, to
author/critique rows of the table — never at generation time. A mood transition is a weighted crossfade between two
parameter sets over N minutes (acceptance → obedience, calm → intense), directly analogous
to the visual grammar's primary/secondary concept escalation. Implementation-wise it is
one `slider`-style scalar 0→1 that every derived knob reads — the audio twin of a
`curve 0 -> 1 over arc`.

## 3. Strudel sketch (proof the recipe is expressible)

~40 lines of Strudel expresses the calm recipe; untested sketch, tune by ear + validator:

```js
setcps(0.05)                                   // one cycle ≈ 20 s = one chord
const prog = chord("<C^9 F^9/C Am9 C^9 Eb^9 F^9 G C^9>")  // incl. bIII cadence bar
stack(
  note("g4").s("sine").gain(0.25)              // the eternal pedal
    .detune(sine.range(-1.2, 1.2).slow(13)),   //   0-2 Hz drifting L/R chorus width
  note("<c2 c2 a1 c2 eb2 f2 g2 c2>").s("sawtooth").lpf(300).gain(0.3), // root drone
  prog.voicing().s("triangle").lpf(1200)       // pad
    .gain(sine.range(0.15, 0.3).slow(2)),      //   0.5 Hz breathing swell
  n("0 [2 4] . 3 [1 0] ~ ~").scale("C:major")  // sparse arp haze, rests included
    .s("kalimba").gain(0.12).degradeBy(0.3),
  n("~ ~ 7 9 7 ~ 4 ~").scale("C:major").slow(2) // 30-60s phrase voice (the 1 kHz band)
    .s("flute").gain(0.2).sometimesBy(0.5, x => x.silence())
).room(0.8).roomsize(4)
```

The mood axes become a params object interpolated by the titration scalar; anxiety/
intensity variants swap the scale, drop the pedal line, jitter `degradeBy`/timing, etc.

## 4. Architecture — how it reaches trance (and what v0 is)

Trance's grammar plays **precanned files only** (`audio` primitive, theme audio pools —
no TTS, no synthesis, by design; see `docs/audio.md`, grammar §4.14). That constraint
forces the honest architecture split:

- **v0 — OFFLINE RENDER (build this one).** A Strudel page renders each mood bed (and
  each step of a titration arc) to files; files land in theme `audio_path` pools or
  playlist `AudioEvent`s like any other asset. Zero runtime dependencies, zero AGPL
  contact with the binary, works today with shipped grammar. Validation loop: the
  analyzer built for this spec re-runs on generated output and must hit the §1
  fingerprint (pedal present in >80% of frames, flatness <0.01, harmonic >85%, AM peak
  in 0.3–1.2 Hz, harmonic rhythm >5 s, L/R correlation <0.3). The analyzer is the
  acceptance test; no metric, no merge.
- **v1 — LIVE SIDECAR (only if v0 beds feel too static).** Strudel in a browser/webview
  beside trance, mood scalar driven over its API (or the existing CDP tooling); trance
  side unchanged — it just doesn't own the audio. Free-running tempo alignment with the
  entrainment bed's `pulse_hz` (cps = pulse_hz / beats-per-cycle); no phase sync in v1.
- **v2 — MANTRA DISPATCHING (separate spec when real).** The same pattern language
  scheduling one-two-sentence mantra fragments as samples (`s("mantra:2 ~ mantra:0")`,
  `degradeBy`, weighted `randcat` for primary/secondary titration). Noted here only so
  the engine choice (Strudel) is made once with this future in view.

Cut from v0 deliberately: live parameter morphing, binaural/isochronic layers (trance's
entrainment bed already owns that job and does it better), phase-locking generated beds
to the bed pulse, any grammar surface changes.

## 5. Appendix A — the recipe in plain language (no theory required)

- **Two notes never stop.** A deep hum (C, near the bottom of a piano) and a higher held
  tone (G, the "whistle note"). They are the walls of the room; everything else is
  furniture moved around slowly inside it. Because those two are always sounding, no
  chord ever feels like it arrived from nowhere.
- **Chords are just "which 3–4 notes are sounding together."** This piece only ever uses
  the home chord (C) and its three friendliest neighbors (F, G, Am) — plus, occasionally,
  a "visitor" chord (Eb or Bb) that isn't from the neighborhood but is brought in *under*
  the two held notes, so it lands as a warm plot twist instead of a threat.
- **Everything is slow and repeats exactly.** One chord per 5–15 seconds. One melody
  phrase per 30–60 seconds, then silence from that instrument. The whole thing loops
  every ~3 minutes. Your brain stops predicting because it never loses.
- **The 2:35 moment you heard:** after a visitor chord walks home in three steps
  (Eb → F → G → C), the held whistle-note (G) finally steps down to the nearest chord
  note (E) at the exact moment of arrival. It is musically an exhale. That figure —
  "held note releases downward exactly at homecoming" — is the piece's punctuation mark.
- **Why it reads as safe:** calm = anchored + predictable. The anxious version of this
  music is not louder or faster — it is this music with the anchors removed (no drone, no
  pedal) and the repetition broken (nothing happens twice the same way).

## 6. Open questions

- Sample sources for the wind/kalimba timbres (Strudel default banks vs. curated).
- Loop length for rendered beds (reference uses ~3:15; 2–4 min feels right; must
  loop-splice cleanly).
- Whether titration arcs render as N discrete files (crossfaded by playlist `AUDIO_FADE`
  events) or one long premixed file per arc. Discrete files compose better; start there.
