# hypnoapp 1.0 — Phase B Corpus Contract

**Audience:** the grok saturation swarm and the ingest toolchain (module M5). This document
is written to be read standalone — it is the complete contract Phase B must fulfill.

**Companion docs:** `DESIGN.md` (architecture), `MODULES.json` (partition).

**Authority:** where this document and a generation prompt disagree, this document wins.
The ingester enforces every rule marked **HARD** by rejecting the record. Rules marked
**REVIEW** route the record to a human queue rather than dropping it.

---

## 1. What Phase B is producing, in one paragraph

Every mantra in hypnoapp is a conditioner-schema pool record **plus three authored
grammatical-person renderings of it** stored in a sidecar. The three renderings are what the
brief's triplet is made of: the center channel shows the 2nd-person form, the two side
channels show 1st- or 3rd-person forms that drift across the session. The corpus must be
saturated enough that three simultaneous channels can draw from one theme for ~18
consecutive steps without visible repetition. **[MEASURED]** today's corpus holds 612
records with **zero** 2nd-person content — so the
center channel currently has no source material at all. Phase B closes that.

---

## 2. Themes

### 2.1 The 22 existing themes and their live cell counts

**[MEASURED]** from the conditioner repo's `mantras/pool.json`, 612 records. Columns are
and its markers derived from its text, never stored.

| theme | n | basic | light | moderate | deep | extreme |
|---|---:|---:|---:|---:|---:|---:|
| acceptance | 31 | 7 | 11 | 4 | 6 | 3 |
| addiction | 35 | 4 | 8 | 13 | 9 | 1 |
| amnesia | 30 | 6 | 8 | 5 | 6 | 5 |
| bimbo | 30 | 5 | 14 | 7 | 2 | 2 |
| blank | 30 | 5 | 6 | 8 | 9 | 2 |
| brainwashing | 35 | 4 | 8 | 11 | 4 | 8 |
| degradation | 26 | 4 | 7 | 9 | 4 | 2 |
| denial | 26 | 6 | 7 | 7 | 4 | 2 |
| devotion | 22 | 2 | 6 | 5 | 6 | 3 |
| drone | 28 | 3 | 7 | 8 | 9 | 1 |
| exhibition | 30 | 5 | 7 | 6 | 8 | 4 |
| feminine | 31 | 6 | 8 | 7 | 5 | 5 |
| focus | 19 | 7 | 4 | 5 | 2 | 1 |
| free_use | 26 | 4 | 9 | 7 | 5 | 1 |
| gratitude | 22 | 3 | 9 | 5 | 4 | 1 |
| obedience | 27 | 8 | 12 | 3 | 3 | 1 |
| puppet | 29 | 4 | 16 | 6 | 1 | 2 |
| resistance | 30 | 4 | 12 | 10 | 2 | 2 |
| sluttiness | 26 | 5 | 5 | 6 | 6 | 4 |
| submission | 30 | 3 | 11 | 10 | 3 | 3 |
| suggestibility | 26 | 5 | 10 | 7 | 3 | 1 |
| worship | 23 | 4 | 3 | 8 | 6 | 2 |

**Reading this table as a work order:** the `extreme` column is the thinnest across the
board (11 of 22 themes hold ≤2), and `deep` is nearly as thin. Those are exactly the cells
the gaussian dwells in at peak, for up to 18 consecutive steps, needing 3 distinct lines per
step. **The extreme and deep columns are where Phase B's volume is actually needed.**

### 2.2 Two new themes Phase B must author from nothing

**[MEASURED]** All 22 existing themes are *going-under* themes. There is no induction
content and no wakener content anywhere in the corpus.

| theme | role | why it cannot be improvised |
|---|---|---|
| `induction` | plays the first ~10% of every session; removed from the titration pool entirely | Improvising it from quiet `acceptance`/`blank`/`focus` lines was considered and rejected: those are conditioning themes that happen to be gentle, not content about *entering* trance. |
| `emergence` | plays the last ~10% of every session; removed from the titration pool entirely | **The engine cannot plan a session without it.** The phase-bookend mechanism exists to prevent the documented "Wide awake, rested and present" firing at line 2, and it has nothing to draw from. |

**These are Tranche 0 and they are authored FIRST.** They are also the only batches with
**no exemplars, no `generation` profile, and no few-shot grounding in the existing corpus** —
which are precisely the conditions under which LLM output drifts off-voice. Therefore:

