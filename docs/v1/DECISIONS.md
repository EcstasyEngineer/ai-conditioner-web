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
