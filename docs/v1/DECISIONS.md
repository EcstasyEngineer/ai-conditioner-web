# Owner decisions (2026-08-08, post-Phase-A) — BINDING on Phases B/C/D

1. **Session length**: 20 min / ~3400ms mean dwell (2900–4200ms variable) CONFIRMED.
   Phase B batch budgets derive from this.
2. **Induction/emergence batches**: grok UNSUPERVISED. No hand-authoring, no
   line-by-line owner review gate. Ground the prompts as well as possible from
   existing ecosystem voice, but do not block on human review. Accepted risk:
   off-voice drift on the bookend batches.
3. **Strudel: DROPPED ENTIRELY.** hypnoapp#66 closed. The isochronic drone behind
   the AudioBed interface is the PERMANENT audio story, not a placeholder. Remove
   Strudel-integration seams from scope; keep the AudioBed interface (it's good
   design regardless). Repo stays MIT.
4. **GPL/CC-BY-SA content**: remove at M0 (hypnosis/modular/ + the 17 unlicensed
   files). Content survives in git history. 1.0 license story is clean MIT.
5. (Earlier, from the boolean batch) hypnoapp is the home; prior UX/data model
   discarded; owner-dictated architecture in EcstasyEngineer/hypnoapp#67.

## 6. The deleted history — retrospective audit (2026-08-08)

A five-layer audit read the ~220,000 lines deleted across `eff0e71`, `9d6d734`,
`a6a672d`, `fc9d0fb` and `f4e99f3` — the Next.js app, `legacy/python-implementation/`,
research notebooks, the `scripts/` migration layer, and removed content. **The
greenfield call was correct.** Everything of substance was independently
re-derived, usually with a measurement the original never had.

Several deletions were not merely superseded but explicitly *refuted* later:
regex gender-swapping lost to the 61%-verb-table-coverage finding that put all
three person variants in `persons.json` by hand; categorized tag hierarchies lost
to the flat vocabulary's 552-pair starvation sweep; trajectory scheduling lost a
blind rater study to the gaussian. Much of the legacy tree never ran at all —
three zero-byte files, a `tools.py` that raises on any input, a provably
identity-function `ClusterCycler`, two byte-identical "strategies" under
different names.

Two findings survived, neither of which restores code:

**`catalog_v4.json` stays deleted, and stays a design record.** Read it with
`git show 4cc06db80c1e`. Its non-adoption is settled: it covers 9 of 22 themes
(41%), so a runtime DAG would work for some themes and silently no-op for the
rest. It remains useful as *authoring input* — 18 named targets with typed edges
and pre-authored progression arcs — and must not become a runtime input.

**`catalog_v3` is retired; do not re-run it.** 94.1% of its 15,485 edges carry
the identical weight 0.85 and per-target counts range from 1 to 2,231. That is a
small model's agreeableness bias, not a domain model.

The one genuinely unrecovered artifact was not hypnoapp's to keep: the 115
per-theme ontologies' `appeal` field (subject-side motivation — why a person
seeks a headspace). Its only consumer is hypnocli's `generate.py`, which read
them from this repo by absolute path; tracked into hypnocli instead
(EcstasyEngineer/hypnocli#114).