> **`induction` and `emergence` are hand-authored or reviewed by hand line by line, before
> any other batch runs.** Everything else in Phase B has 612 records of voice to imitate;
> these have none.

### 2.3 Expansion themes (Tranche 3, not required for 1.0)

**[MEASURED]** 12 `.json.draft` themes exist in `conditioner/mantras/` as a ready-made
expansion list, never loaded at runtime:

`confusion`, `internal_voice`, `looping`, `masochism`, `mindbreak`, `petplay_kitten`,
`petplay_puppy`, `pleasure`, `relaxation`, `toy`, `training`, `trusting`

Plus 9 themes named in `hypnoapp/docs/catalogs/catalog_v4.json` that have no pool
equivalent: `chastity`, `conditioning`, `dependency`, `emptiness`, `neediness`,
`relaxation` (overlaps the drafts), `ritual`, `surrender`, `trust`.

**[MEASURED]** catalog_v4's vocabulary overlaps the pool by only **9 of 22 themes (41%)**,
which is why it is Phase B *authoring input* and not a runtime scheduler (see `DESIGN.md`
§0.4). Its value here is that its 18 targets are named, defined and categorized theme
candidates with pre-authored progression arcs.

---

## 3. Volume targets

### 3.1 Where the number comes from

The target is derived from the triplet's arithmetic, not asserted:

```
distinct draws needed per tag per dwell = 3 channels x dwell_steps
gaussian dwell at peak, MEASURED        = up to 18 consecutive steps
-> a tag self-sufficient at max dwell needs >=54 records
```

**The floor is an ENGINE parameter, not a law.** It moves if the lane count or
the dwell curve moves, and every headroom figure quoted against it moves with
it. It is stated here so that a tag falling under it is a finding rather than a
surprise; it is not a number the corpus was designed backwards from.

There is no second dimension. An earlier version of this section derived a floor
per **(theme, tier) cell** and a lower "widening suffices" threshold beneath it.
Tier was derived from `base_points`, `base_points` MEASURED as a reproduction of
the batch filename on 2,461/2,461 generated records, and a floor computed per
cell of a fabricated axis is a floor computed against nothing. A tag is a flat
member of one namespace and the floor applies to it directly.

### 3.2 Status

Phase B is **complete**. The tranche table that stood here described a campaign
that has finished: T0 bookends authored, person variants backfilled, T2
generation run. What replaced it as the live gate is the per-tag floor above,
printed by `corpus:report`, which every tag currently clears.

Generation against a deficit is therefore no longer the working mode. If the
vocabulary should grow, the corpus must grow first: a new tag is only viable
when the content to support it exists, and splitting an existing tag below the
floor is the exact failure the floor exists to prevent.

---

## 4. Person-variant templating rules

This is the heart of the contract and the source of the corpus's hardest correctness
problem.

### 4.1 Every record carries all three variants, always

```jsonc
{
  "first":  "My body moves before I decide to",
  "second": "Your body moves before you decide to",
  "named":  "{subject}'s body moves before {subject} decides to"
}
```

**HARD — all three are required on every record, even when identical.** They must each be
grammatically correct and independently readable as a standalone line.

**Why authored and not transformed at runtime:** the only runtime conjugator in the
ecosystem is structurally broken (`template-renderer.ts:171-193` uses `indexOf`, so multiple
bracketed verbs resolve against the first prefix, and it runs *after* variable replacement so
its checks can never match). A bad authored variant is a diffable line a human or a lint rule
catches before ship. A bad runtime variant appears mid-session in front of a user. This is
the bet the whole design rests on.

### 4.2 The four stances

`markers.pov` records the stance of the **stored `text`**, which is the canonical member of
the variant set.

| `pov` | definition | today | example |
|---|---|---:|---|
| `first` | a 1st-person pronoun, no `{subject}` | 272 | "My thoughts are being reprogrammed" |
| `named` | `{subject}`, no 1st-person pronoun | 253 | "{subject} does anything for {operator}'s pleasure" |
| `impersonal` | no grammatical subject at all | 87 | "Resistance melts away with each breath" |
| `second` | a 2nd-person pronoun | **0** | "Your thoughts are being reprogrammed" |

**`mixed` is not a value.** **[MEASURED]** zero of 612 records need it — conditioner's
"don't mix voice frames within one mantra" doctrine is perfectly obeyed across the whole
corpus — and forbidding it keeps the person transformation total.

**`pov` is derived by the ingester, never authored by the generator.**

### 4.3 The invariant case

