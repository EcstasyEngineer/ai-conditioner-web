#!/usr/bin/env python3
"""Tranche 0: author induction + emergence themes from nothing.

Grounded on voice extracted from the 612-record pool. grok UNSUPERVISED per
DECISIONS.md #2 -> provenance reviewed:false.
"""
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone

GROK = os.environ.get("GROK_BIN", "grok")
BUILD = os.environ.get("BUILD_ROOT", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RAW = os.path.join(BUILD, "corpus", "raw")

TIER_BANDS = {"basic": (20, 44), "light": (45, 74), "moderate": (75, 109),
              "deep": (110, 149), "extreme": (150, 200)}

THEME_DESCRIPTIONS = {
    "induction": (
        "The crossing into trance: breath lengthening, the body settling heavier than "
        "it was, attention narrowing to one small thing until the edges of the room "
        "stop mattering"
    ),
    "emergence": (
        "The climb back up: weight returning to the hands and feet, the room "
        "reassembling, the change carried out with the eyes as they open wide awake"
    ),
}

# Voice extracted from the live pool (see notes) - concrete nouns, present tense,
# 4-8 words typical, no hedging, no labels.
POOL_VOICE = """Sample lines from the existing 612-record corpus, for RHYTHM AND CONCRETENESS ONLY.
They are conditioning themes, NOT induction or emergence. Do not imitate their subject
matter. Imitate their sentence shape: short, present tense, one concrete image, no
hedging, no adjective stacking, no summary of a feeling.

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
"""

DOCTRINE = """AUTHORING DOCTRINE (CORPUS_SPEC 9.3) - follow verbatim:
- Prime Directive: "Show the experience. Never label the state." BAD "I am obedient" ->
  GOOD "Commands drop straight into action". Carve-out: confessions are valid even though
  they look like labels, because saying them IS the psychological act. The test: would
  saying this feel like SAYING something, or merely DESCRIBING something?
- Always emit all three grammatical persons.
- Never reference "this voice" or "this recording". That is what makes a mantra reusable
  across sessions and channels.
- Four voice frames, never mixed within one mantra: First Person, Named Self, Named
  Possessive, Process.
- 3-15 words typical, 20 max. A complete thought. Varied grammatical forms.
- Rejected patterns: hedged language ("starting to"), agentless passive ("Memories are
  deleted"), therapeutic framing ("healing", "anxiety", "self-improvement"), generic
  verbs, static descriptions, adjective stacking, purple prose.
"""

PERSON_RULES = """PERSON-VARIANT RULES (CORPUS_SPEC 4) - follow verbatim:
4.1 Every record carries all three variants, always. HARD - all three are required on
    every record, even when identical. They must each be grammatically correct and
    independently readable as a standalone line. Example:
      first:  "My body moves before I decide to"
      second: "Your body moves before you decide to"
      named:  "{subject}'s body moves before {subject} decides to"
4.2 The four stances of the canonical text: first (a 1st-person pronoun, no {subject});
    named ({subject}, no 1st-person pronoun); impersonal (no grammatical subject at all,
    e.g. "Resistance melts away with each breath"); second (a 2nd-person pronoun).
    "mixed" is not a value - do not mix voice frames within one mantra.
4.3 The invariant case: person-free process voice, whose 1p/2p/3p renderings are
    byte-identical. For these, emit the same string three times. Target the impersonal
    share at 12-18% of records - roughly its natural rate. Do NOT over-generate this
    class: above 25% is a review failure.
4.4 Conjugation. HARD - third-person verb agreement must already be correct in the
    `named` string. "{subject} obeys", never "{subject} obey". The closed set that must
    be right:
      I am      -> You are      -> {subject} is
      I have    -> You have     -> {subject} has
      I do      -> You do       -> {subject} does
      I don't   -> You don't    -> {subject} doesn't
      (n/a)     -> You aren't   -> {subject} isn't
      I crave   -> You crave    -> {subject} craves
      I obey    -> You obey     -> {subject} obeys
4.5 {controller} is never person-shifted. HARD. The controller is always referenced in
    the third person, in all three variants, identically. A mantra's person axis
    describes the subject, never the controller.
      first:  "I kneel when {controller} speaks"
      second: "You kneel when {controller} speaks"
      named:  "{subject} kneels when {controller} speaks"
4.6 Bare third-person pronouns are forbidden in `named`. HARD. `named` uses {subject} and
    never a bare she/he/they. "She sinks deeper" is a rejection; "{subject} sinks deeper"
    is correct.
4.7 Placeholders: exactly two, bare form only. HARD. {subject} and {controller}. Nothing
    else. No expanded placeholders, no [verb|verbs] bracket grammar in the output, no
    format specs, braces balanced.
"""

CONTENT_RULES = """CONTENT RULES (HARD):
- No em dashes, no en dashes, no smart quotes, no trailing periods.
- 3-15 words typical, 20 words hard maximum, per variant.
- Permanence vocabulary (forever, permanent, permanently, never again, for good,
  irreversible, can never) is legal ONLY at extreme tier (base_points >= 150). Below
  that it is a hard rejection. Prefer to avoid it entirely.
- GPT-ism blacklist: delve, tapestry, symphony of, journey, beacon, vessel of, adjective
  stacking, purple prose.
- Do NOT reuse distinctive words from these instructions in the output lines.
- Emit no `id` field. Emit no markers.
"""

THEME_BRIEF = {
    "induction": """THEME: induction

This theme plays the FIRST ~10% of every session and is removed from the intensity pool
entirely. It is content about ENTERING trance. It is NOT low-intensity conditioning
content: do not write about obedience, submission, emptiness-as-a-goal, devotion,
craving, or any conditioning payload. Nothing about a controller owning the subject.

What belongs here, concretely:
- The breath lengthening on its own; the out-breath running longer than the in-breath
- Weight arriving: shoulders dropping, jaw unclenching, hands going heavy in the lap
- Narrowing: one spot on the wall, one word, one point of light, edges going soft
- The eyelids getting heavy, blinking slower, the moment they stay closed
- Sound receding: the room going further away, outside noise stopping mattering
- Counting down, stairs, a slope, sinking, settling, drifting - threshold-crossing images
- The body getting further away, warm, distant, pleasantly hard to move
- Comfort and permission to stop holding things up

Tier means DEPTH OF CROSSING, not intensity of kink:
- basic (20-44): the first settling. Sitting down, breathing out, letting the eyes rest.
- light (45-74): the drop is underway. Heaviness, narrowing, sound receding, eyes closing.
- moderate (75-109): fully across the threshold. The body distant, thought slowed to one
  thing at a time, the descent continuing on its own without effort.
- deep (110-149): far under and still descending. The body no longer reporting in, no
  sense of how long it has been, thought reduced to the voice arriving and nothing
  answering it. Still ENTERING, not conditioned: no obedience, no craving, no controller
  owning anything - just depth of absorption.
- extreme (150-200): the floor of the descent. Nothing left holding itself up, no
  interest in surfacing, awareness down to a single thread. Depth of trance ONLY - this
  is not kink intensity and carries no conditioning payload.
""",
    "emergence": """THEME: emergence

This theme plays the LAST ~10% of every session and is removed from the intensity pool
entirely. It is content about SURFACING: returning, integrating, and coming fully awake.
It exists specifically so a "wide awake" line can never fire at line 2 of a session.

What belongs here, concretely:
- Weight and sensation returning to the fingers, the toes, the hands, the feet
- The room reassembling: the chair under the body, sound coming back near, light behind
  the lids
- Counting up, climbing, rising, the surface getting close
- Stretching, a deep breath drawn on purpose, blinking, eyes opening
- Alertness ramping: clear-headed, rested, steady, present, ready for the day
- Integration: what happened settles in and stays while the eyes are open, carried out
  into the room and the rest of the day
- The classic wakener family: wide awake, fully awake, refreshed, clear

Tier means POSITION ON THE CLIMB, not intensity of kink:
- basic (20-44): the first stirrings. Fingers move, breath deepens, the room comes back.
- light (45-74): mid-climb. Rising, counting up, sensation flooding back, eyes ready.
- moderate (75-109): fully out plus integration. Eyes open, clear and steady, and the
  change carried out into the rest of the day - awake AND changed, not awake and blank.
- deep (110-149): fully surfaced and durably integrated. What settled holds while the
  eyes are open, steady through the ordinary hours, not a mood that fades at the door.
- extreme (150-200): completely awake, fully restored, and carrying the change forward
  under its own power. Bright, clear, entirely present. Permanence vocabulary is legal
  at this tier but is not required - prefer concrete images of restored alertness.

Emergence content is warm and clean. No degradation, no craving, no conditioning payload.
It may reference that something settled or stayed, without naming what.
""",
}

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["records"],
    "properties": {
        "records": {
            "type": "array",
            "minItems": 15,
            "maxItems": 20,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["first", "second", "named", "base_points", "themes"],
                "properties": {
                    "first": {"type": "string"},
                    "second": {"type": "string"},
                    "named": {"type": "string"},
                    "base_points": {"type": "integer"},
                    "themes": {
                        "type": "array",
                        "minItems": 1,
                        "items": {"type": "string"},
                    },
                },
            },
        }
    },
}


