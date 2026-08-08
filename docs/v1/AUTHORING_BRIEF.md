# AUTHORING BRIEF

The brief every line in the corpus is written against, and the reference the
ingest linter's content gates encode.

It is here, as content, rather than embedded in a generator script, because a
blind quality tournament found it is the most valuable artifact the generation
campaign produced: lines written against this brief rated S or A at **37.8%**,
against **5.1%** for the hand-authored legacy pool that predates it. The two
populations differ by brief, not by author skill — the legacy pool was written
as assertions a user types back, where a flat declarative sentence is the point.
This product shows lines to a reader instead, and that is a different brief.

---

## Prime directive

**Show the experience. Never label the state.**

> BAD "I am obedient" → GOOD "Commands drop straight into action"

Carve-out: confessions are valid even though they look like labels, because
saying them *is* the psychological act. The test is whether saying the line
would feel like **saying** something or merely **describing** something.

## Voice

Concrete nouns, present tense, 3-15 words typical and 20 hard maximum, one
concrete image, no hedging, no adjective stacking, no summary of a feeling.
A complete thought, in varied grammatical forms.

Never reference "this voice" or "this recording" — that is what makes a line
reusable across sessions and channels.

Sample lines from the corpus, for **rhythm and concreteness only**; imitate
their sentence shape, not their subject matter:

```
Resistance melts away with each breath
Thoughts quieting down
Commands drop straight into action
My thoughts are being cleaned
{subject} lets the past drift away
Each repetition reinforces the conditioning
Need blossoms inside me
{subject} reacts before thinking
My mind hangs limp, waiting to be moved
Giggles replace complexity
Acceptance grows with each syllable
{subject} enjoys feeling quiet inside
```

## Rejected patterns

The first six are the recurring failure modes a blind tournament found in the C
and F tiers, ordered by how strongly each predicts a bad line. Each names the
defect, not merely the taste.

1. **Permanence vocabulary** — *permanent, permanently, forever, irreversibly,
   can never, for good*. The single strongest quality signal in the corpus and
   it is negative: 0% of S-rated lines, 48% of F. The word does the work the
   image should do, asserting durability instead of producing an experience, and
   it breaks trance by inviting the reader to evaluate a claim.
2. **Abstract noun as grammatical subject, plus a copula** — "Sluttiness is
   {subject}'s identity", "Being blank defines my purpose". The sentence is a
   dictionary entry.
3. **Naming the mechanism** — saying *conditioning*, *brainwashing*,
   *programming*, *suggestion* out loud describes the process to the subject
   instead of performing it. A fourth-wall break.
4. **Intensifier stacking as a substitute for image** — *absolute*, *pure*,
   *total*, *completely*, *entirely*, *nothing but*. These cluster in C/F and
   never appear in S.
5. **Abstract-drain verbs** — *drains*, *dissolves*, *erases*, *replaces*
   applied to abstract nouns ("agency drains out", "choices dissolve"). Sounds
   concrete, but there is no referent the body can feel.
6. **Definitional third person** — a `{subject}` line stated *about* a subject
   rather than occupied ("{subject} is powerless to disobey"). Third person
   invites description; write the image and let the person variant follow.

Also rejected: hedged language ("starting to"), agentless passive ("Memories are
deleted"), therapeutic framing ("healing", "anxiety", "self-improvement"),
generic verbs, static descriptions, purple prose, and the GPT-ism blacklist
(*delve*, *tapestry*, *symphony of*, *journey*, *beacon*, *vessel of*).

## Mechanical rules

- No em dashes, no en dashes, no smart quotes, no trailing periods.
- Do not reuse distinctive words from the instructions in the output lines.
- Emit no `id` field and no markers. Both are assigned by the ingester.

## Person variants

Every record carries all three variants, always — first, second and named — each
grammatically correct and independently readable as a standalone line.

```
first:  "My body moves before I decide to"
second: "Your body moves before you decide to"
named:  "{subject}'s body moves before {subject} decides to"
```

**Four stances, never mixed within one line.** `first` (a 1st-person pronoun, no
`{subject}`), `named` (`{subject}`, no 1st-person pronoun), `second` (a
2nd-person pronoun), and `impersonal` (no grammatical subject at all —
"Resistance melts away with each breath"). There is no `mixed`.

**The invariant case.** Person-free process voice, whose three renderings are
byte-identical; emit the same string three times. Target 12-18% of records,
roughly its natural rate. Above 25% is a review failure.

**Third-person agreement must already be correct in `named`.** "{subject}
obeys", never "{subject} obey". The closed set that has to be right:

```
I am      -> You are      -> {subject} is
I have    -> You have     -> {subject} has
I do      -> You do       -> {subject} does
I don't   -> You don't    -> {subject} doesn't
(n/a)     -> You aren't   -> {subject} isn't
I crave   -> You crave    -> {subject} craves
I obey    -> You obey     -> {subject} obeys
```

**`{operator}` is never person-shifted.** The operator is referenced in the
third person, identically, in all three variants. A line's person axis describes
the subject and never the operator.

```
first:  "I kneel when {operator} speaks"
second: "You kneel when {operator} speaks"
named:  "{subject} kneels when {operator} speaks"
```

**No bare third-person pronouns in `named`.** Use `{subject}`, never a bare
she/he/they. "She sinks deeper" is a rejection.

**Placeholders: exactly two, bare form only.** `{subject}` and `{operator}`,
nothing else. No expanded placeholders, no `[verb|verbs]` bracket grammar in the
output, no format specs, braces balanced.