**[MEASURED]** 87 records (14.2%) are person-free process voice: their 1p/2p/3p renderings
are byte-identical. For these, emit the same string three times. The ingester sets
`invariant: true` (computed, never authored).

**Do not over-generate this class.** An earlier proposal set a floor of ≥25% of new content
on the grounds that invariant records are "free triplets." They are not free: under the
engine's `unison` mode an invariant mantra renders as three byte-identical strings across
the screen, which reads as a rendering bug rather than emphasis. The engine refuses and
redraws such steps, and it gives person-free records a specific scheduled job at the person
drift's midpoint (`DESIGN.md` §4.6).

> **Target the impersonal share at 12–18% of new content — roughly its natural rate.**
> **REVIEW** if a batch exceeds 25%.

### 4.4 Conjugation rules — where "she obey" is prevented

**HARD — third-person verb agreement must already be correct in the `named` string.**
"{subject} obeys", never "{subject} obey". This is the single place the conjugation problem
is solved, and it is solved at authoring time where errors are cheap.

**[MEASURED]** from the live corpus, the transforms that actually matter:

```
after {subject}:  is 52 · has 10 · exists 9 · cannot 7 · enjoys 6 · craves 6 · feels 5
after bare "I":   am 41 · exist 7 · want 4 · can 4 · cannot 4 · crave 3 · need 3
possessive "{subject}'s": 59 of 253 named-self records
```

The copula alone accounts for **41 of 103** first-person verb occurrences and **52 of 253**
named-self ones — the highest-frequency transform, and exactly the one a naive `s`-suffix
rule gets wrong. The closed set that must be right:

| 1st person | 2nd person | 3rd person (`named`) |
|---|---|---|
| I am | You are | {subject} is |
| I have | You have | {subject} has |
| I do | You do | {subject} does |
| I don't | You don't | {subject} doesn't |
| I aren't (n/a) | You aren't | {subject} isn't |
| I crave | You crave | {subject} craves |
| I obey | You obey | {subject} obeys |

### 4.5 `{operator}` is never person-shifted

**HARD.** The operator is always referenced in the third person, in all three variants,
identically. A mantra's person axis describes the *subject*, never the operator.

```jsonc
{
  "first":  "I kneel when {operator} speaks",
  "second": "You kneel when {operator} speaks",
  "named":  "{subject} kneels when {operator} speaks"
}
```

### 4.6 Bare third-person pronouns are forbidden in `named`

**HARD.** `named` uses `{subject}` and never a bare `she`/`he`/`they`, so the line always
renders as the user's chosen name. "She sinks deeper" is a rejection; "{subject} sinks
deeper" is correct.

### 4.7 Placeholders: exactly two, bare form only

**HARD.** `{subject}` and `{operator}`. Nothing else.

- No `{subject_subjective}`, `{subject_possessive}`, or any other expanded placeholder.
- No `[verb|verbs]` bracket grammar in the **output**. It is permitted as a generation
  *intermediate* and must be expanded before emission — the runtime never sees a bracket.
- **No format specs or conversions.** `{subject:>4096}` passes a naive format probe and then
  blows past output limits. It is an attack, not a typo.
- Braces must be balanced.

---

## 5. Markers, tiering and the record shape

### 5.1 Marker rules

| marker | rule |
|---|---|
| `has_operator` | **Mechanical.** `"{operator}"` appears in the text. Computed by the ingester, not authored. **This is a live consent filter** — a user who has turned operator mantras off must never see one. |
| `has_subject` | **Mechanical.** `"{subject}"` appears in the text. Computed, not authored. |

Those are the only two. Both are substring tests against the text they
describe, which is what makes them incapable of drifting from it.

### 5.2 Three marker slots that were deleted

`permanence` and `identity` were reserved schema slots, always written `false`.
MEASURED: `true` on **0 of 2,639 records**. A constant is not data, and a
reserved slot that nothing populates is a field every reader has to learn about
and no reader can use.

The section that stood here argued at length against having an LLM classifier
populate them — correctly, since a mass-rejection rule built on subjective
classification either mass-rejects legitimate records or silently never fires.
The argument was right and the conclusion was one step short: the answer was to
delete the slots, not to leave them empty.

`pov` was deleted for a different reason: it is not empty, it is **redundant**.
It is 100% recomputable from `text` by `derivePov`, its `second` value had zero
instances, and its one load-bearing distinction — person-free, meaning a record
can serve a side lane without exposing the person axis — is already stored as
`persons[id].invariant`. Recomputing it is also strictly stronger than reading
it: the sidecar integrity check now validates each record against its own text
rather than against a stored opinion about its text.

