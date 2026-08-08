# Corpus ingest toolchain (module M5)

Implements the Phase B contract in [`docs/v1/CORPUS_SPEC.md`](../../docs/v1/CORPUS_SPEC.md).
Node-only TypeScript, run through Node 22's native type stripping — no build
step, no added dependency. Nothing here may be imported by the browser bundle
(`tsconfig.tools.json` keeps it off the DOM lib).

## Commands

```bash
npm run corpus:ingest -- corpus/raw/*.jsonl      # validate, dedupe, emit
npm run corpus:ingest -- --import <pool.json>    # import a conditioner pool
npm run corpus:lint   -- corpus/raw/*.jsonl      # dry run, writes nothing
npm run corpus:report                            # coverage against T1/T2
npm run corpus:test                              # gate self-tests
```

Exit status is non-zero when any HARD issue was found, so CI can gate on it.

## Store

| file | contents |
|---|---|
| `corpus/pool.json` | conditioner's exact schema, byte-compatible |
| `corpus/persons.json` | `{ [id]: { first, second, named, invariant } }` |
| `corpus/provenance.json` | `{ [id]: { source, batch, model, generated_at, reviewed } }` |

The **sidecar integrity invariant** — `persons[id][record.markers.pov] === record.text`
— is asserted both at load and before emission. The ingester refuses to write
a corpus that violates it.

## Input formats

**Generation batch** — `corpus/raw/<theme>.<tier>.<batch>.jsonl`. Line 1 is a
header, every later line is one record. Ids are **assigned by the ingester**; a
record carrying an `id` is rejected, as are the derived markers
(`has_controller`, `has_subject`, `pov`).

```jsonl
{"schema":"hypnoapp.corpus.v1","theme":"obedience","tier":"moderate"}
{"first":"I stop checking whether I agree","second":"You stop checking whether you agree","named":"{subject} stops checking whether {subject} agrees","base_points":95,"themes":["obedience"]}
```

**Backfill batch** — `corpus/raw/backfill.<theme>.jsonl`. Attaches person
variants to records that already exist, and can never modify their `text` or
`base_points`. The variant matching the record's `pov` **must byte-equal** the
stored text or the line is rejected — that check is what makes backfill
incapable of rewriting the 612 hand-authored originals.

```jsonl
{"schema":"hypnoapp.corpus.backfill.v1","theme":"addiction"}
{"id":"i_want_more_and_more","first":"I want more and more","second":"You want more and more","named":"{subject} wants more and more"}
```

## Why the imported 612 have null variants

The originals carry one rendering each, not three. On import the ingester fills
the variant named by the derived `pov` and leaves the other two `null`, so
`corpus:report` shows them as incomplete rather than fabricating renderings the
gates would then have to trust. Backfill batches complete them. The 87
person-free records are the exception: they render identically in all three
persons, so their triple is complete on arrival and `invariant` is true.

## The person gate (§8.2)

Three precision-first layers; anything they cannot *confirm* goes to a review
queue rather than passing silently.

- **L1 agreement triple** — aligns `first` against `named`. Catches the
  "{subject} obey" family via the verb table.
- **L2 copula/auxiliary** — the closed set `am/are/is`, `have/has`, `do/does`,
  `don't/doesn't`, `aren't/isn't`. Checked on both `first`→`second` and
  `first`→`named`.
- **L3 stance** — pronoun and placeholder leakage between variants; skipped
  entirely for the invariant case.

**The precision constraint is the whole design.** The verb table covers ~61% of
subject-governed tokens, so a gate flagging *every* subject-governed verb would
carry a ~39% false-positive rate and be switched off within a day. Two guards
keep it honest:

1. **Government tracking.** A verb must inflect only while it is governed by
   the shifted subject. After a copula, determiner, preposition or the finite
   verb itself, government is spent — otherwise `{subject} is empty` reads
   "empty" as an uninflected verb (`empty|empties` is a real table entry), and
   `{controller}'s control` reads "control" as one.
2. **Singular *they* is not an error.** MEASURED: 28 of 253 hand-authored
   `named` records use bound "their"/"they" — `{subject} explores their softer
   side`. Only gendered stand-ins (`she`, `he`, `her`, `him`) are hard-flagged;
   a *leading* "They" is routed to review.

Verified against the live corpus: **0 hard false positives** across 141 triples
synthesized from real records, 78% machine-verified, while `{subject} obey`,
`You am` and stance leakage all still hard-fail. `npm run corpus:test` covers
these as fixtures.

## Known spec discrepancies

- CORPUS_SPEC §8.2 states the verb table holds 158 entries / 157 unique
  first-forms. Re-measured against `lib/tts/verb-conjugations.ts` as it ships:
  **157 entries, 156 unique**, one conflicting duplicate. The rule that matters
  (dedupe, keep `have|has|has`) is unaffected, as is the 61% coverage argument.
