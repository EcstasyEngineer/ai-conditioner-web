# hypnoapp 1.0 — Final Architecture

**Status:** Phase A output, synthesized. Base proposal: `design-engine-first.md` (judge
winner). Grafts from `design-data-first.md` and `design-experience-first.md` are applied
inline and marked **[GRAFT: source §]**. Every risk named by the three judges is either
mitigated here or accepted with rationale in §12.

**Epistemic marking.** `[MEASURED]` = verified by executing code against live data during
Phase A synthesis. `[CITED]` = sourced from a recon spec. `[DECISION]` = a design choice.
`[ACCEPTED RISK]` = a known exposure taken deliberately, with the reason.

**Binding constraint.** The owner's five-point brief is the architecture. Where the brief
left something open, it is marked `[DECISION]`. §11 lists what was cut from the brief's
maximal reading.

---

## 0. The five measurements this design rests on

All re-verified during synthesis against the conditioner repo's `mantras/pool.json`
(612 records, 22 themes) and this repo.

### 0.1 The corpus partitions cleanly by grammatical person, with zero ambiguous cases

**[MEASURED]**

| Class | n | Definition |
|---|---|---|
| `first` | 272 (44.4%) | a 1st-person pronoun, no `{subject}` |
| `named` | 253 (41.3%) | `{subject}`, no 1st-person pronoun |
| `impersonal` | 87 (14.2%) | neither — "Resistance melts away with each breath" |
| `mixed` | **0** | — |
| `second` | **0** | — |

Two consequences:

1. **Zero mixed records.** Every mantra has exactly one grammatical stance, so a
   person-variant triple is a *total* transformation with no case needing
   hand-adjudication. Phase B is tractable.
2. **87 records are person-invariant.** Their 1p/2p/3p renderings are byte-identical.
   These are not a remainder — they are a first-class stance with a scheduled job (§4.6).

The zero-second-person finding is confirmed: **the center channel has no source material
and must be authored.** `permanence` and `identity` are `false` on all 612 — which is why
they are not fields (§2.2).

### 0.2 Per-(theme,tier) blocks are unserveable on today's corpus

**[MEASURED]** 110 of 110 (theme,tier) cells populated; **median cell 5**, min 1, max 16;
**19 cells hold ≤2**, **45 hold <5**. Theme-level blocks, by contrast, hold **19–35**.

recon-hypnocli §1.2 recommends synthesizing per-(theme,tier) blocks because
`generate.py:663-700` already emits that shape — "a drop-in port of proven behavior." That
is correct in the abstract and wrong for this corpus now. The triplet needs three distinct
lines per step, and the gaussian dwells ~16 consecutive steps at peak intensity. The
arithmetic wall:

```
required distinct draws per block = 3 channels × dwell_steps
dwell 6 → 18      dwell 12 → 36      dwell 18 → 54
median cell = 5   → saturates at dwell 2
```

recon-hypnocli §4.1 warns the Shuffler degrades toward LRU-with-random-ties when
`window >= n`, and judged that "unlikely to bite — hypnoapp's pool blocks will be much
larger than 5 lines." **[MEASURED] they are exactly 5.** It bites on the first session.

**[DECISION] A block is a THEME, and there is no second dimension.** §4.3. This is the
single decision that makes the engine buildable and testable against today's 612 records
with no dependency on Phase B.

The measurement above outlived the axis it was taken against. Tier was derived from
`base_points`, which MEASURED reproduces the batch filename on 2,461/2,461 generated
records, so the cells this section rejects as too thin were also cells of a fabricated
axis. Both readings reach the same place: blocks are themes.

### 0.3 The gaussian schedule ports verbatim and produces the right arc

**[MEASURED]** running hypnocli's real `plan_theme_schedule('gaussian', …)` over blocks
built from the live pool, 4 themes, length 60:

```
2222222222 3333333 444444 5555555555555555 444444 3333333 2222222222
```

Build, plateau, wean. recon-hypnocli §4.5's headline negative result stands: `dsm` was
removed after losing to gaussian **on every seed** in a 30-rater, 6-dimension blind study.
Ship gaussian. Do not build a cleverer scheduler.

### 0.4 catalog_v4 covers 41% of the pool's themes — **[GRAFT: data-first §1.4]**

**[MEASURED]** catalog targets 18, pool themes 22, **in both: 9**. Thirteen pool themes —
including the highest-volume `brainwashing` (35) and `bimbo` (30) — have **no edge in the
DAG at all**.

recon-hypnoapp §6.6 calls catalog_v4 "the sleeper hit… the missing which-theme-next model."
That is a fair description of the artifact but the vocabularies do not line up. A runtime
DAG would work for 41% of themes and silently no-op for the rest, which is exactly the
half-working behavior consent-adjacent software must not ship. **[DECISION] catalog_v4 is
out of 1.0 runtime scope and is Phase B authoring input.** 1.1 starts from *vocabulary
reconciliation*, not from adoption. The coverage number is recorded here so the deferral
has a reason rather than a vibe.

### 0.5 The salvageable conjugation table is 158 entries and covers 61% of the corpus

**[MEASURED]** `hypnoapp/lib/tts/verb-conjugations.ts` holds **158 pipe-delimited
entries**, 157 unique first-forms, with exactly one conflicting duplicate:
`'have|has|has'` and `'have|have|have|has'`.

Checked against every token governed by `{subject}` or bare `I` in the live pool: **351
tokens, 214 covered = 61%**. The uncovered residue is mostly *not verbs* — `mind`, `body`,
`identity`, `soul`, `resistance`, `thoughts` are nouns following a possessive, and
`cannot`, `would`, `just`, `only` are modals and adverbs.

This directly reshapes the judges' highest-severity graft (§7.4). A gate that flags "every
verb governed by the subject" against this table would produce a **39% false-positive
rate** and be switched off within a day. The gate must be built as a **high-precision
subset check**, not a coverage check. §7.4 specifies it that way.

---

## 1. Stack

### 1.1 The decision

> **TypeScript, one package, two layers: a pure `engine/` core with zero platform
> imports, and a `web/` shell that is Vite + React with raw DOM/rAF rendering for the
> three lanes. Vitest for tests. No backend, no database, no server, no second
> language on the critical path.**

The stack choice that matters is not React vs Svelte. It is this:

**[DECISION] The engine is a pure, synchronous, deterministic, dependency-free TypeScript
library that produces a fully-materialized `SessionPlan` before a single pixel is drawn.
The renderer is a function of `(plan, elapsedMs) → FrameState`. The UI is a form that
produces a config object.**

That constraint delivers:

- The triplet grammar and pacing model are testable in Node with no DOM, no timers, no
  canvas, no audio, no React.
- A session is reproducible from `(config, seed)` — hypnocli's determinism contract
  [CITED recon-hypnocli §6.5], which is what made its blind rater study possible.
- Every scheduling bug is reproducible from a seed in a unit test rather than by watching
  a spiral for eight minutes.

### 1.2 Why TypeScript