**The permanence doctrine survives, as a lexical gate with no classifier in the
rejection path:**

> **HARD — permanence vocabulary (`forever`, `permanent`, `permanently`, `never
> again`, `for good`, `irreversible`, `can never`) is rejected outright.**

It used to be legal at `extreme` tier. A blind quality tournament then measured
this word list as the strongest quality signal in the corpus, and negative: 0%
of S-rated lines, 48% of F. The word asserts durability instead of producing an
image, and it breaks trance by inviting the reader to evaluate a claim. There is
no tier at which that is good writing, and there is no longer a tier.

### 5.3 There is no intensity axis

`base_points` and the five-rung tier ladder derived from it are **deleted**, from
the schema and from the data.

MEASURED: `base_points` reproduced the batch filename on 2,461/2,461 Phase B
records — 37 distinct values carrying zero information, inherited from a Discord
points economy this app does not have. Tier was derived from it, so a stored or
compared tier was a value derived from a fabricated one.

The scoring heuristic that produced those numbers (base 20; `{operator}` +20;
permanence +60; and so on) is deleted with them. Deleting the output while
keeping the generator invites regeneration.

The consequence that mattered most was a consent defect: the user-facing
intensity cap compared records **by index into the tier ladder**, so a user who
set a ceiling was protected by a number invented from a filename. The cap is
deleted and `excludedThemes` is promoted to the primary consent surface in the
same change, so consent never regresses through an intermediate state. Heavy
register is served by the flat `intense` tag, which a user excludes like any
other tag.

### 5.4 Themes on a record

**HARD.** At least one. **Cross-tagging is encouraged.** **[MEASURED]** the max themes on
any existing record is **1**, so the multi-tag path the inverted pool bought is entirely
unexercised. It matters because exclusions are checked against a mantra's *full tag list*
rather than the bucket it was collected under — which is live consent machinery the moment a
genuinely cross-tagged mantra exists.

### 5.5 No `id` from the generator

**HARD.** Ids are assigned by the ingester (§6). A generator that emits an `id` has its
record rejected. Ids are opaque thereafter; **[MEASURED]** only 138 of 612 round-trip to a
naive text slug, so nothing may reconstruct an id from text at read time.

---

## 6. Output file format

### 6.1 What the swarm emits

**One JSONL file per batch** at `corpus/raw/<theme>.<batch>.jsonl`.

**JSONL, not a JSON array** — one malformed record from the swarm loses one line, not the
whole batch. Line 1 is a header object; every subsequent line is one record.

```jsonl
{"schema":"hypnoapp.corpus.v1","theme":"obedience","generator":{"model":"grok-…","prompt_sha":"…","generated_at":"2026-08-08T12:00:00Z","batch":"obedience.003"}}
{"first":"My body moves before I decide to","second":"Your body moves before you decide to","named":"{subject}'s body moves before {subject} decides to","themes":["obedience"]}
{"first":"I stop checking whether I agree","second":"You stop checking whether you agree","named":"{subject} stops checking whether {subject} agrees","themes":["obedience","submission"]}
```

### 6.2 Field contract

| field | rule |
|---|---|
| `first` / `second` / `named` | **HARD.** All three required, always. Grammatically correct, independently readable, §4's rules applied. |
| `themes` | **HARD.** ≥1. Cross-tagging encouraged. |
| `markers` | Optional and empty. `has_operator` and `has_subject` are **derived** and rejected if present; no other marker exists. |
| `id` | **HARD — must be absent.** |

### 6.3 What the ingester produces

Three files, keyed by the opaque id. The pool stays **byte-compatible with conditioner's
schema** so regeneration from upstream stays a straight copy:

```
corpus/pool.json        conditioner's exact shape: { mantras: [...], theme_descriptions: {...} }
corpus/persons.json     { [id]: { first, second, named, invariant } }
corpus/provenance.json  { [id]: { source, batch, model, generated_at, reviewed } }
```

**Sidecar integrity invariant, enforced at emission and again at load:**

> `persons[record.id][record.markers.pov] === record.text`

The canonical text is not a separate thing from its variant set; it is the member named by
`pov`. Without this the sidecar can silently drift from the pool it keys into.

**Provenance protects the originals.** When a bad batch ships an off-voice theme or a
mis-conjugated variant family, partial rollback is a one-line filter rather than a re-run of
everything — and the 612 hand-authored originals (`source: "conditioner-pool"`) are never
touched.