def build_prompt(theme, tier, n, avoid, angle):
    lo, hi = TIER_BANDS[tier]
    avoid_block = ""
    if avoid:
        shown = avoid[-70:]
        avoid_block = (
            "ALREADY WRITTEN for this theme - do not repeat these lines or write near\n"
            "duplicates of them. Find different images:\n"
            + "\n".join("  " + a for a in shown)
            + "\n\n"
        )
    return f"""You are authoring lines for a hypnosis mantra corpus. Output ONLY JSON matching
the provided schema. Write {n} records.

{THEME_BRIEF[theme]}
TIER: {tier}. base_points must be an integer multiple of 5 in the range {lo}-{hi} inclusive.
Vary the values across the band; do not emit the same number every time.
themes must be exactly ["{theme}"].

ANGLE FOR THIS BATCH (bias your images toward this, without naming it):
{angle}

{avoid_block}{POOL_VOICE}
{DOCTRINE}
{PERSON_RULES}
{CONTENT_RULES}
Mix the stances across the batch: roughly half first-person canonical lines ("My breath
slows on its own"), roughly a third named-self lines, and 2 or 3 impersonal process lines
whose three variants are byte-identical. Every record still carries all three fields.

Write {n} records now."""


def call_grok(prompt, tries=3):
    for attempt in range(tries):
        try:
            r = subprocess.run(
                [GROK, "-p", prompt, "--json-schema", json.dumps(SCHEMA)],
                capture_output=True,
                text=True,
                timeout=600,
            )
        except subprocess.TimeoutExpired:
            print("  timeout", file=sys.stderr)
            continue
        out = r.stdout.strip()
        if not out:
            print(f"  empty stdout rc={r.returncode} err={r.stderr[:300]}", file=sys.stderr)
            time.sleep(3)
            continue
        data = None
        try:
            data = json.loads(out)
        except json.JSONDecodeError:
            m = re.search(r"\{.*\}", out, re.S)
            if m:
                try:
                    data = json.loads(m.group(0))
                except json.JSONDecodeError:
                    pass
        if data is None:
            print(f"  unparseable: {out[:300]}", file=sys.stderr)
            time.sleep(3)
            continue
        # grok wraps structured output in an envelope: payload lives in .text
        if "records" not in data:
            for k in ("structuredOutput", "text", "result", "response", "output", "content", "data"):
                v = data.get(k)
                if isinstance(v, dict) and "records" in v:
                    data = v
                    break
                if isinstance(v, str):
                    try:
                        vv = json.loads(v)
                        if isinstance(vv, dict) and "records" in vv:
                            data = vv
                            break
                    except json.JSONDecodeError:
                        pass
        if "records" in data:
            return data["records"]
        print(f"  no records key: {list(data)[:8]}", file=sys.stderr)
        time.sleep(3)
    return None


