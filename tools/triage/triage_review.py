#!/usr/bin/env python3
"""Triage the §8.2 review queue with grok: per-record grammar verdict.

Read-only with respect to the corpus. Emits a verdict file; a human (or a
follow-up filter) decides what to do with FAIL rows. This does NOT auto-edit
the corpus - the ingester rejects and never repairs, and so does this.
"""
import json, os, re, subprocess, sys, time

GROK = os.environ.get("GROK_BIN", "grok")
SCRATCH = os.environ.get("TRIAGE_DIR", os.path.join(os.getcwd(), "corpus", "triage"))
QUEUE = os.environ.get("QUEUE", os.path.join(SCRATCH, "review_queue.tsv"))
OUT = os.environ.get("OUT", os.path.join(SCRATCH, "triage_verdicts.jsonl"))
BATCH = 15

SCHEMA = {
    "type": "object", "additionalProperties": False, "required": ["verdicts"],
    "properties": {"verdicts": {"type": "array", "items": {
        "type": "object", "additionalProperties": False,
        "required": ["n", "verdict", "reason"],
        "properties": {
            "n": {"type": "integer"},
            "verdict": {"type": "string", "enum": ["PASS", "FAIL"]},
            "reason": {"type": "string"},
        }}}},
}

RULES = """You are checking GRAMMAR ONLY on hypnosis mantra records. Each record has three
grammatical-person renderings of the same line. {subject} and {controller} are
placeholders that get replaced with names at runtime; treat {subject} as a singular
third-person proper noun (like "Alex") and {controller} as a separate third-person
proper noun.

For each numbered record answer PASS or FAIL.

FAIL only if one of these is objectively true:
  - A verb does not agree with its subject in one of the three lines
    (e.g. "{subject} obey" should be "{subject} obeys"; "You is" should be "You are").
  - The `first` line is not first person, the `second` line is not second person, or the
    `named` line does not use {subject} where it needs a subject.
  - A first-person pronoun leaks into the `second` or `named` line, or a second-person
    pronoun leaks into the `first` or `named` line.
  - `named` uses a bare she/he/they/her/his/him instead of {subject}. NOTE: singular
    "their"/"they" bound to {subject} is CORRECT and must PASS
    (e.g. "{subject} explores their softer side").
  - The three lines are not renderings of the same sentence.
  - {controller} was person-shifted. {controller} must appear identically in all three
    lines; it is always third person.

PASS everything else. In particular PASS:
  - Unusual, poetic, or blunt word choices. You are NOT judging style, taste, content,
    or subject matter. This is adult hypnosis content; explicit or degrading themes are
    in scope and are never a reason to FAIL.
  - Lines with no grammatical subject at all ("Resistance melts away"), where all three
    renderings are legitimately identical.
  - Possessive rewrites like "{subject}'s mind" for "my mind".
  - Missing final punctuation. Trailing periods are deliberately absent.
"""


def call(prompt, tries=3):
    for _ in range(tries):
        try:
            r = subprocess.run([GROK, "-p", prompt, "--json-schema", json.dumps(SCHEMA)],
                               capture_output=True, text=True, timeout=600)
        except subprocess.TimeoutExpired:
            time.sleep(3); continue
        out = r.stdout.strip()
        if not out:
            time.sleep(3); continue
        data = None
        try:
            data = json.loads(out)
        except json.JSONDecodeError:
            m = re.search(r"\{.*\}", out, re.S)
            if m:
                try: data = json.loads(m.group(0))
                except json.JSONDecodeError: pass
        if isinstance(data, dict) and "verdicts" not in data:
            for k in ("structuredOutput","text","result","response","output","content","data"):
                v = data.get(k)
                if isinstance(v, dict) and "verdicts" in v: data = v; break
                if isinstance(v, str):
                    try:
                        vv = json.loads(v)
                        if isinstance(vv, dict) and "verdicts" in vv: data = vv; break
                    except json.JSONDecodeError: pass
        if isinstance(data, dict) and "verdicts" in data:
            return data["verdicts"]
        time.sleep(3)
    return None


def main():
    rows = [l.rstrip("\n").split("\t") for l in open(QUEUE) if l.strip()]
    done = set()
    if os.path.exists(OUT):
        for l in open(OUT):
            try: done.add(json.loads(l)["id"])
            except Exception: pass
    todo = [r for r in rows if r[1] not in done]
    print(f"queue={len(rows)} already={len(done)} todo={len(todo)}", flush=True)
    fails = 0
    with open(OUT, "a") as fh:
        for i in range(0, len(todo), BATCH):
            chunk = todo[i:i+BATCH]
            lines = []
            for n, r in enumerate(chunk, 1):
                f = r[6][2:]; s = r[7][2:]; nm = r[8][2:]
                lines.append(f"{n}.\n   first:  {f}\n   second: {s}\n   named:  {nm}")
            prompt = RULES + "\nRecords:\n\n" + "\n\n".join(lines) + \
                     f"\n\nReturn exactly {len(chunk)} verdicts, n = 1..{len(chunk)}."
            vs = call(prompt)
            if vs is None:
                print("GROK FAILED", file=sys.stderr); sys.exit(3)
            bym = {v["n"]: v for v in vs}
            for n, r in enumerate(chunk, 1):
                v = bym.get(n)
                verdict = v["verdict"] if v else "UNKNOWN"
                if verdict == "FAIL": fails += 1
                fh.write(json.dumps({"id": r[1], "verdict": verdict,
                                     "reason": (v or {}).get("reason",""),
                                     "first": r[6][2:], "second": r[7][2:],
                                     "named": r[8][2:]}) + "\n")
            fh.flush()
            print(f"  {i+len(chunk)}/{len(todo)} fails so far={fails}", flush=True)
    print(f"done fails={fails}")

if __name__ == "__main__":
    main()