---

## 7. Dedupe rules

| # | Rule | Action |
|---|---|---|
| D1 | Exact-normalized duplicate (whitespace collapsed, casefolded) against the existing pool, checked across **all three variants** | **HARD** — drop, log the colliding id |
| D2 | Exact-normalized duplicate **within** the batch | **HARD** — keep the first, drop the rest |
| D3 | Near-duplicate: Levenshtein distance < 15% of length | **REVIEW** — reported, never auto-dropped |
| D4 | Same record emitted under two themes | Not a duplicate — it is **cross-tagging**. Merge into one record with both tags. |

A collision on *any* of the three variants drops the record. Two mantras that differ only in
first person but collide in third person would render identically on a side channel.

---

## 8. Validation gates

The ingester **rejects, never repairs**. Order matters: structure, then person correctness,
then content quality, then dedupe, then id assignment.

### 8.1 Structural (HARD)

1. Valid JSONL; the header line conforms; every required field present and correctly typed.
2. Only `{subject}` and `{operator}`, bare form only; **format specs rejected**; braces
   balanced.
3. No `id`; no derived markers (`has_operator`, `has_subject`).

### 8.2 Person correctness — the gates that protect the product

A single visible grammar error ends the session for the user, so this is the highest-stakes
validation in the pipeline. It runs as **three precision-first layers**, and everything the
layers cannot *confirm* is routed to a review queue rather than silently passed.

**The verb table, and why the obvious gate was not built.** **[MEASURED]**
`hypnoapp/lib/tts/verb-conjugations.ts` holds **158 pipe-delimited entries**, 157 unique
first-forms, with exactly one conflicting duplicate (`have|has|has` vs
`have|have|have|has` — **keep `have|has|has`, dedupe before use**). Checked against every
token governed by `{subject}` or bare `I` in the live corpus, it covers **214 of 351 tokens
= 61%**, and the uncovered residue is mostly *not verbs* — `mind`, `body`, `identity`,
`soul`, `thoughts` are nouns after a possessive, and `cannot`, `would`, `just`, `only` are
modals and adverbs. **A gate that flagged "every verb governed by the subject" would carry a
~39% false-positive rate and be switched off within a day.** Hence:

| layer | mechanism | catches | precision |
|---|---|---|---|
| **L1 — agreement triple** | Align `first` and `named` token-wise. Where they differ at exactly one position and both forms appear in the *same* table entry (`crave\|craves`), the pair is **confirmed correct**. Where the `named` form equals the **bare stem** of a table entry that requires an inflected form, it is a **HARD error**. | The exact "she obey" family | ~100% — only fires on table-confirmed stems |
| **L2 — copula / auxiliary** | Closed set from §4.4: `am`↔`are`↔`is`, `have`↔`has`, `do`↔`does`, `don't`↔`doesn't`, `aren't`↔`isn't`. **HARD** on mismatch. | The highest-frequency transform, and the one a naive `s`-suffix rule gets wrong | 100% |
| **L3 — stance checks** | `named` contains `{subject}`, no 1st-person pronoun, **no bare `she`/`he`/`they`**. `second` contains a 2nd-person pronoun, no 1st-person pronoun, no `{subject}`. `first` contains a 1st-person pronoun and no `{subject}`. **Skipped entirely when all three variants are identical (the invariant case).** | Stance leakage between variants | 100% |

**Every batch report prints its machine-verified coverage**: *"N records fully
machine-verified, M routed to review."* Human review is then spent on the residue rather
than on a random sample. The review queue must reach zero before ship.

This is honestly short of proving 13,000 strings correct. It replaces an unbounded sampling
problem with a bounded queue and a published number, which is the best available gate.

### 8.3 Content quality (HARD unless noted)

5. No em dashes, no en dashes, no smart quotes, no trailing periods.
6. 3–15 words typical, **20 hard maximum**, per variant.
7. **Permanence vocabulary rejected outright** (§5.2).
8. **GPT-ism blacklist:** *delve, tapestry, symphony of, journey, beacon, vessel of*,
   adjective stacking, purple prose.
9. **Prompt contamination — REVIEW.** Distinctive words (length ≥4, non-stopword) from the
   prompt appearing in the output are reported per batch. High leakage means the model
   paraphrased the brief instead of writing content.

### 8.4 Id assignment and order