BAD_WORDS = re.compile(
    r"\b(delve|tapestry|symphony|journey|beacon|vessel|healing|anxiety)\b",
    re.I,
)
PERMANENCE = re.compile(
    r"(\bforever\b|\bpermanent\b|\bpermanently\b|\bnever again\b|\bfor good\b|"
    r"\birreversible\b|\bcan never\b)",
    re.I,
)
FIRST_PRON = re.compile(r"\b(I|me|my|mine|myself|I'm|I've|I'll)\b", re.I)
SECOND_PRON = re.compile(r"\b(you|your|yours|yourself|you're|you've|you'll)\b", re.I)
BARE_3P = re.compile(r"\b(she|he|they|her|his|him|their|them)\b", re.I)


def norm(s):
    return re.sub(r"\s+", " ", s.strip()).casefold()


def validate(rec, tier, theme, seen):
    lo, hi = TIER_BANDS[tier]
    for k in ("first", "second", "named"):
        v = rec.get(k)
        if not isinstance(v, str) or not v.strip():
            return "missing variant " + k
        if len(v.split()) > 20 or len(v.split()) < 2:
            return "word count " + k
        if re.search(r"[—–‘’“”]", v):
            return "dash/smartquote " + k
        if v.rstrip().endswith((".", "!", "?")):
            return "trailing punct " + k
        if BAD_WORDS.search(v):
            return "blacklist " + k
        if tier != "extreme" and PERMANENCE.search(v):
            return "permanence below extreme " + k
        ph = re.findall(r"\{([^}]*)\}", v)
        if any(p not in ("subject", "controller") for p in ph):
            return "bad placeholder " + k
        if v.count("{") != v.count("}"):
            return "unbalanced braces"
    bp = rec.get("base_points")
    if not isinstance(bp, int) or bp % 5 or not (lo <= bp <= hi):
        return f"base_points {bp}"
    if rec.get("themes") != [theme]:
        rec["themes"] = [theme]
    f, s, n = rec["first"], rec["second"], rec["named"]
    invariant = f == s == n
    if not invariant:
        if "{subject}" in f or FIRST_PRON.search(f) is None:
            return "first stance"
        if SECOND_PRON.search(s) is None or FIRST_PRON.search(s) or "{subject}" in s:
            return "second stance"
        if "{subject}" not in n or FIRST_PRON.search(n) or BARE_3P.search(n):
            return "named stance"
    else:
        if FIRST_PRON.search(f) or SECOND_PRON.search(f) or "{subject}" in f:
            return "invariant not person-free"
    for v in (f, s, n):
        if norm(v) in seen:
            return "dupe"
    rec.pop("id", None)
    rec.pop("markers", None)
    return None