| Alternative | Why not |
|---|---|
| **Python** (hypnocli's language) | The deliverable is a thing a person sits in front of for 20 minutes. Python means a server, hosting, and a 1.0 that is an ops project. Also forces two languages, since rendering is unavoidably browser-side. |
| **C++** (trance's language) | Port cost with no payoff. trance is C++ because it is a fullscreen SFML/VR player doing per-frame GPU work. hypnoapp renders *text*. The v3 ideas being taken are language-neutral [CITED recon-trance §9.1]. |
| **Rust + WASM** | Every session artifact is JSON; every hot path picks a string from an array ~20×/minute. Zero performance argument, and it fights the "engine is trivially hackable" goal. |
| **Next.js** | Rejected by the brief, and **[MEASURED]** the repo still carries Prisma/NextAuth fossils from that era. Reintroducing it reopens a grave. |
| **Vanilla, no framework** | Defensible — the UI is thin. But the theme-selection panel is a *live-feedback* surface where every mutation re-renders counts, per-tag breakdowns and a rendered triplet sample. That is what a reactive view layer is for. |
| **Svelte / Solid** | Better fit on the merits. Rejected because the view layer is the least important decision here and should therefore be the most boring one. React 19 is already installed and the whole UI is ~6 components. |

**Vite is retained as a build tool, not as an architecture.** The brief's "not Vite by
default" rejects *inheriting the incumbent app's architecture*, which this design discards
wholesale. Keeping the bundler is not keeping the architecture.

**[DECISION] One language on the critical path.** The ingest toolchain is TypeScript, run
under Node — *not* Python. Two validators in two languages means the corpus contract is
enforced twice with no shared source of truth, and schema drift produces records that pass
ingest and fail at load. One schema module (M1), imported by both the ingester and the
runtime loader. This resolves a judge risk directly.

### 1.3 What the engine may import: nothing — **[GRAFT: experience-first §9.2]**

**[DECISION]** `engine/` has a hard rule enforced by a CI lint check:

- No imports from `web/`, no DOM types, no `window`, no `fetch`, no `Date.now()`, no
  `Math.random()`, no Node builtins.
- Time enters only as an explicit parameter. Randomness enters only as a seeded RNG.
- The engine is `"sideEffects": false` and imports **zero** third-party packages.

**The Node-only firewall is written down, not assumed.** The ingest toolchain (`tools/`)
has its own `tsconfig.tools.json` entry point and is **excluded from the browser
tsconfig's `include`**. The named failure mode already exists in this repo: **[MEASURED]**
`lib/pattern-compiler/loaders.ts:8` imports Node `fs`, calls `process.cwd()` at lines
34–35, and `index.ts:112` re-exports it from the browser barrel. It only survives because
`src/` never imports it. Since M5 is TypeScript rather than Python, this hazard is live
again by construction and the rule is mandatory.

**`Math.random()` is banned engine-side.** **[CITED recon-hypnoapp §5.6]** the incumbent
`generatePlaylist` shuffles with `sort(() => Math.random() - 0.5)` — a biased shuffle —
while a correct Fisher-Yates already existed in `sources.ts:60` in the same repo. One
seeded RNG (mulberry32), one shuffle, one place.

### 1.4 Audio: deferred, with the seam pre-cut

**[DECISION] 1.0 ships the salvaged isochronic drone and no Strudel.**

- **Strudel is AGPL-3.0** against a **public MIT repo** (**[MEASURED]** `isPrivate: false`).
  The spec's AGPL carve-out was written for trance's C++ binary and does not transfer. That
  is a real licensing decision and not one to make as a side effect of a 1.0 sprint.
- The `#66` spec's own v0 staging is *offline render*, explicitly keeping Strudel out of
  the shipped artifact. Following the spec's own staging is conservative and
  licensing-safe simultaneously.
- `lib/drone.ts` is the highest-confidence lift in the repo [CITED recon-hypnoapp §5.1]: a
  correct Web Audio isochronic drone with a frequency-independent 180° phase offset. In
  hypnoapp there is no trance, so **this drone is the entrainment bed**.

`AudioBed` is an interface with one implementation (`DroneBed`); the plan carries
`bed: { preset, gainDb }` it does not yet vary. Adding a Strudel bed later is implementing
an interface, not a refactor. The known start/stop race at `drone.ts:117` is fixed on lift.

**Autoplay policy is structurally handled:** the bed starts on the Begin gesture, which is
a user gesture. Silence-with-no-explanation cannot happen.

### 1.5 Repo hygiene is a real module that lands first — **[GRAFT: engine-first M0, endorsed by judge 2]**

**[MEASURED] this session**, all four traps are live:

- Local `main` is **5 commits behind `origin/main`** with rewritten SHAs.
- `.github/workflows/ci.yml` carries **5 `continue-on-error: true` steps** — a green check
  is not a signal.
- The `loaders.ts` Node-`fs` leak through the browser barrel (§1.3).
- `src/routes/Player.tsx:75` drives playback from a hardcoded `setInterval`.

Each silently corrupts every other agent's work if present when they branch. M0 clears all
of it, alone, before the swarm launches.

---

## 2. Data model

### 2.1 The pool is conditioner's, unchanged

The brief mandates conditioner's schema. **[DECISION] hypnoapp adopts it byte-compatibly
and adds nothing to the record shape.** The five fields stay exactly five fields. What
changes is that `markers.pov` — reserved, `null` on all 612, with no enum defined anywhere
[CITED recon-conditioner §1.4] — gets an enum and gets populated.

```jsonc
{
  "id": "resistance_melts_away_with_each_breath",   // opaque, stable, the only reference key
  "text": "Resistance melts away with each breath", // RAW TEMPLATE, never rendered at rest
  "themes": ["submission"],                          // tags; N of them, one flat namespace
  "markers": {
    "has_operator": false,   // mechanical: "{operator}" in text
    "has_subject": false       // mechanical: "{subject}" in text
  }
}
```

Rules carried verbatim [CITED recon-conditioner §3 "Take unchanged"]:

- **`id` is opaque.** Only 138/612 round-trip to a naive text slug. **No module exports a
  `textToId` function**, so no code can reconstruct an id from text at read time.
- **`text` is a raw template; substitution happens at display time**, never at selection or
  storage time. Renaming an operator retroactively re-renders even in-flight content.
- **There is no intensity field and no tier ladder.** `base_points` MEASURED as a
  reproduction of the batch filename on 2,461/2,461 generated records — 37 values carrying
  zero information, inherited from a Discord points economy this app does not have. Tier
  was derived from it, so an ordering built on it ordered nothing. Both are deleted, and
  with them the user-facing intensity cap that compared records by index into the ladder:
  a consent control whose authority came from a filename. Heavy register is served by the
  flat `intense` tag, excluded like any other tag (§2.6).
- **Multi-tag is the design intent** even though today's data is single-tag (**[MEASURED]**
  max themes on any mantra = 1). It is what buys the cross-tag exclusion fix (§2.6), which
  is live consent machinery the moment Phase B emits a cross-tagged mantra.

### 2.2 The stance of a template — derived, not stored

**[DECISION]** `pov` is the *stance of the stored template*, not the person it renders in,
and it is **computed from the text at load** rather than carried as a field:

| value | meaning | n today |
|---|---|---|
| `"first"` | "My thoughts are being reprogrammed" | 272 |
| `"named"` | named-self / 3rd person via `{subject}` | 253 |
| `"impersonal"` | no grammatical subject; person-invariant | 87 |
| `"second"` | "Your thoughts are being reprogrammed" | **0 — Phase B creates it** |

Deliberately **not** a value: `"mixed"`. **[MEASURED]** zero records need it, and
forbidding it keeps the transformation total.

`"named"` rather than `"third"` preserves conditioner's own coined term for the voice frame
(`THEME_GUIDELINES.md`'s "Named Self"), per the house rule about preserving domain
vocabulary. The renderer knows `named` renders *as* 3rd person.

**Storing the stance was the mistake, not deriving it.** It is 100% recomputable, its
`second` value had zero instances, and its one load-bearing distinction — person-free — is
already carried by `persons[id].invariant`. Deriving is also strictly stronger: the sidecar
integrity check now validates a record against its own text rather than against a stored
opinion about its text, so a wrong stance is unrepresentable instead of merely unlikely.

**`permanence` and `identity` are not fields either.** They were reserved slots, always
`false`, MEASURED `true` on **0 of 2,639 records**. An earlier design populated them via
LLM judgment and built a hard ingest rejection on top; that was correctly refused, because
a mass-rejection rule on subjective classification either mass-rejects legitimate records
or silently never fires. The refusal stopped one step short — the answer was to delete the
slots. §7.5 enforces the permanence doctrine lexically, with no classifier in the rejection
path. The `markers` object remains open for hypnoapp#60's tone tags as an additive key.

### 2.3 The person triple — a sidecar, not a schema change

The one genuinely new structure, keyed by id:

```jsonc
// persons.json  —  { [mantraId]: PersonTriple }
"my_thoughts_are_being_reprogrammed": {
  "first":  "My thoughts are being reprogrammed",
  "second": "Your thoughts are being reprogrammed",
  "named":  "{subject}'s thoughts are being reprogrammed",
  "invariant": false
}
```

**[DECISION] Sidecar, not inline. Pre-rendered, not computed at runtime.** Four reasons,
each tied to a named failure:

1. **The pool stays a byte-valid conditioner pool.** Regeneration from upstream
   ([CITED recon-hypnoapp §11.2]: hypnoapp's copy is a verified stale duplicate and must be
   *regenerated*, not migrated) stays a straight copy.
2. **Runtime conjugation is the known-broken path.** **[CITED recon-hypnoapp §5.2]**
   `template-renderer.ts:171-193` is *structurally* broken: `indexOf` means multiple
   bracketed verbs resolve against the first prefix, and it runs *after* variable
   replacement so its `endsWith` checks can never match. **[CITED recon-hypnocli §10.2]**
   without conjugation you get "she obey". Both vanish if the three forms are authored.
3. **It makes person a data-quality problem, which is auditable.** A bad conjugation is a
   diffable line a human or a lint rule catches before ship. A bad runtime conjugation
   appears mid-session in front of a user.
4. **It removes the `{subject_subjective}`/`[verb|verbs]` grammar from the runtime
   entirely.** The richer grammar's only job is turning one string into three persons, and
   pre-rendering does that at authoring time where errors are cheap. It is used **inside
   Phase B** as a generation intermediate and discarded before anything reaches the pool.
   Runtime keeps exactly two bare placeholders, which is what 100% of the corpus uses.

**Sidecar integrity invariant — [GRAFT: data-first §3.3 R1, restated for the sidecar
shape].** The sidecar keys into the pool and could silently drift from it. Therefore, as a
**hard ingest check and a load-time assertion**:

> `persons[record.id][record.markers.pov] === record.text`

The canonical text is not a separate thing from its variant set; it is the member of the
set named by `pov`. One line, checkable in CI, and it makes the sidecar structurally unable
to drift from the pool it references.

`invariant: true` is set exactly when all three strings are equal. It is **computed at
ingest, never authored**, and it is what lets side channels use a mantra without exposing
the person axis (§4.6).

### 2.4 Placeholder substitution — display time, two placeholders, hardened

Ported from `conditioner/utils/mantras.py:153-162`: substitute `{subject}`/`{operator}`,
then capitalize the first letter if lowercase. Two hardening rules carried deliberately:

- **Format specs and conversions are rejected**, not just unknown fields
  (`utils/custom_mantras.py:92-110`). `{subject:>4096}` passes a naive `.format()` probe and
  then blows past output limits. The named failure is a user-authored mantra DoS'ing the
  renderer.
- **Substitution never throws.** `_safe_format` falls back to the raw template on any error
  (`cogs/dynamic/mantras.py:125-131`). A malformed mantra degrades to showing its template,
  never to a blank screen or a crash mid-session.

### 2.5 Provenance — **[GRAFT: data-first §3.6]**

```typescript
interface Provenance {
  source: 'conditioner-pool' | 'grok-phase-b' | 'human';
  batch?: string; model?: string; generated_at?: string; reviewed?: boolean;
}
```

Stored in a **third sidecar** (`provenance.json`), not on the record, so §2.1's
byte-compatibility holds. Phase B mass-generates thousands of records; when a bad batch is
found — an off-voice theme, a mis-conjugated variant family — partial rollback must be a
one-line filter rather than a re-run of everything, and the 612 hand-authored originals
must be protected absolutely. Optional, ignored at runtime, never rendered.

### 2.6 Consent filters — ported with their failure semantics intact

**[CITED recon-conditioner §1.6]**, a *behavioral* contract, not a UI one:

**Consent boundaries — never silently relaxed. If they empty the pool, the slot starves.**
1. **Excluded themes — the primary consent surface.** Checked against the mantra's **full
   pool tag list**, not the bucket it was collected under. This closes the cross-tag leak
   where a mantra tagged `{A,B}` reaches a user enrolled in A who wants nothing from B.
2. Operator toggle, on `markers.has_operator`.

**Preference — dropped as a last resort rather than starving.**
3. Blocklist by id.

**An intensity cap used to sit at position 1, and it was a live safety defect.** It
compared records by index into a tier ladder derived from `base_points`, and `base_points`
MEASURED reproduces the batch filename on 2,461/2,461 generated records — so a user setting
a ceiling was protected by a filename. It is deleted, and exclusion is promoted in the same
change so consent never regresses through an intermediate state. Exclusion can carry the
load because the vocabulary was built for it: heavy register is the flat `intense` tag, so
"nothing absolute or permanent" is an exclusion like any other rather than a rung on a
ladder. MEASURED across all enroll x exclude pairs, no enrollable tag falls below the
54-record floor.

**Ordering is normative**: consent first, blocklist second. Empty after consent ⇒ skip.
Empty after blocklist ⇒ ignore the blocklist.

**[DECISION] "Starve" is stronger here than in conditioner.** conditioner skips one
delivery; hypnoapp is building a 20-minute continuous session, so a starving slot cannot be
skipped silently 400 times:

> **The session plan is fully materialized before playback starts, and any consent filter
> that would starve a step is a hard planning error — surfaced in the UI before the session
> begins, never at runtime.**

The engine has the whole session in hand at plan time; conditioner does not. This is
strictly better than the source behavior.

---

## 3. The layer cake

```
                       ┌────────────────────────────────────────────┐
   config (UI)  ───────▶│  PLANNER      pure, seeded, no time        │
                       │  corpus + config + seed  →  SessionPlan     │
                       └────────────────────┬───────────────────────┘
                                            │  SessionPlan (plain JSON, serializable)
                       ┌────────────────────▼───────────────────────┐
   elapsedMs ─────────▶│  CONDUCTOR    pure, owns no clock          │
                       │  (plan, elapsedMs)  →  FrameState          │
                       └────────────────────┬───────────────────────┘
                                            │  FrameState (3 channels + bed + progress)
                       ┌────────────────────▼───────────────────────┐
                       │  RENDERERS    impure, platform-bound       │
                       │  TextRenderer · Backdrop · AudioBed        │
                       └────────────────────────────────────────────┘
```

Three properties are load-bearing:

1. **`SessionPlan` is a serializable value** — diffable, snapshot-testable, dumpable to a
   file, replayable, shippable in a URL. Every scheduling test asserts on a plan, never on
   a rendered frame.
2. **The Conductor owns no clock.** Tests call it with `elapsedMs = 0, 100, 200, …`. The
   browser calls it from `requestAnimationFrame`. Neither knows about the other.
3. **This is trance's schedule/render split**, which **[CITED recon-trance §9.1]** names
   "the single best idea here," moved one stage earlier because hypnoapp — unlike trance —
   knows the whole session in advance.

**[DECISION] hypnoapp plans the whole session up front; trance and hypnocli both decide
incrementally.** This is the biggest departure from both references and it is what the
visual medium buys. **[CITED recon-hypnocli §5.4]** hypnocli's equalization pass 2, the
`cap = tit_mid*2` headroom, the cap-invariance contracts and the split `seed`/`seed+1`
streams exist *only* because spoken line duration is unknown until after TTS. With a
**chosen** visual dwell, all of it evaporates — five pieces of machinery deleted by one
decision.

### 3.1 The timeline IS the content register — **[GRAFT: data-first §6.2, verbatim framing]**

**[CITED recon-trance §7]** proves the triplet is *unreachable* in v3 as it stands, for
four independent reasons: only two content pools ever exist; **text content is not
addressable at all** (`Op::Text` carries no content field, and the grammar has no string
literals); no person templating anywhere; and `chance` takes a literal float so probability
cannot ride a curve. **[CITED recon-trance §8.2]** names the fix as trance's own deferred
Extension #4 and says hypnoapp "must build Ext#4; it is not optional."

In this architecture it is not an extension at all:

> **The timeline is the content register.** The renderer's grammar controls *timing,
> geometry, and prominence*. It never controls *which mantra*. That is already decided, by
> the planner, before a frame is drawn.

A `TripletTick` carries its content **by value**, so content addressing is solved by
construction and every channel has alpha. This is the clearest statement of how the brief's
"v3 grammar rendering triplets" is satisfiable at all given recon-trance's four blockers,
and it is why v3's four limitations are dissolved rather than worked around.

---

## 4. Session engine — render_session behavioral parity

The contract is to reproduce hypnocli's *listener experience*, not its code. §4.11 is the
parity checklist and the acceptance surface for M2.

### 4.1 Session shape

```
   [ INDUCTION HEAD ]  [ ————— TITRATED MIDDLE ————— ]  [ EMERGENCE TAIL ]
        ~10%                        ~80%                       ~10%
```

Each of the three channels gets its own line stream of exactly `length` steps. A step is
one triplet tick (§5.1).

### 4.2 Phase bookends — ported exactly, including the fix, excluding the bug

**[CITED recon-hypnocli §5.1-5.2]** calls this "the single most important design lesson in
this codebase," documented in the source three separate times:

> Intensity is a **scalar**; session position is a **direction**. A one-dimensional
> intensity model cannot distinguish "low because we're inducting" from "low because we're
> emerging" — so a symmetric bell makes the *emergence* block eligible at the **start**.
> The concrete artifact: "Wide awake, rested and present" firing at line 2. **Every rater
> caught it.**

Any scheduler built on tier alone reproduces this bug. The fix is structural and sits
*above* the mode:

1. Designated induction and emergence themes are **removed from the titration pool
   entirely**. Emptying the pool that way is a hard error.
2. `head = tail = max(1, round(length × 0.10))`, the pair capped at `length // 2` so the
   middle always survives. **[MEASURED]** from `render_session.py:395-411`
   (`length 346 → 35/276/35`, `length 30 → 3/24/3`).
3. **Head and tail streams are per-channel**, from distinct RNG substreams, so the three
   channels do not echo each other during the bookends.
4. Validation is deliberately loud: unknown theme names, empty theme sets, and a theme
   marked both induction and emergence are all hard errors — because, in the source's own
   words, "a phase that silently dropped a bad block name would reintroduce the artifact it
   exists to prevent."

**Bug excluded:** **[CITED recon-hypnocli §5.2]** at `length ≤ 2` the minimums overrun and
produce 3 steps for a 1-step session. hypnoapp clamps; a named test asserts
`head + mid + tail === length` for every length in `1..500`.

**[DECISION] `induction` and `emergence` are new first-class pool themes authored by Phase
B.** conditioner's 22 themes contain no induction or emergence content — every one is a
going-under theme. They are ordinary tagged data; only the plan config designates their
role. This is the single hardest Phase B dependency and §7.2 gives it first priority and a
hand-authoring requirement.

### 4.3 Block granularity — a block is a theme

Forced by §0.2's measurement, and endorsed by judge 2 as "the single highest-value graft"
for buildability.

- A **block is a theme.** Its members are every mantra tagged with that theme passing the
  user's consent filters. Real sizes: **80–358**, every tag above the 54-record floor.
- The step draws from the block, filtered by consent and by the Shuffler's suppression
  window. There is no second filter and no second dimension.

```
candidates = block members surviving the consent filters
if |candidates| < 3:  PLAN ERROR — this theme cannot serve a triplet
```

`3` is `CHANNEL_COUNT`, a named constant.

**Adjacency widening is deleted.** The whole widening ladder existed to compensate for thin
(theme, tier) cells: with no tier target there is nothing to widen toward, and
`Diagnostic{tier-widened}` goes with it. That also removes acceptance criterion A10
("widening never crosses a consent boundary"), which tested that the cap was applied before
candidates were gathered — a guard on a mechanism that no longer exists, protecting a cap
that no longer exists.

### 4.4 Theme selection per step — the specification hole, closed

Judge 1 named this as "a genuine specification hole in the module the design itself calls
the largest and most important." Closing it:

**[DECISION] The theme axis is scheduled, shared across all three lanes, and rotates on a
hold-and-pivot walk — it is not drawn uniformly at random per step.**

```
themeAt(step):
  # one shared theme for all three lanes at a given step
  if step in head:  sweep induction themes in listed order
  if step in tail:  sweep emergence themes in listed order
  else:
    hold the current theme for THEME_HOLD steps (default 8, ≈27s at stepMs 3400)
    on pivot, draw the next theme from a per-session Shuffler over the enrolled
    themes, unweighted
```

Three properties, each earned:

1. **Shared across lanes** reproduces hypnocli's measured flagship behavior
   **[CITED recon-hypnocli §4.6]**: all titrating channels on the same theme at the same
   step, saying *different lines of it*, via one shuffler per theme shared across streams.
   That is what makes a triplet read as one utterance in three voices rather than three
   unrelated statements. Parity row 6 is now backed by a mechanism, not an assertion.
2. **Hold-and-pivot, not per-step redraw.** A theme that changes every 3.4 seconds is a
   shuffle, not an arc. Holding ~27s lets a theme establish before it moves, and it is the
   same idiom trance uses for `alternate`
   (**[CITED recon-trance §7.1]**: "a stateful walk rather than a per-fire re-roll").
3. **Coverage-weighted, not uniform.** Data-first's uniform-random theme draw was judge 1's
   named parity break: under it the session's arc moves only through difficulty, never
   through content. The pivot is an unweighted Shuffler walk: the coverage weighting that
   stood here scored themes by "how well the theme's surviving tier distribution covers the
   current target tier", which is a weighting by a fabricated axis. With every tag above
   the floor there is nothing left for it to correct for, and `Diagnostic{theme-coverage-thin}`
   is deleted with it.

### 4.5 Titration — gaussian, ported verbatim

Ship **gaussian**. Keep **linear** as the monotone alternative. Do **not** ship `arc`,
`random`, or `tier_gate`, and above all do not reinvent a trajectory/state-model scheduler:
`dsm` lost to gaussian **on every seed** in a 30-rater, 6-dimension blind study, at a
fraction of the annotation cost. That is the most valuable negative result in the reference
ecosystem, and re-deriving it would cost a rater study to learn the same thing.

**[MEASURED]** by executing `titration.py:267-277`:

```ts
const p      = Math.min(step / Math.max(length - 1, 1), 1.0);   // clamped
const target = iMin + (iMax - iMin) * Math.exp(-((p - peak) ** 2) / (2 * width ** 2));
```

**The bell survives; the mapping onto a tier does not.** The curve won a 30-rater blind
study against `dsm` on every seed, and re-deriving that negative result would cost another
rater study — so the gaussian is kept and its value is carried raw on each tick as
`intensity`. What is deleted is the line that used to follow it, selecting the "nearest
tier by |tier - target|": that rounded a real curve onto a fabricated ladder. The curve now
drives pacing (§4.9), which is a measured effect, and nothing rounds it.

Defaults `peak = 0.5`, `width = 0.25`. Validation `0 <= peak <= 1`, `width > 0`. Progress
clamping is retained even though hypnoapp does not need cap-invariance, because it costs
nothing and makes the schedule well-defined at `step >= length`.

### 4.6 The person schedule — the genuinely new scheduler

**[CITED recon-hypnocli §12.4]** flags this as having no equivalent in hypnocli and
observes it is "structurally the *same shape* as a titration schedule — a monotone/curved
function of progress selecting from an ordered set." **[DECISION]** the person schedule
reuses the titration interface, contracts and determinism guarantees.

```
personSchedule(step, length, rng) -> { center: Person, left: Person, right: Person }
```

**Center is always `"second"`.** Not scheduled; fixed by the brief.

**Sides drift `first → named` and then BACK toward `first`.** — **[GRAFT: experience-first
§1.2, the strongest single graft in the set]**

```ts
const p       = clamp01(step / Math.max(length - 1, 1));
const pNamed  = PEAK_MIX * bell(p, peak=0.55, width=0.28);   // PEAK_MIX default 0.85
```

The base design drifted monotonically `first → named` with a `late` ease and never weaned
the person axis back, so the session ended with the listener maximally dissociated even
though intensity weaned correctly. **That is the same class of error as hypnocli's "Wide
awake at line 2"** — a directionality property a scalar schedule cannot express — and the
structural fix for the intensity axis is already ported. Applying it to the person axis
costs a bell instead of a monotone ease.

The arc is: *told → agreeing → described → handed back your "I".* A session that leaves
you dissociated is a session you resent afterward; the drift out is what makes the drift in
safe to accept.

**Hold-and-pivot sampling, not per-step re-roll** — **[GRAFT: experience-first §5.6]**:

```
every PIVOT_EVERY (default 4) steps:
  target = rng.next() < pNamed(p) ? 'named' : 'first'
  if target != current: current = target
```

Sampling per step produces *shimmer* — I / she / I / I / she — which reads as a rendering
bug, not a drift. **[CITED recon-trance §7.1]** documents that trance's `alternate chance P`
is a **stateful walk** whose probability **cannot ride a curve** because `parse_chance`
takes a literal and bakes a 100-bucket table at parse time; **[CITED recon-trance §8.2(d)]**
names curve-drivable chance a "genuine new runtime primitive." **hypnoapp gets it for
free**, because the schedule is planned rather than parsed.

**The two sides pivot independently on offset schedules**, so mid-session you routinely see
one side in "I" and the other in "{subject}" simultaneously — the two readings of yourself
coexisting.

**Neutral biasing at the pivot** — **[GRAFT: data-first §6.5(b)]**. The 87 impersonal
records are person-invariant, and they get a scheduled job rather than being a remainder:
side channels **prefer `invariant` mantras when `pNamed` is near 0.5** (the drift midpoint),
so the triplet passes through a person-free moment on its way from "I" to "{subject}". This
turns the shift from a switch into a hinge, and it makes the person-free records the most
interesting content in the session rather than the least.

**Invariant preference during induction is dropped.** The base design preferred invariant
mantras during the head "so the session opens without announcing its own mechanism." Judge 1
correctly flagged this as invented texture with no upstream basis. The neutral-at-pivot
mechanism above has a stated purpose and replaces it.

**Tuning knobs are `SessionOptions` fields, not constants.** `PEAK_MIX`, `PIVOT_EVERY`,
the bell's `peak`/`width`, and the neutral bias are all exposed from day one. Judge 2's
risk is exact: person drift is self-labeled DECISION with no upstream precedent, and if a
real sitting says it reads as mechanical, the fix must be a config change rather than a
rebuild of the deepest module.

### 4.7 Triplet content mode — `parallel` default, `unison` shipped

**[CITED recon-trance §8.2(b2)]** argues the brief wants *coordinated* triplets — one
mantra in three persons — and that this "is impossible if each channel independently picks
a random line." **[CITED recon-hypnocli §4.6]** measures that hypnocli's shipped flagship
texture is the opposite: same theme, *different lines*, "a unified semantic field spoken in
parallel variants."

**[DECISION] Ship both as a plan-level mode, defaulting to `parallel`:**

| Mode | Behavior |
|---|---|
| `parallel` **(default)** | One theme per step; three **different** mantras, one per channel, each in its scheduled person. Ported from hypnocli's shared-theme/shared-shuffler behavior. |
| `unison` | One mantra per step; all three channels render **the same** mantra in their own person. recon-trance's coordinated triplet. |

Given the plan-ahead architecture, `unison` is one flag and ~15 lines. Shipping both settles
a genuine disagreement between two recon docs with a sitting instead of an argument — and
this is the one question a single real sitting resolves. **Both modes are
acceptance-tested paths** (§9 C7), not one tested mode and one hedge.

**`unison` guards against the identical-triplet artifact.** Under `unison` an `invariant`
mantra renders as three byte-identical strings across the screen, which a user reads as a
bug rather than emphasis. So: **the planner refuses `unison` steps whose drawn mantra is
`invariant` and redraws.** The 87 person-free records remain valuable — they just do their
work at the drift pivot (§4.6), not as accidental visual stutter.

**In `parallel`, no two lanes may show the same `mantraId` at the same step.** Draw center
first (it is the anchor), then sides excluding what is taken.

### 4.8 Anti-repeat: Shuffler, ported, window sized from measurement

**[CITED recon-hypnocli §4.1]**, itself ported from trance's `src/common/util.h` — so it is
the *same* picker both reference systems use, a strong signal. **[MEASURED]** from
`titration.py:63-83`:

> `n` items at priority 0. Take max priority; uniform-random among all items at it;
> decrement the picked item and push to `recent`; when `recent` exceeds `window`, pop the
> oldest and restore its priority.

**One shuffler per theme, shared across all three channels** — this is what makes the three
channels say *different* lines of the same theme.

**[DECISION] `window = clamp(floor(blockSize / 2), 3, 12)`**, not the literal 6.
**[CITED recon-hypnocli §4.1]** warns that when `window >= n` suppression saturates and
degrades toward LRU-with-random-ties, and advises sizing window relative to block size
rather than blindly copying 6. At theme granularity blocks are 19–35, so a fixed 6 would be
fine — but the clamp costs one line and keeps the engine correct when a user's filters cut a
theme to eight survivors. `poolSize < 8` emits `Diagnostic{shuffler-degraded}`.

### 4.9 Pacing — variable dwell, phase-offset from intensity

**[DECISION] hypnoapp inverts hypnocli's authoring unit.** hypnocli authors in *lines* and
duration is emergent from TTS; hypnoapp chooses dwell, so `length = round(targetDurationMs
/ meanStepMs)`.

**[GRAFT: experience-first §5.3, with a correction]** Dwell is **not constant**. Pacing
itself carries the arc — a constant dwell is a metronome:

```
dwell(p) = DWELL_MAX - (DWELL_MAX - DWELL_MIN) * bell(p, peak=0.62, width=0.25)
DWELL_MAX = 4200ms   (induction & emergence: slow, spacious)
DWELL_MIN = 2900ms   (peak: tight, insistent)
mean ≈ 3400ms        (inside the [MEASURED] 3.2–3.5 s/line/channel band)
```

**The correction:** the dwell bell's peak is **offset to 0.62** rather than sharing the
intensity bell's 0.5. Judge 3's risk is real — with a shared curve, every difficulty axis
peaks simultaneously by construction: fastest lines, the intensity peak, highest third-person
share, all at the same instant. That is where a session tips from absorbing to
overwhelming. Offsetting the pacing curve slightly later means the tightest pacing arrives
*after* the deepest content, on the near side of the wean, which is where it reads as
momentum rather than pressure.

**Channel offsets within a step.** Ported from hypnocli's role defaults
**[CITED recon-hypnocli §2.2]**, which encode a deliberate "right ear leads — Wernicke
lateralization" claim:

| Channel | hypnocli start | hypnoapp offset | Prominence |
|---|---|---|---|
| right | 3000 ms | **0 ms** (leads) | attenuated |
| left | 3500 ms | **+500 ms** | attenuated |
| center | 4000 ms | **+1000 ms** | full |

Sides lead; the center is the anchor that arrives last and stays.

**Channel free-run and drift.** **[CITED recon-hypnocli §3.1]** is emphatic that channels
are never re-synchronized after their start offsets and that inter-channel drift is
*intended texture, not a defect*. **[DECISION] hypnoapp preserves drift with a per-channel
`stepMs` jitter of ±4% (seeded)** — reduced from the ±6% of the base proposal.

Judges 1 and 3 both flagged this as a possibly-wrong aesthetic call locked in as a ship
gate: the perceptual claim does not obviously transfer from an audio system (where drift is
inaudible texture arising naturally from variable spoken line length) to a visual one
(where three text lanes visibly sliding out of phase may read as broken timing). **The
mitigation is threefold:** the magnitude is halved; `driftPct` is a `SessionOptions` field
so it is tunable to 0 without an engine change; and **C3 is demoted from a ship gate to a
tuning observation** (§9). Drift is preserved as the default because it is documented
reference behavior, but it is no longer a release blocker on an unmeasured claim.

**Session tail.** ~2500 ms of quiet after the last line, plus a 1500 ms fade
**[CITED recon-hypnocli §3.2]**. A session never stops abruptly.

**Inline pause markers.** `[500]` / `[1.5s]` inside a line **[CITED recon-hypnocli §3.3]**
are supported in the text grammar and hold the visual on a partial line. Cheap, high
expressive value, and it keeps the corpus format compatible with a future TTS path.

### 4.10 Diagnostics — the engine narrates its own degradation — **[GRAFT: data-first §5.7]**

```typescript
type Diagnostic =
  | { kind: 'lane-starved';        step: number; lane: LaneId; reason: string }
  | { kind: 'shuffler-degraded';   theme: string; poolSize: number }
  | { kind: 'blocklist-relaxed' }
  | { kind: 'person-unavailable';  step: number; lane: LaneId; wanted: Person }
  | { kind: 'unison-redraw';       step: number; reason: 'invariant' };
```

The base design's adjacency widening "records a plan warning" but never typed it. Every
place the engine could quietly do something second-best, it records it as **typed data on
the plan**. Three payoffs: acceptance criteria become mechanically assertable ("zero
`lane-starved` on the reference config"); Phase B gets a machine-readable list naming
exactly which cells are underfilled; and a user report is reproducible from `(config,
seed)` alone.

### 4.11 Parity checklist

Every row is a behavior **[CITED recon-hypnocli §11]** lists under "Port". This is M2's
acceptance surface and runs headless.

| # | Behavior | Where | Test |
|---|---|---|---|
| 1 | Field of 3 voices, own stream each | §4.1 | plan has 3 streams of `length` |
| 2 | Right leads, left, then center; sides attenuated | §4.9 | offsets 0/500/1000 |
| 3 | Channels free-run and drift | §4.9 | per-channel jitter ≠ 0 |
| 4 | Shuffler anti-repeat, sliding window | §4.8 | no repeat within window |
| 5 | Gaussian titration, build→peak→wean | §4.5 | intensity trace unimodal |
| 6 | Shared theme + shared per-theme shuffler ⇒ same theme, different lines | §4.4, §4.7 | one theme per step across lanes; 3 distinct ids in `parallel` |
| 7 | Phase bookends 10%, min 1, capped at half; excluded from pool | §4.2 | `head+mid+tail === length` ∀ length |
| 8 | Full determinism from (config, seed) | §3 | same seed ⇒ byte-identical plan |
| 9 | Anchored center; anchor does not titrate in person | §4.6 | center `second` in 100% of ticks |
| 10 | Continuous non-masking bed | §1.4 | plan carries `bed` |
| 11 | ~2.5s tail + 1.5s fade | §4.9 | plan `totalMs` includes both |
| 12 | Inline `[500]` pause markers | §4.9 | parser round-trip |
| 13 | Presets expand to primitives *before* validation | §6.4 | no hidden behavior |
| 14 | Corpus order within a block never sorted at rest | §7.3 | ingestion preserves order |

**Explicitly NOT ported** **[CITED recon-hypnocli §11 "Drop"]**: equalization pass 2; the
`cap = tit_mid*2` headroom; cap-invariance contracts; split `seed`/`seed+1` streams (all
obviated by chosen dwell); the `tail_pad_ms` `+1200` fudge; `tier_gate`; `dsm`;
`NATURAL_SENTENCE_GAP_MS`; `write_conditioner_format`'s points map (**it disagrees with
conditioner's real tiers** — BASIC→10 is below the floor of 20, MODERATE→40 lands in the
*basic* band); the conductor `sections` program; Phase-3 modifiers; the `length <= 2`
overrun.

---

## 5. Triplet rendering

### 5.1 What a triplet tick is

```ts
interface TripletTick {
  step: number;
  theme: string;
  intensity: number;                                        // §4.5, the raw bell value in [0,1]
  dwellMs: number;                                          // §4.9, varies per step
  center: { mantraId: string; person: "second"; text: string };
  left:   { mantraId: string; person: Person;   text: string };
  right:  { mantraId: string; person: Person;   text: string };
}
```

`text` is the **raw template** for that person, from the sidecar (§2.3). Substitution
happens in the renderer at display time (§2.4). A `SessionPlan` is
`{ meta, ticks: TripletTick[], bed, diagnostics }` and nothing else.

That the whole engine output is an array of these is the point: inspectable, diffable,
snapshot-testable, and a reviewer can read a session as text before anyone renders a pixel.

### 5.2 What is taken from v3, and what is not

**[CITED recon-trance §9]** partitions this cleanly. What is taken is *semantics*; none of
the C++ and none of the surface syntax.

**Taken:**

| Idea | Why |
|---|---|
| **Schedule/render split** | The best idea in trance. Here: Planner/Conductor (§3). |
| **Three structurally distinct text channels** | v3's `word`/`line`, `subtext`, `caption` differ in backing state, renderer, geometry and params — "the natural triplet substrate." |
| **`.active` gate** | Every draw auto-ANDed with its pattern's active flag — "the multi-channel compositing mechanism." Each channel has an `active` window; nothing paints outside it. |
| **Alpha stratification** | `super_parallel` proves three full-alpha layers just show whichever drew last; 1 / 0.5 / 0.33 make a stack legible. Center 1.0, sides ~0.3. |
| **`offset` lane stagger** | The channel-phase primitive. Here: 0/500/1000 ms step offsets. |
| **`env in X hold Y out Z`** | Piecewise-linear alpha trapezoid with a **true absent tail**, unlike `fade inout`'s whole-clock triangle. The per-line visual envelope. |
| **`curve … ease late/early`** | `late` = p³ dwells at the start. Drives macro visuals. |
| **Parse-time hard errors over silent guesses** | Applied to plan validation (§2.6). |
| **Fail-soft at the program level** | A bad custom item is skipped with a surfaced warning; the rest plays. |

**The queue-drain WORD/LINE split — [GRAFT: judge 3's highest-value graft].**
**[CITED recon-trance §6.1]** documents `change_text`: each firing pops one token; a new
line is pulled only when the queue empties. With `split = WORD` a 5-word mantra displays
word-by-word over 5 firings; with `split = LINE` the whole phrase is one token — same
mechanism, one flag.

**[DECISION] Both modes ship. Center defaults to `LINE`** (it is the anchor — you read it
whole); **sides default to `WORD`** (they are peripheral — they *seep*). This gives the
anchor/periphery distinction a **temporal** dimension on top of alpha, scale and blur, at
near-zero cost, using a mechanism already designed and debugged in trance.

**Not taken:**

- **The v3 surface syntax and its parser.** 1553 lines of C++ implementing a text DSL for a
  media player with *author-written* patterns. hypnoapp's patterns are generated by the
  planner from a config object. Shipping a parser to talk to ourselves is pure cost.
- **The bi-thematic ThemeBank and the 2-pool ceiling.** **[CITED recon-trance §9.3]**: "Do
  not try to model three persons as themes — 3+ live themes is a decided non-goal in trance…
  **Person belongs on a different axis than theme.**" Followed exactly: theme is the block
  axis, person is the channel axis, and they never touch.
- **`Op::Text`'s content-addressing gap** (trance's deferred Ext#4) — dissolved by §3.1.

**Bugs avoided by construction.** **[CITED recon-trance §9.4]** names two a
reimplementation will repeat: burst frames-vs-ticks unit confusion, and the `Rep(1,…)`
id-stamping collapse. 1.0 ships neither `burst` nor pattern-id-stamped register scoping, so
both are avoided by not building the machinery. Noted so a later contributor who *does* add
burst knows where the mine is.

### 5.3 Channel geometry

| | **center** | **left** | **right** |
|---|---|---|---|
| Person | `second`, fixed | drifts `first ↔ named` | drifts `first ↔ named` |
| Position | screen center | left third | right third |
| Scale | 1.0 | 0.55 | 0.55 |
| Alpha | 1.0 | 0.30 | 0.30 |
| Blur | 0 | slight | slight |
| Split | `LINE` | `WORD` | `WORD` |
| Step offset | +1000 ms | +500 ms | 0 ms (leads) |
| v3 analogue | `word`/`line` | `caption` | `caption` |

Scale/alpha/blur are the **visual analogues of hypnocli's audio params**:
**[CITED recon-hypnocli §2.2]** has sides at −9 dB with 0.21 reverb against a dry 0 dB
center, and judges that "center should be the largest/highest-contrast/central text and the
sides smaller, dimmer, offset, and appearing slightly *before* the center line does."

**Deliberately not `subtext`.** **[CITED recon-trance §9.2]** warns that v3's `subtext` is a
full-screen tiled wall that "as a *side channel* will dominate the center." Both sides use
`caption`-style single-line placement.

**The sides arrive late and leave early** — **[GRAFT: experience-first §1.2]**. Side
channels fade in during the head→middle transition and fade out at the middle→tail
transition. Opening on three lanes is overwhelming; closing on three lanes is jarring. The
center is the thread held the whole way.

### 5.4 The session clock — **[GRAFT: experience-first §7.2, both judges]**

**[DECISION] The conductor's `elapsedMs` comes from `performance.now()` read inside a
`requestAnimationFrame` loop. `setInterval` is forbidden, lint-enforced.** On
`visibilitychange` the session **pauses** and resumes on return.

The failure mode is verified live in this repo: **[MEASURED]** `src/routes/Player.tsx:75`
drives playback from a hardcoded `setInterval`. Backgrounded tabs throttle timers, and a
naive implementation dumps a dozen queued lines the moment the user switches back.

**The three lanes are written with raw DOM writes from the rAF loop, outside React's
reconciler.** React owns the setup screen and the shell; it does not sit between the
session clock and the pixels. Putting the scheduler there makes timing untestable and
introduces exactly the frame-level jitter §9 forbids.

### 5.5 Backdrop

**[DECISION] One WebGL fragment shader, driven by session progress. That is all.**

**[CITED recon-hypnoapp §6.5]** 10 GLSL ShaderToy-style shaders already exist in the repo,
byte-duplicated across `public/shaders/` and `assets/`, unused by the running app, with
parametric uniforms (`num_arms`, `rotation_speed`, `spiral_angle`, `pattern_speed`,
`warp_speed`) — "directly modulatable from a session engine, which is exactly what the
brief's rendering layer wants." Meanwhile the *running* app uses an unrelated 2D-canvas
spiral.

So: use the shaders, delete the canvas spiral, delete the `assets/` duplicate. Uniforms are
driven by `FrameState.progress` through the same curve/ease vocabulary as everything else.

`public/shaders/notes.md` is "a genuinely thoughtful design document" [CITED
recon-hypnoapp] — seven principles on spiral transitions, including **sync transitions with
the breathing cycle** and **visual fade to mask changes**. It rhymes with #66's measured
0.4–1.2 Hz breathing-pace AM and the drone's 3.25/5.0 Hz pulses. **[DECISION] the backdrop's
transition rate is derived from the bed's pulse rate**, so visuals and entrainment share one
clock.

### 5.6 Accessibility and safety — hard requirements — **[GRAFT: experience-first §6.5]**

Not a checklist item. This is a hypnosis app with animated visuals.

- **`prefers-reduced-motion` produces a working static-field session** — field amplitude to
  near-zero, cross-fades to 200ms, no parallax. The session still works; it stops moving.
- **Nothing in the field exceeds ~3 Hz.** No strobing, ever.
- **Escape stops within 1.5 s, fading rather than cutting.** A hard cut from deep trance is
  unpleasant.
- **Side lanes at 0.30 alpha must clear 4.5:1 contrast against the shader's brightest
  frame.** This is a real constraint on shader selection and it is far cheaper to honor when
  M6 picks the shader than to retrofit. Tested by sampling the shader's max-luminance frame.
- Every appearance/disappearance is a cross-fade of ≥400 ms. Nothing flashes or cuts hard.

---

## 6. UX flow

Thin does not mean bad. **The UI is a pure function producing a config object and holds no
session state.** Every hard question is answered in the engine.

### 6.1 Two screens

**Configure** — conditioner's theme-selection panel rebuilt for a medium with no Discord
constraints:

- Multi-select themes with live per-theme counts and descriptions.
- Excluded themes ("yucks"), **separate and unbounded** — distinct from not-enrolling,
  because exclusion filters by the mantra's *full tag list*. **This is the consent surface**
  (§2.6): the setup screen offers one flat alphabetical tag list with no ordering and no
  categories, so excluding heavy register (`intense`) is the same gesture as excluding any
  other tag. The intensity ladder that used to sit here is deleted along with the axis it
  displayed.
- Operator toggle, subject name, operator name.
- Duration slider → `length` via mean dwell (§4.9).
- Mode toggle (`parallel` / `unison`), defaulted and explained in one line.

**Play** — three lanes, backdrop, bed, and nothing else visible. No chrome, no progress
bar. §6.5 and §6.6 specify its first six and last six seconds.

### 6.2 The live-feedback loop is not optional

**[CITED recon-conditioner §2.4]** calls this "the most transferable idea in the UX," and it
is the **user-facing surface of the engine's plan validation**:

- `Your filters match N of 612 mantras`
- Per-tag counts next to the post-filter deliverable count, warning when an exclusion drops
  an enrolled tag toward the 54-record floor.
  Watching N collapse to M is what teaches the filters.
- Two randomly drawn samples **rendered as a live triplet** with the user's own names, so
  the person axis is visible before committing twenty minutes. For a first-time user, that
  sample *is* the explanation — better than a tour. No modal, no walkthrough, no tooltips.

**[DECISION] The plan is built on every config change, debounced at 250 ms, and its errors
and warnings surface inline.** The user cannot start a session the engine cannot serve.

**Performance budget (closing judge 1's risk).** `plan()` runs on the configure screen's hot
path. **Budget: p95 ≤ 40 ms** for a 500-step, 3-channel plan over the full corpus, measured
in CI on the reference config and asserted as a test (§9 A11). If the budget is at risk, the
loop degrades to a **counts-only** validation pass (a filter, not a plan) during typing, with
the full plan built on blur and before Begin. The live-feedback loop is load-bearing; the
full plan on every keystroke is not.

### 6.3 Reject, don't repair

**[CITED recon-conditioner §2.6]**, ported as doctrine:

- Any save leaving **0** matching mantras is **rejected with a targeted message naming the
  specific fix** ("drop `sluttiness` from your exclusions or re-enable operator mantras
  first"), never
  accepted-and-worked-around at delivery time.
- A theme cannot be both enrolled and excluded; **the save being attempted loses**, mirrored
  in both directions so the outcome never depends on click order.
- Carve-out: an **empty theme list is allowed** — it is visible and simply blocks Start. The
  guard targets the *silent* trap, not the obvious one.

### 6.4 Presets

**[CITED recon-hypnocli §7]**: presets expand to explicit primitives **before validation**,
so a preset can never carry hidden behavior. Three ship: `standard` (gaussian, parallel,
20 min), `gentle` (cap at light, lower peak), `deep` (higher peak, longer dwell). An unknown
preset is a hard error.

### 6.5 The threshold (0:00–0:06) — **[GRAFT: experience-first §7.3, both judges]**

The 3–6 seconds between Begin and the first line is 0% of the value and 100% of the
abandonment. A session that opens on a flash of unstyled text has lost the user before the
engine's correctness matters.

**The mechanic:** the full plan is computed, the pool filtered, the first three variants
resolved, **fonts loaded and the shader compiled — all while the user is still reading their
sample on the setup screen.** Begin therefore has nothing to wait for and needs no spinner.

```
Begin → screen darkens (800ms) → bed fades in (2s) → field appears (2s)
      → first center line cross-fades in
```

### 6.6 The exit — **[GRAFT: experience-first §7.4]**

Text stops. Field and bed fade over 4 s. Black for 2 s. Then one low-contrast line:
`again · done`.

**No stats, no score, no "you completed 340 mantras", no share prompt.** Coming out of
trance into a gamification screen is a category error. This is also why the base design's
§4.11 row 11 tail (2.5 s quiet + 1.5 s fade) is specified at the *plan* level and the exit
at the *UI* level — they compose.

### 6.7 Failure modes and what the user sees

| Failure | Never | Instead |
|---|---|---|
| Pool fetch fails | Blank screen / React error boundary | "Couldn't load the mantra library. Retry." Begin disabled |
| Record missing a person variant | A `{named}` placeholder or empty lane | Dropped from the pool at **load-time validation** with a console warning; never rendered |
| Filters match zero mantras | An empty session | Begin disabled, specific fix named |
| A theme too thin to fill three lanes | The same line on two lanes | Hard plan error before playback (§4.3); **never a repeat within a tick** |
| AudioContext blocked by autoplay policy | Silence with no explanation | Bed starts on the Begin gesture — structurally impossible |
| Tab backgrounded mid-session | Timer drift then a burst of lines | `performance.now()` + rAF; pause on `visibilitychange` (§5.4) |

### 6.8 What the UI does NOT get in 1.0

Dropped because they belong to a points economy hypnoapp does not have: the points-gated
theme-slot ladder, favorites/2× weighting, the blocklist UI, and user-authored customs.
**[DECISION]** the *slot concept* — a curated 3-to-5-theme mix beats 22 — is retained as a
soft advisory ("sessions read best with 3–5 themes"), without a gate.

Not inherited (platform artifacts): the 25-option select cap and its alphabetical
truncation, 100-char labels, 45-char modal labels, 1024/4096 embed slices, 5-minute panel
expiry, single-invoker ownership checks, digest-in-button-id persistence. **hypnoapp must
not inherit 25 as a number.**

---

## 7. Corpus contract (summary — full spec in `CORPUS_SPEC.md`)

### 7.1 The target, derived rather than asserted

```
required distinct draws per block per dwell = 3 channels × dwell_steps
observed gaussian dwell at peak             = up to 18 steps
→ a tag must hold ≥54 records to be self-sufficient at max dwell
```

**[DECISION] The floor is ≥54 records per tag**, and it is an ENGINE parameter rather than
a law: it moves if the lane count or the dwell curve moves. There is no second dimension to
divide it by — the per-cell arithmetic that stood here divided the floor across a tier axis
that has since been deleted as fabricated.

### 7.2 Phase B status

Phase B is **complete**: bookends authored, person variants backfilled, generation run, a
quality kill pass executed, and the corpus retagged onto the flat vocabulary. MEASURED
2,639 records across 25 tags, every tag above the floor.

The tranche table that stood here staged a campaign that has finished, and its rows were
gated on per-(theme,tier) cell counts. What replaces it as the live gate is the per-tag
floor above, printed by `corpus:report`.

If the vocabulary should grow, the corpus must grow first: minting a tag means splitting an
existing one below the floor, which is the exact failure the floor exists to prevent.

### 7.3 Ingester invariants

Deterministic, idempotent, order-preserving. Nine steps, specified in `CORPUS_SPEC.md` §6.
Two invariants restated here because they are engine-facing:

- **Order within a block is never sorted or shuffled at rest.** **[CITED recon-hypnocli
  §10.5]** records this explicitly: the corpus is order-dependent (meter/rhyme adjacency).
  The ingester appends; it never reorders.
- **Re-running over the same raw files produces a byte-identical pool.** That is what makes
  Phase B resumable and its output reviewable as a diff.

### 7.4 The conjugation gate — reshaped by measurement — **[GRAFT: experience-first §8.5
rule 9, corrected]**

This is the single largest gap the judges found: the base design's only defense against
"she obey" across ~13,000 authored strings was a 200-record human sample, which at 4,320
records lets a 1% defect rate ship ~43 broken strings while passing the gate — against a
design whose own rationale says one visible grammar error ends the session.

The graft is right in principle. **[MEASURED]** it needs correcting in practice: the
salvageable table is **158 entries (157 unique, one conflicting `have`)** and covers **61%
of subject-governed tokens** in the live corpus, with most of the residue being nouns and
modals rather than uncovered verbs. A gate that flags "every verb governed by the subject"
would fire on `{subject}'s mind`, `{subject} cannot`, `{subject} would` — a ~39%
false-positive rate that gets the gate switched off in a day.

**[DECISION] A three-layer gate, precision-first:**

| Layer | Mechanism | Catches | Precision |
|---|---|---|---|
| **L1 — agreement triple** | For each record, align the `first` and `named` variants token-wise. Where they differ at exactly one position and **both forms appear in the same table entry** (`crave\|craves`), the pair is *confirmed correct*. Where they differ at one position and the `named` form equals the **`first`** form of a table entry (i.e. the bare stem where an inflected form is required), it is a **hard error**. | The exact "she obey" family | ~100% — only fires on table-confirmed stems |
| **L2 — copula/auxiliary check** | `I am` ↔ `{subject} is`; `I have` ↔ `{subject} has`; `I do` ↔ `{subject} does`; `don't` ↔ `doesn't`; `aren't` ↔ `isn't`. Closed set, hard error on mismatch. | The highest-frequency transform (**[MEASURED]** the copula alone is 41 of 103 first-person verb occurrences and 52 of 253 named-self ones) — and the one a naive `s`-suffix rule gets wrong | 100% |
| **L3 — bare-pronoun and stance checks** | `named` must contain `{subject}` and no 1st-person pronoun and **no bare `she`/`he`/`they`** (always the named form, so it renders as the user's chosen name). `second` must contain a 2nd-person pronoun, no 1st-person pronoun, no `{subject}`. `first` must contain a 1st-person pronoun and no `{subject}`. Skipped entirely when `invariant`. | Stance leakage between variants | 100% |

**Everything L1–L3 cannot confirm is routed to a `review` queue, not silently passed.** The
report prints coverage: *"N records fully machine-verified, M routed to review."* Human
review is then spent on the residue rather than on a random 200.

**Table repair is a prerequisite:** dedupe the conflicting `have` entries (keep
`have|has|has`) before the table is used as a gate.

**[ACCEPTED RISK]** L1–L3 do not achieve 100% mechanical verification of 13,000 strings.
They convert an unbounded sampling problem into a bounded review queue with a published
coverage number. That is a real improvement over a 200-record sample and it is honestly
short of proof.

---

## 8. Module partition

Full machine-readable partition in `MODULES.json`. Summary of the shape and the reasoning:

```
                          M0  repo-reset            (lands ALONE, first)
                               │
              ┌────────────────┼──────────────┬──────────────┐
              ▼                ▼              ▼              ▼
        M1 corpus         M3 render-model  M6 backdrop+bed  M5 ingest
        (schema+types)    (FrameState)     (shader, drone)  (Phase B, Node)
              │                │
              ▼                ▼
        M2 engine  ────────▶ M4 renderer
        (planner+conductor)    │
              │                ▼
              └──────────▶ M7 shell/UI + harness
```

**Two changes from the base proposal's partition, both forced by judge findings:**

1. **`FrameState` is defined in M1, not M3.** Judge 2's sharpest finding: the base design
   named `FrameState` "the seam that makes the two biggest modules parallelizable" and never
   gave it a type definition in 1,299 lines, while M2 exported `frameAt(): FrameState` and
   M3 owned its shape. Two strong agents would block on a type neither owns. **All shared
   types — `PoolRecord`, `PersonTriple`, `Corpus`, `Pov`, `derivePov`,
   `Person`, `SessionPlan`, `TripletTick`, `FrameState`, `Diagnostic`, `UserConfig`,
   `SessionOptions` — live in M1 and are owned by M1.** M1 lands second (right after M0),
   alone, in half a day. Every other module imports from it and nothing else crosses
   boundaries.

2. **The reference fixtures are hand-authored, not generated.** Judge 2's circularity
   catch: data-first defined `timeline.reference.json` as the *output* of the very function
   M4 had not written, which destroys the decoupling it exists to provide. **[DECISION] M1
   hand-authors `fixtures/plan.reference.json` as a specification artifact.** M2's job is to
   *reproduce* it; M4's job is to *render* it. Neither agent waits on the other.

```
fixtures/corpus.mini.json      ~40 records, all 4 stances, 2 multi-tagged
fixtures/config.reference.json a fixed UserConfig
fixtures/plan.reference.json   HAND-AUTHORED. The spec, not an output.
fixtures/frame.reference.json  HAND-AUTHORED FrameState at three sample elapsedMs values
```

**Sequencing.** M0 alone → M1 alone → {M2, M3, M5, M6} fully parallel → M4 (needs M3) →
M7 (integrates). M5 runs the entire Phase B campaign concurrently with all UI work; its only
coupling to the browser code is M1's schema module, which it *imports* rather than
reimplements (§1.2).

---

## 9. 1.0 acceptance definition

Every criterion is objective; most run headless.

### Engine correctness (no browser)

| # | Criterion |
|---|---|
| A1 | **Determinism.** Same `(config, seed)` ⇒ byte-identical `SessionPlan`, across processes and runs. |
| A2 | **Bookend arithmetic.** `head + mid + tail === length` for every `length` in `1..500`. No overrun at `length ≤ 2`. |
| A3 | **Directionality.** No emergence-theme mantra in the first 50% of any plan; no induction-theme mantra in the last 50%. 200 seeds × 10 configs. *The "Wide awake at line 2" regression test.* |
| A4 | **Gaussian arc.** Per-step intensity trace is unimodal: non-decreasing to peak, non-increasing after. 200 seeds. |
| A5 | **Triplet distinctness.** In `parallel`, all three `mantraId`s within a tick differ, every tick, every plan. |
| A6 | **Anti-repeat.** No id repeats within a channel inside the shuffler window, except where a `shuffler-degraded` diagnostic is present. |
| A7 | **Consent boundaries hold.** Over 1000 random configs: no mantra with `has_operator` when the toggle is off, and none tagged with an excluded theme, checked against the record's FULL tag list. **Zero tolerance — one violation blocks 1.0.** |
| A8 | **Starvation is a plan error.** Unservable configs return `PlanError[]` naming the fix; no plan is returned with a missing or duplicate-filled tick. |
| A9 | **Person schedule shape.** Center is `second` in 100% of ticks. Side `named` share, binned into deciles over 200 seeds: **< 0.20 in deciles 1–2, > 0.55 in deciles 5–7, < 0.25 in deciles 9–10.** Non-monotone by design (§4.6) — the return is asserted, not merely permitted. |
| A11 | **Plan performance.** `plan()` p95 ≤ 40 ms for a 500-step plan over the full corpus (§6.2). |
| A12 | **Diagnostics are typed and complete.** Every starvation, degradation and redraw appears in `plan.diagnostics`. **Zero `lane-starved` on the reference config.** |
| A13 | **Theme is shared across lanes** at every step, and the theme walk holds for `THEME_HOLD` steps between pivots (§4.4). |

### Corpus (gated at Tranche 1 — §7.2)

| # | Criterion |
|---|---|
| B1 | Every tag holds **≥54** records (3 lanes × an 18-step peak dwell). |
| B2 | Every record has all three person variants; `invariant` is computed correctly. |
| B3 | `pov` is non-null on 100% of records; no record is mixed-stance. |
| B4 | **Conjugation gate (§7.4).** L1–L3 pass with **zero** hard errors. The review-queue residue is triaged to zero before ship, and the machine-verified coverage percentage is published in the ingest report. |
| B5 | Ingester is idempotent: re-ingest ⇒ byte-identical pool. |
| B6 | Zero lint errors (placeholders, braces, trailing periods, dashes, word count, GPT-isms). |
| B7 | `induction` and `emergence` themes exist with ≥40 records each, **hand-reviewed** (T0). |
| B8 | **Sidecar integrity:** `persons[id][record.markers.pov] === record.text` for 100% of records (§2.3). |
| B9 | Provenance is present on every Phase B record, absent-or-`human` on the original 612. |

### Rendering

| # | Criterion |
|---|---|
| C1 | Three channels render with §5.3 geometry; center is unambiguously dominant. |
| C2 | The right channel visibly leads the center by ~1 s; the stagger reads as intentional. |
| C3 | *(Tuning observation, not a ship gate — §4.9.)* Channels drift against each other over a full session. Recorded and reviewed at the Phase D sitting; `driftPct` tunable to 0. |
| C4 | A 20-minute session sustains 60 fps on a mid-range laptop; heap flat at start vs. end. The three lanes are written outside the React reconciler (§5.4). |
| C5 | Session ends with the ~2.5 s quiet tail and 1.5 s fade, then §6.6's exit. Never stops abruptly. |
| C6 | Placeholder substitution never throws; a malformed template degrades to showing itself. |
| C7 | **Both `parallel` and `unison` render correctly**, and no `unison` tick shows three byte-identical strings (§4.7). |
| C8 | **Clock.** No `setInterval` anywhere in the session path (lint). Backgrounding the tab for 60 s and returning produces no burst of queued lines. |
| C9 | **Accessibility.** `prefers-reduced-motion` yields a working static-field session; nothing exceeds ~3 Hz; Escape stops within 1.5 s with a fade; side lanes clear 4.5:1 against the shader's brightest frame. |

### End-to-end (Phase D)

| # | Criterion |
|---|---|
| D1 | Configure → Play → a full 20-minute session, unattended, no console errors. |
| D2 | `npm run session:dump` produces a human-readable transcript, and a reviewer reading it confirms the arc: gentle open, build, peak, wean, wake. |
| D3 | Live-feedback counts equal what the plan actually contains. |
| D4 | A starving config is refused **in the form**, with a message naming the fix — never at playback. |
| D5 | Deployed and reachable at a real URL, hard-refresh included (SPA-fallback gap closed). |
| D6 | The design doc lands in-repo under `docs/` — **required by issue #67 before implementation starts.** |
| D7 | **One real sitting**, reviewed against four questions: does the person drift read as deliberate on the way in and as *release* on the way out; does `unison` or `parallel` land harder; does the drift jitter read as texture or as broken timing; does the peak read as absorbing or overwhelming. Each answer is a config change, not a rebuild (§4.6, §4.9). |

### Explicitly out of 1.0

Strudel and generative mood beds (§1.4 — AGPL vs public MIT unresolved); catalog_v4 as a
runtime scheduler (§0.4); points, favorites, blocklist UI, custom mantras (§6.8);
hypnoapp#60's tone sliders (`markers` accepts them additively); TTS/audio mantras;
`arc`/`random`/`tier_gate`; the conductor `sections` program; `burst`; the v3 surface
parser; the `permanence`/`identity`/`pov` marker slots (§2.2); the `base_points` intensity
axis and every gate, cap, report grid and diagnostic built on it (§2.1, §2.6, §4.3).

---

## 10. The five open questions from recon-hypnocli §12, answered

| Q | Answer |
|---|---|
| 1. Block granularity? | **A block is a theme, and there is no second dimension.** §4.3. Driven by **[MEASURED]** median cell size 5, and confirmed by the later finding that the cell axis was fabricated. |
| 2. Extend the placeholder grammar? | **No. Bare `{subject}`/`{operator}` only.** Pre-render three person variants into a sidecar (§2.3). The richer grammar is a Phase B intermediate. Justified by the structural breakage of the only existing runtime conjugator. |
| 3. Does the center titrate? | **The center is the 2nd-person anchor; its person never titrates.** Its *theme* follows the shared schedule like all channels. Matches hypnocli's flagship anchored-center shape, which judge 3 correctly noted the base proposal's rival discarded. |
| 4. Person-drift schedule? | **Reuses the titration interface** — a curved function of clamped progress over an ordered person set, sampled with hold-and-pivot hysteresis, independently per side, **and it returns**. §4.6. |
| 5. Dwell? | **Variable: 4200 ms → 2900 ms → 4200 ms**, mean ≈3400 ms, inside the **[MEASURED]** 3.2–3.5 s band, with the pacing bell phase-offset from the intensity bell. §4.9. |

recon-hypnoapp §8's four open issues: **#67** is answered by this document; **#66** is
resolved as deferred-with-the-seam-cut (§1.4); **#62**'s five questions are answered by §4.3
(granularity), §4.5+§5 (pattern→output), §5.5 (visual integration), §4.4 (theme weaving) —
it should close as consolidated into #67; **#60** is out of scope with its extension point
preserved (§2.2).

---

## 11. What was cut, and what comes next

**Cut from the brief's maximal reading:**

- **The v3 surface grammar and its parser.** Ported its *semantics* as data structures; did
  not port a text DSL we would only use to talk to ourselves.
- **Strudel.** Deferred behind an interface on an unresolved AGPL-vs-public-MIT question and
  on the #66 spec's own v0 staging.
- **Titration modes `arc`/`random`, and `tier_gate`.** Gaussian won a blind study.
- **conditioner's points economy.** Slots, favorites, blocklist, customs. Retained the
  *3-to-5 themes* advice without the gate.
- **The conductor `sections` program.** A genuinely different session shape; the data model
  does not foreclose it.
- **The `permanence`/`identity` marker slots.** §2.2 — deleted rather than populated; a
  lexical rule enforces the permanence doctrine without an LLM classifier gating ingest.
- **A Python ingest toolchain.** One language on the critical path (§1.2).

**1.1, in order:**

1. **Whichever triplet mode D7 says lands harder**, promoted to default. Both already ship.
2. **Corpus growth**, so the vocabulary can grow past 25 tags without splitting one below
   the floor.
3. **catalog_v4 vocabulary reconciliation** — not adoption. **[MEASURED]** it covers 9 of 22
   pool themes; 1.1 starts by reconciling the two ontologies, and only then asks whether a
   DAG should pick the theme sequence.
4. **Strudel beds**, once licensing is settled deliberately rather than incidentally.

---

## 12. Risk register — every judge-named risk, dispositioned

| # | Risk (judge) | Disposition |
|---|---|---|
| R1 | Conjugation gate is a 200-record sample against ~13,000 strings; 1% defect rate ships ~43 broken strings (J1, J2) | **MITIGATED, partially.** §7.4's three-layer precision-first gate, reshaped by **[MEASURED]** table coverage of 61% and a 39% false-positive rate for the naive form. Residue goes to a bounded review queue with a published coverage number. **[ACCEPTED RISK]** short of 100% proof. |
| R2 | Plausible configs unplannable (J1) | **CLOSED.** Widening is deleted with the tier axis; every tag now holds ≥54 records, so a block always fields a triplet. A12 asserts zero `lane-starved` on the reference config. |
| R3 | Theme selection per step is unspecified — a hole in the largest module, sitting on the parity pillar (J1) | **CLOSED.** §4.4 specifies it: shared across lanes, hold-and-pivot walk, coverage-weighted pivot, diagnostic on thin coverage. A13 tests it. |
| R4 | ±6% drift jitter is an unmeasured cross-modal aesthetic claim locked in as a ship gate (J1, J3) | **MITIGATED.** Halved to ±4%, exposed as `SessionOptions.driftPct`, and **C3 demoted from ship gate to tuning observation** reviewed at D7. |
| R5 | `plan()` on every keystroke with no performance budget (J1) | **CLOSED.** §6.2 sets p95 ≤ 40 ms, asserted by A11, with a specified counts-only degradation path. |
| R6 | No defined degraded-but-shippable state if Phase B partially completes (J1) | **CLOSED.** §7.2 tranches Phase B; **T1 (≥8/cell) is the ship gate**, T2 (≥24) a tracked quality target, T0 (induction/emergence) hand-authored first. |
| R7 | `FrameState` named as the critical seam but never typed; two agents block on an unowned type (J2) | **CLOSED.** §8 moves all shared types into M1, which lands alone before the parallel wave. |
| R8 | Reference fixture defined as the output of the function that has not been written — circular (J2) | **CLOSED.** §8: fixtures are **hand-authored specifications**. M2 reproduces; M4 renders. |
| R9 | Center-lane starvation — zero 2nd-person records exist (J2) | **MITIGATED.** T0/T1 make the `second` variant mandatory on every record (B2), and load-time validation drops variant-incomplete records rather than rendering a wrong stance. Pre-Phase-B builds run against `corpus.mini.json`, which carries authored second variants. |
| R10 | Cross-lane rule contradicts the coordinated-triplet reading it cites (J2) | **CLOSED.** §4.7 makes the two readings explicit modes with different rules: `parallel` forbids id collisions; `unison` requires the shared id and forbids `invariant` mantras. C7 tests both. |
| R11 | Person drift, neutral bias and hysteresis are unprecedented and land in the deepest module (J2) | **MITIGATED.** All four parameters are `SessionOptions` fields from day one; D7 reviews them; every answer is a config change. |
| R12 | Corpus contract validated twice in two languages; schema drift (J2) | **CLOSED.** §1.2: ingest is TypeScript importing M1's schema module. One validator. |
| R13 | LLM-judged `permanence`/`identity` gating ingest (J2, J3 opposed) | **CLOSED by deleting the fields.** Both measured `true` on 0 of 2,639 records; §7.5/CORPUS_SPEC enforces the permanence doctrine lexically, with no classifier in the rejection path. |
| R14 | Session length open while corpus volume is derived from it (J2) | **CLOSED.** §4.9 fixes mean dwell at 3400 ms (variable 2900–4200) *before* Phase B's batch count is set. §7.1's target derives from dwell steps, not wall clock. |
| R15 | `unison` renders `invariant` records as three identical strings; over-generating them worsens it (J3) | **CLOSED.** §4.7 refuses and redraws; §4.6 gives person-free records a scheduled job at the drift pivot instead. CORPUS_SPEC caps the impersonal share rather than over-generating it. |
| R16 | Emergence corpus does not exist, has no exemplars, and blocks every session (J3) | **MITIGATED.** §7.2 T0: authored **first**, by hand or hand-reviewed line by line, precisely because it has no voice to imitate. B7 gates it. |
| R17 | The person drift's return has no test distinguishing it from a bug (J3) | **MITIGATED.** A9 asserts the decile shape in *both* directions (the return is asserted, not permitted); D7 asks a human specifically whether the wean reads as release or as decay. |
| R18 | Titrating the center contradicts hypnocli's flagship anchored-center shape (J3) | **CLOSED.** §4.6 and Q3: the center is a fixed 2nd-person anchor whose person never drifts. The base design already had this right; it is now stated explicitly and tested by A9. |
| R19 | All difficulty axes peak simultaneously by construction (J3) | **CLOSED.** §4.9 phase-offsets the dwell bell to `peak=0.62` and the person bell to `peak=0.55`, so pacing, depth and dissociation no longer coincide. |
| R20 | React's reconciler between the session clock and the pixels (J3) | **CLOSED.** §5.4 mandates raw DOM writes from a `performance.now()` rAF loop, outside React. C4/C8 test it. |
| R21 | catalog_v4 deferral inherited uncritically (J1) | **CLOSED.** §0.4 records the **[MEASURED]** 9-of-22 coverage as the reason, and §11 makes 1.1 start from reconciliation rather than adoption. |
| R22 | Repo traps corrupt every agent's branch (J2) | **CLOSED.** §1.5 — all four re-verified live this session; M0 lands alone and first. |