10. **Ids** are assigned by conditioner's exact slug algorithm
    (`scripts/migrate_mantra_pool.py:52-58`): alphabetic words only, placeholders stripped,
    first 6 words, lowercased, joined by `_`, collisions suffixed `_2`, `_3`. **Derived from
    the `first` variant**, so ids stay stable if other variants are later edited. Opaque
    thereafter.
11. **Order within a block is preserved exactly as generated — never sorted, never
    shuffled.** The corpus is order-dependent (meter and rhyme adjacency). The ingester
    appends only.
12. **Idempotence:** re-running the ingester over the same raw files produces a
    byte-identical pool. This is what makes Phase B resumable and its output reviewable as a
    diff.

---

## 9. Generation procedure

### 9.1 Prompt grounding — the highest-value asset in the ecosystem

Each grok call is seeded with three things:

1. The theme's `theme_description` from `pool.json`.
2. **The theme's `generation` block from the legacy per-theme `mantras/*.json` files** — 22
   hand-tuned LLM authoring profiles with good/bad exemplars and a
   distinguishing-from-neighbors note. These were *deliberately never migrated* into
   `pool.json` and are the single most valuable Phase B input available. Legacy per-theme
   files are an authoring corpus only and are never loaded at runtime.
3. Up to **8 existing pool mantras** for that theme as few-shot examples.
4. **The authoring brief** at `docs/v1/AUTHORING_BRIEF.md`, verbatim. MEASURED: lines
   written against it rated S or A at 37.8%, against 5.1% for the legacy pool authored
   without it.

`induction` and `emergence` have none of these (§2.2), which is exactly why they are
hand-authored first.

### 9.2 Invocation

**[MEASURED]** from `grok --help`: headless single-turn via `-p/--single`, with
**`--json-schema` constraining output to the record shape**. Constraining the schema is
strictly better than parsing prose for JSON and removes an entire class of Phase B failures.
`--output-format json` is implied by `--json-schema`.

**Batch size 15–20, parallelized.** **[MEASURED]** `generate.py` budgets ~80 tokens per
mantra capped at 4000, so batches above ~47 silently hit the cap and truncate.

### 9.3 Authoring doctrine — goes into every prompt verbatim

- **Prime Directive: "Show the experience. Never label the state."** ✗ "I am obedient" →
  ✓ "Commands drop straight into action." **Carve-out:** *confessions* are valid even though
  they look like labels, because saying them **is** the psychological act. The test: would
  saying this feel like *saying* something, or merely *describing* something?
- **Always emit all three grammatical persons.** This *replaces* hypnocli's "avoid second
  person" rule, which directly contradicts the brief's 2nd-person center channel. Everything
  else in that prompt survives.
- **Never reference "this voice" or "this recording."** That is what makes a mantra reusable
  across sessions and channels.
- **Four voice frames, never mixed within one mantra:** First Person, Named Self, Named
  Possessive, Process.
- 3–15 words typical, 20 max. A complete thought. Varied grammatical forms.
- **Rejected patterns:** hedged language ("starting to"), agentless passive ("Memories are
  deleted"), therapeutic framing ("healing", "anxiety", "self-improvement"), generic verbs,
  static descriptions, adjective stacking, purple prose.

---

## 10. Phase B acceptance

Phase B is complete for 1.0 when every row passes. These are the B-criteria from
`DESIGN.md` §9.

| # | Criterion |
|---|---|
| B1 | Every tag holds **≥54** records (3 lanes x an 18-step peak dwell). |
| B2 | Every record has all three person variants; `invariant` is computed correctly. |
| B3 | Every record's stance derives to one of the four; no record is mixed-stance. |
| B4 | The §8.2 conjugation gate passes with **zero** hard errors; the review queue is triaged to zero; the machine-verified coverage percentage is published in the ingest report. |
| B5 | The ingester is idempotent: re-ingest yields a byte-identical pool. |
| B6 | Zero lint errors across §8.1 and §8.3. |
| B7 | `induction` and `emergence` exist with ≥40 records each, **hand-reviewed** (T0). |
| B8 | Sidecar integrity: `persons[id][derivePov(record.text)] === record.text` for 100% of records. |
| B9 | Provenance present on every Phase B record; the original 612 carry `conditioner-pool` or `human` and are unmodified. |
| B10 | The impersonal share of new content is 12–18% (§4.3); a batch above 25% is reviewed. |
| B11 | `corpus:report` prints every tag against the floor, so a tag that cannot field a lane is machine-readable. |