def main():
    plan = json.loads(open(sys.argv[1]).read())
    os.makedirs(RAW, exist_ok=True)
    calls = 0
    for job in plan:
        theme, tier, batch, n, angle = (
            job["theme"], job["tier"], job["batch"], job["n"], job["angle"],
        )
        path = os.path.join(RAW, f"{theme}.{tier}.{batch}.jsonl")
        if os.path.exists(path):
            print(f"skip {path}")
            continue
        # accumulate previously accepted lines for this theme to avoid repeats
        avoid, seen = [], set()
        for fn in sorted(os.listdir(RAW)):
            if fn.startswith(theme + "."):
                with open(os.path.join(RAW, fn)) as fh:
                    for i, line in enumerate(fh):
                        if i == 0:
                            continue
                        try:
                            r = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        avoid.append(r["first"])
                        for k in ("first", "second", "named"):
                            seen.add(norm(r[k]))
        prompt = build_prompt(theme, tier, n, avoid, angle)
        sha = hashlib.sha256(prompt.encode()).hexdigest()[:16]
        print(f"generating {theme}.{tier}.{batch} (n={n}, avoid={len(avoid)})")
        recs = call_grok(prompt)
        calls += 1
        if recs is None:
            print("FAIL", file=sys.stderr)
            sys.exit(3)
        good = []
        for r in recs:
            err = validate(r, tier, theme, seen)
            if err:
                print(f"  reject [{err}]: {r.get('first','?')[:60]}")
                continue
            for k in ("first", "second", "named"):
                seen.add(norm(r[k]))
            good.append(
                {
                    "first": r["first"],
                    "second": r["second"],
                    "named": r["named"],
                    "base_points": r["base_points"],
                    "themes": [theme],
                }
            )
        header = {
            "schema": "hypnoapp.corpus.v1",
            "theme": theme,
            "tier": tier,
            "generator": {
                "model": "grok-4.5-build",
                "prompt_sha": sha,
                "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "batch": f"{theme}.{tier}.{batch}",
                "reviewed": False,
            },
            "notes": THEME_DESCRIPTIONS[theme],
        }
        with open(path, "w") as fh:
            fh.write(json.dumps(header) + "\n")
            for g in good:
                fh.write(json.dumps(g) + "\n")
        print(f"  wrote {len(good)}/{len(recs)} -> {path}")
    print(f"grok_calls={calls}")


if __name__ == "__main__":
    main()
