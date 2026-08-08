#!/usr/bin/env python3
"""Audit Tranche 0 output against CORPUS_SPEC gates."""
import json
import os
import re
import sys
from collections import Counter

RAW = os.environ.get(
    "CORPUS_RAW",
    os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "corpus", "raw"
    ),
)
BANDS = {"basic": (20, 44), "light": (45, 74), "moderate": (75, 109)}
FIRST_PRON = re.compile(r"\b(I|me|my|mine|myself)\b", re.I)
SECOND_PRON = re.compile(r"\b(you|your|yours|yourself)\b", re.I)
BARE_3P = re.compile(r"\b(she|he|they|her|his|him|their|them)\b", re.I)
PERM = re.compile(r"\b(forever|permanent|permanently|never again|for good|irreversible|can never)\b", re.I)
GPTISM = re.compile(r"\b(delve|tapestry|symphony of|journey|beacon|vessel of)\b", re.I)


def norm(s):
    return re.sub(r"\s+", " ", s.strip()).casefold()


def main():
    errs = []
    per_theme = Counter()
    per_cell = Counter()
    seen = {}
    imperson = Counter()
    total = Counter()
    for fn in sorted(os.listdir(RAW)):
        if not (fn.startswith("induction.") or fn.startswith("emergence.")):
            continue
        theme, tier = fn.split(".")[0], fn.split(".")[1]
        lo, hi = BANDS[tier]
        with open(os.path.join(RAW, fn)) as fh:
            lines = fh.read().splitlines()
        hdr = json.loads(lines[0])
        assert hdr["schema"] == "hypnoapp.corpus.v1", fn
        assert hdr["generator"]["reviewed"] is False, fn
        for i, line in enumerate(lines[1:], 2):
            r = json.loads(line)
            tag = f"{fn}:{i}"
            f, s, n = r["first"], r["second"], r["named"]
            if "id" in r or "markers" in r:
                errs.append(f"{tag} id/markers present")
            bp = r["base_points"]
            if not isinstance(bp, int) or bp % 5 or not (lo <= bp <= hi):
                errs.append(f"{tag} base_points {bp} outside {tier} {lo}-{hi}")
            if r["themes"] != [theme]:
                errs.append(f"{tag} themes {r['themes']}")
            inv = f == s == n
            if inv:
                imperson[theme] += 1
            total[theme] += 1
            for k, v in (("first", f), ("second", s), ("named", n)):
                w = len(v.split())
                if w < 2 or w > 20:
                    errs.append(f"{tag} {k} word count {w}")
                if re.search(r"[—–‘’“”]", v):
                    errs.append(f"{tag} {k} dash/smartquote")
                if v.rstrip().endswith((".", "!", "?")):
                    errs.append(f"{tag} {k} trailing punctuation")
                if PERM.search(v):
                    errs.append(f"{tag} {k} permanence vocab below extreme")
                if GPTISM.search(v):
                    errs.append(f"{tag} {k} gpt-ism")
                ph = re.findall(r"\{([^}]*)\}", v)
                if any(p not in ("subject", "controller") for p in ph):
                    errs.append(f"{tag} {k} bad placeholder {ph}")
                if v.count("{") != v.count("}"):
                    errs.append(f"{tag} {k} unbalanced braces")
                key = norm(v)
                if key in seen and seen[key] != tag:
                    errs.append(f"{tag} {k} DUPE of {seen[key]}: {v}")
                seen.setdefault(key, tag)
            if not inv:
                if not FIRST_PRON.search(f) or "{subject}" in f:
                    errs.append(f"{tag} first stance: {f}")
                if not SECOND_PRON.search(s) or FIRST_PRON.search(s) or "{subject}" in s:
                    errs.append(f"{tag} second stance: {s}")
                if "{subject}" not in n or FIRST_PRON.search(n) or BARE_3P.search(n):
                    errs.append(f"{tag} named stance: {n}")
            else:
                if FIRST_PRON.search(f) or SECOND_PRON.search(f) or "{subject}" in f:
                    errs.append(f"{tag} invariant not person-free: {f}")
            per_theme[theme] += 1
            per_cell[(theme, tier)] += 1
    print("=== cell counts ===")
    for k in sorted(per_cell):
        print(f"  {k[0]:10s} {k[1]:9s} {per_cell[k]}")
    print("=== theme totals ===")
    for t in sorted(per_theme):
        share = 100.0 * imperson[t] / max(total[t], 1)
        print(f"  {t:10s} {per_theme[t]:3d}  impersonal {imperson[t]} ({share:.1f}%)")
    print(f"=== errors: {len(errs)} ===")
    for e in errs[:60]:
        print("  " + e)
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
