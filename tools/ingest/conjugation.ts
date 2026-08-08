/**
 * Person correctness — CORPUS_SPEC.md §8.2.
 *
 * Three PRECISION-FIRST layers. Everything the layers cannot CONFIRM is
 * routed to review, never silently passed. The design constraint that shapes
 * this file: the verb table covers only 61% of subject-governed tokens, so a
 * gate that flagged "every verb governed by the subject" would carry a ~39%
 * false-positive rate. Each layer therefore fires only where it is certain.
 *
 *   L1  agreement triple  — align `first` and `named`; a single-position
 *                           difference that the table confirms is CORRECT;
 *                           a bare stem where the table demands an inflected
 *                           form is a HARD error ("{subject} obey").
 *   L2  copula/auxiliary  — closed set from §4.4. HARD on mismatch.
 *   L3  stance checks     — pronoun/placeholder leakage between variants.
 *                           Skipped entirely for the invariant case.
 */

import type { Pov } from './types.ts';
import { isKnownForm, lookupBase, requiresInflection } from './verbTable.ts';

export interface GateFinding {
  severity: 'hard' | 'review';
  code: string;
  message: string;
}

export interface GateResult {
  findings: GateFinding[];
  /** True when every layer that could speak, confirmed. Drives the
   *  "N records fully machine-verified" number in the report. */
  machineVerified: boolean;
}

/* ------------------------------------------------------------------ *
 * Pronoun sets
 * ------------------------------------------------------------------ */

const FIRST_PRONOUNS = new Set([
  'i', 'me', 'my', 'mine', 'myself',
  "i'm", "i've", "i'll", "i'd",
]);

const SECOND_PRONOUNS = new Set([
  'you', 'your', 'yours', 'yourself', 'yourselves',
  "you're", "you've", "you'll", "you'd",
]);

/**
 * Words after which the next token is NOT the subject's governed verb.
 *
 * This is the precision guard that keeps L1 honest. Many table entries are
 * noun/adjective homographs — 'empty|empties', 'command|commands',
 * 'will|will', 'place|places' — so "{subject} is empty" and "{subject}
 * doesn't question the command" would otherwise be flagged as uninflected
 * verbs. After a copula the token is a predicate adjective/noun; after a
 * determiner or preposition it is a noun. In both cases the finite verb has
 * already appeared and government is spent.
 */
const GOVERNMENT_BLOCKERS = new Set([
  // copulas and auxiliaries — what follows is a predicate or a participle
  'is', 'are', 'am', 'was', 'were', 'be', 'been', 'being',
  'has', 'have', 'had', 'does', 'do', 'did',
  "doesn't", "don't", "isn't", "aren't", "can't", "won't",
  'can', 'will', 'must', 'may', 'might', 'should', 'would', 'could',
  // determiners and prepositions — what follows is a noun phrase
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'no', 'every',
  'each', 'any', 'all', 'some', 'my', 'your', 'its',
  'of', 'to', 'in', 'into', 'on', 'at', 'for', 'with', 'without',
  'from', 'by', 'as', 'like', 'through', 'under', 'over', 'before',
  'after', 'until', 'when', 'while', 'because',
]);

/**
 * §4.6 — bare 3rd-person pronouns are forbidden in `named`, so the line
 * always renders as the user's chosen name ("She sinks deeper" is a
 * rejection; "{subject} sinks deeper" is correct).
 *
 * The rule targets pronouns standing in for {subject} in SUBJECT position.
 * MEASURED: 28 of 253 hand-authored `named` records in the live pool use
 * "their"/"they" as the subject's own possessive or as a bound pronoun —
 * "{subject} explores their softer side", "Anyone can use {subject} whenever
 * they want". Those are correct singular-they English and must not be
 * rejected: a gate that hard-failed 11% of the existing corpus would be
 * switched off within a day, which is precisely the failure mode §8.2 warns
 * about. So only gendered/objective stand-ins are hard-flagged, plus a
 * sentence-initial pronoun subject.
 */
const THIRD_PRONOUNS = new Set([
  'she', 'he', 'her', 'him', 'hers', 'his', 'herself', 'himself',
]);

/** Ambiguous in this corpus — see above. Never hard-flagged. */
const SINGULAR_THEY = new Set(['they', 'them', 'their', 'theirs', 'themselves']);

/**
 * Tokenize to comparable words. Placeholders survive as single tokens so
 * they align positionally against a pronoun in the other variant.
 */
export function tokenize(text: string): string[] {
  // A placeholder carries its own possessive: "{operator}'s" is ONE token.
  // Splitting it into ["{operator}", "s"] strands a bare "s" that shifts
  // every later position and makes the following noun look like a verb
  // ("{operator}'s control" -> "control" read as an uninflected stem).
  return (
    text.match(
      /\{subject\}(?:'s)?|\{operator\}(?:'s)?|[A-Za-z]+(?:'[A-Za-z]+)?/g,
    ) ?? []
  ).map((t) => (t.startsWith('{') ? t : t.toLowerCase()));
}

/** Strip a trailing possessive so "{subject}'s" aligns with "my". */
function stripPossessive(tok: string): string {
  return tok.endsWith("'s") ? tok.slice(0, -2) : tok;
}

function hasAny(tokens: string[], set: Set<string>): boolean {
  return tokens.some((t) => set.has(stripPossessive(t)));
}

/* ------------------------------------------------------------------ *
 * Stance derivation — §4.2. pov describes the STORED text, and is derived,
 * never authored.
 * ------------------------------------------------------------------ */

export function derivePov(text: string): Pov | 'mixed' {
  const tokens = tokenize(text);
  const first = hasAny(tokens, FIRST_PRONOUNS);
  const second = hasAny(tokens, SECOND_PRONOUNS);
  const named = text.includes('{subject}');

  // §4.2: `mixed` is not a value — the caller rejects it.
  const stances = [first, second, named].filter(Boolean).length;
  if (stances > 1) return 'mixed';
  if (second) return 'second';
  if (first) return 'first';
  if (named) return 'named';
  return 'impersonal';
}

/* ------------------------------------------------------------------ *
 * L2 — copula / auxiliary closed set (§4.4)
 * ------------------------------------------------------------------ */

interface AuxRow { first: string; second: string; third: string }

const AUX: AuxRow[] = [
  { first: 'am', second: 'are', third: 'is' },
  { first: 'have', second: 'have', third: 'has' },
  { first: 'do', second: 'do', third: 'does' },
  { first: "don't", second: "don't", third: "doesn't" },
  // "I aren't" is n/a; the 2nd/3rd pair still has to be right.
  { first: "aren't", second: "aren't", third: "isn't" },
];

const AUX_FORMS = new Set(AUX.flatMap((r) => [r.first, r.second, r.third]));

function auxRowFor(word: string): AuxRow | undefined {
  const w = word.toLowerCase();
  return AUX.find((r) => r.first === w || r.second === w || r.third === w);
}

/* ------------------------------------------------------------------ *
 * The gate
 * ------------------------------------------------------------------ */

export function checkPersonCorrectness(v: {
  first: string;
  second: string;
  named: string;
}): GateResult {
  const findings: GateFinding[] = [];

  const invariant = v.first === v.second && v.second === v.named;

  // §8.2 L3 is "skipped entirely when all three variants are identical".
  // An invariant record is person-free by construction; there is nothing to
  // align and nothing to leak. It is machine-verified only if it really is
  // person-free — an identical triple that contains a pronoun is a bug
  // (it would mean the same pronoun in all three persons).
  if (invariant) {
    const tokens = tokenize(v.first);
    const leak =
      hasAny(tokens, FIRST_PRONOUNS) ||
      hasAny(tokens, SECOND_PRONOUNS) ||
      v.first.includes('{subject}');
    if (leak) {
      findings.push({
        severity: 'hard',
        code: 'L3_INVARIANT_NOT_PERSON_FREE',
        message:
          'all three variants are identical but the line carries a person ' +
          'marker; an invariant record must be person-free process voice',
      });
      return { findings, machineVerified: false };
    }
    return { findings, machineVerified: true };
  }

  const fTok = tokenize(v.first);
  const sTok = tokenize(v.second);
  const nTok = tokenize(v.named);

  /* ---- L3: stance checks (100% precision) ---- */

  if (!v.named.includes('{subject}')) {
    findings.push({
      severity: 'hard',
      code: 'L3_NAMED_NO_SUBJECT',
      message: '`named` must contain {subject}',
    });
  }
  if (hasAny(nTok, FIRST_PRONOUNS)) {
    findings.push({
      severity: 'hard',
      code: 'L3_NAMED_FIRST_PRONOUN',
      message: '`named` carries a 1st-person pronoun (stance leakage)',
    });
  }
  const bareThird = nTok.find((t) => THIRD_PRONOUNS.has(stripPossessive(t)));
  if (bareThird) {
    findings.push({
      severity: 'hard',
      code: 'L3_NAMED_BARE_PRONOUN',
      message:
        `\`named\` uses the bare 3rd-person pronoun "${bareThird}"; ` +
        '§4.6 requires {subject} so the line renders as the chosen name',
    });
  } else if (nTok.length > 0 && SINGULAR_THEY.has(stripPossessive(nTok[0]!))) {
    // "They sink deeper" opens with a pronoun where {subject} belongs. A
    // bound "their" later in the line is idiomatic and stays silent.
    findings.push({
      severity: 'review',
      code: 'L3_NAMED_LEADING_THEY',
      message:
        `\`named\` opens with "${nTok[0]}" where §4.6 expects {subject}; ` +
        'idiomatic singular-they later in the line is fine',
    });
  }

  if (!hasAny(sTok, SECOND_PRONOUNS)) {
    findings.push({
      severity: 'hard',
      code: 'L3_SECOND_NO_PRONOUN',
      message: '`second` must contain a 2nd-person pronoun',
    });
  }
  if (hasAny(sTok, FIRST_PRONOUNS)) {
    findings.push({
      severity: 'hard',
      code: 'L3_SECOND_FIRST_PRONOUN',
      message: '`second` carries a 1st-person pronoun (stance leakage)',
    });
  }
  if (v.second.includes('{subject}')) {
    findings.push({
      severity: 'hard',
      code: 'L3_SECOND_HAS_SUBJECT',
      message: '`second` must not contain {subject}',
    });
  }

  if (!hasAny(fTok, FIRST_PRONOUNS)) {
    findings.push({
      severity: 'hard',
      code: 'L3_FIRST_NO_PRONOUN',
      message: '`first` must contain a 1st-person pronoun',
    });
  }
  if (v.first.includes('{subject}')) {
    findings.push({
      severity: 'hard',
      code: 'L3_FIRST_HAS_SUBJECT',
      message: '`first` must not contain {subject}',
    });
  }

  // §4.5 — {operator} is never person-shifted: it appears identically in
  // all three variants.
  const ctlCount = (s: string) => (s.match(/\{operator\}/g) ?? []).length;
  if (
    ctlCount(v.first) !== ctlCount(v.second) ||
    ctlCount(v.second) !== ctlCount(v.named)
  ) {
    findings.push({
      severity: 'hard',
      code: 'OPERATOR_SHIFTED',
      message:
        '{operator} must appear identically in all three variants (§4.5)',
    });
  }

  /* ---- L1 / L2: align `first` against `named` ---- */

  let alignmentUsable = fTok.length === nTok.length;
  let confirmedByTable = false;

  if (alignmentUsable) {
    // Track whether the subject has been shifted to {subject} in `named`: a
    // verb only has to inflect when it is governed by that shifted subject.
    let subjectShifted = false;

    for (let i = 0; i < fTok.length; i++) {
      const a = fTok[i]!;
      const b = nTok[i]!;

      // The subject slot itself: "i" -> "{subject}", "my" -> "{subject}'s".
      if (FIRST_PRONOUNS.has(stripPossessive(a)) && b.startsWith('{subject}')) {
        // Only the nominative "I" governs a following verb; a possessive
        // ("my" -> "{subject}'s") governs a noun.
        subjectShifted = a === 'i';
        continue;
      }

      // A 1st-person pronoun may also render as singular they/their rather
      // than {subject} ("my body" -> "their body", "everyone I meet" ->
      // "everyone they meet"). Those are bound pronouns inside a noun phrase
      // or relative clause, NOT the governing subject of the main clause, so
      // they must not re-arm agreement onto the following verb.
      if (FIRST_PRONOUNS.has(stripPossessive(a)) && SINGULAR_THEY.has(stripPossessive(b))) {
        subjectShifted = false;
        continue;
      }

      if (a === b) {
        // Identical tokens are usually fine — but this is exactly where
        // "{subject} obey" hides: the author shifted the subject and left the
        // verb in its bare 1st-person form. Only fire where the table is
        // certain the stem must inflect AND the token is still governed by
        // the shifted subject.
        if (subjectShifted && requiresInflection(b) && lookupBase(b)!.base === b) {
          const entry = lookupBase(b)!;
          findings.push({
            severity: 'hard',
            code: AUX_FORMS.has(b) ? 'L2_AUX_MISMATCH' : 'L1_UNINFLECTED',
            message:
              `\`named\` uses the bare stem "${b}" where 3rd-person ` +
              `agreement requires "${entry.third}"`,
          });
        }
        // Government is spent once a finite verb or a blocker appears —
        // what follows is a predicate, a noun phrase or a new clause.
        if (subjectShifted && (GOVERNMENT_BLOCKERS.has(b) || isKnownForm(b))) {
          subjectShifted = false;
        }
        continue;
      }

      // L2 — copula / auxiliary closed set. HARD on mismatch, but only for
      // the auxiliary GOVERNED BY THE SUBJECT: a copula belonging to
      // {operator} or another noun is never person-shifted (§4.5).
      if (AUX_FORMS.has(a) || AUX_FORMS.has(b)) {
        if (!subjectShifted) continue;
        const row = auxRowFor(a) ?? auxRowFor(b)!;
        if (a !== row.first || b !== row.third) {
          findings.push({
            severity: 'hard',
            code: 'L2_AUX_MISMATCH',
            message:
              `auxiliary/copula disagreement: \`first\` has "${a}", ` +
              `\`named\` has "${b}"; §4.4 requires ` +
              `"${row.first}" -> "${row.third}"`,
          });
        } else {
          confirmedByTable = true;
        }
        // A copula/auxiliary is itself the finite verb: what follows is a
        // predicate adjective or noun ("{subject} is empty"), never another
        // verb needing 3rd-person agreement.
        subjectShifted = false;
        continue;
      }

      // L1 — agreement triple. Both forms in the SAME table entry confirms
      // the pair; a `named` form that is a bare stem needing inflection is
      // the "she obey" family and is HARD.
      const entry = lookupBase(a);
      if (entry && entry.third === b) {
        confirmedByTable = true;
        subjectShifted = false; // the finite verb has been consumed
        continue;
      }
      if (subjectShifted && requiresInflection(b) && lookupBase(b)!.base === b) {
        findings.push({
          severity: 'hard',
          code: 'L1_UNINFLECTED',
          message:
            `\`named\` uses the bare stem "${b}" where 3rd-person agreement ` +
            `requires "${lookupBase(b)!.third}"`,
        });
        continue;
      }

      // The table cannot speak to this position. Not an error — this is the
      // 39% residue the spec refuses to flag. Alignment is no longer a
      // complete confirmation.
      //
      // A token that CHANGED between the variants and is not in the table is
      // almost always the governed verb inflecting via a rule the table does
      // not carry ("spread" -> "spreads"). Government is spent here: without
      // this, the flag stays armed and the next noun that happens to be a
      // table entry gets reported as an uninflected verb
      // ("{operator}'s control" -> "control" wanting "controls").
      subjectShifted = false;
      alignmentUsable = false;
    }
  }

  // L2 on the `second` variant. The first/named loop never inspects it, so a
  // wrong 2nd-person auxiliary ("You am", "You is") would otherwise sail
  // through — the center channel is the one the user reads most.
  if (fTok.length === sTok.length) {
    // Only the auxiliary GOVERNED BY THE SUBJECT is checked. A copula
    // belonging to {operator} or to another noun is not person-shifted
    // (§4.5) — "I am powerless and {operator} is not" keeps its second
    // "is" in all three variants, and demanding am->are there would
    // hard-reject correct content.
    let governed = false;
    for (let i = 0; i < fTok.length; i++) {
      const a = fTok[i]!;
      const b = sTok[i]!;

      if (FIRST_PRONOUNS.has(stripPossessive(a)) && SECOND_PRONOUNS.has(stripPossessive(b))) {
        // A possessive shift ("my" -> "your") governs a noun, not a verb.
        governed = !a.endsWith("'s") && a === 'i';
        continue;
      }

      if (!AUX_FORMS.has(a) && !AUX_FORMS.has(b)) {
        if (governed && isKnownForm(a)) governed = false;
        continue;
      }
      if (!governed) continue;

      const row = auxRowFor(a) ?? auxRowFor(b)!;
      if (a !== row.first || b !== row.second) {
        findings.push({
          severity: 'hard',
          code: 'L2_AUX_MISMATCH',
          message:
            `auxiliary/copula disagreement: \`first\` has "${a}", ` +
            `\`second\` has "${b}"; §4.4 requires ` +
            `"${row.first}" -> "${row.second}"`,
        });
      }
      governed = false;
    }
  }

  // `second` vs `named` is a second window on the same 3rd-person form. It
  // only earns its keep when the first/named alignment was unusable (unequal
  // token counts) — otherwise it re-reports what the loop above already
  // found, and a duplicated hard error makes the review queue harder to read.
  if (fTok.length !== nTok.length && sTok.length === nTok.length) {
    let subjectShifted = false;
    for (let i = 0; i < sTok.length; i++) {
      const a = sTok[i]!;
      const b = nTok[i]!;

      if (SECOND_PRONOUNS.has(stripPossessive(a)) && b.startsWith('{subject}')) {
        subjectShifted = !a.endsWith("'s") && stripPossessive(a) === 'you';
        continue;
      }

      if (a === b) {
        if (subjectShifted && requiresInflection(b) && lookupBase(b)!.base === b) {
          findings.push({
            severity: 'hard',
            code: AUX_FORMS.has(b) ? 'L2_AUX_MISMATCH' : 'L1_UNINFLECTED',
            message:
              `\`named\` uses the bare stem "${b}" where 3rd-person ` +
              `agreement requires "${lookupBase(b)!.third}"`,
          });
        }
        if (subjectShifted && (GOVERNMENT_BLOCKERS.has(b) || isKnownForm(b))) {
          subjectShifted = false;
        }
        continue;
      }

      if (AUX_FORMS.has(a) || AUX_FORMS.has(b)) {
        if (!subjectShifted) continue;
        const row = auxRowFor(a) ?? auxRowFor(b)!;
        if (a !== row.second || b !== row.third) {
          findings.push({
            severity: 'hard',
            code: 'L2_AUX_MISMATCH',
            message:
              `auxiliary/copula disagreement: \`second\` has "${a}", ` +
              `\`named\` has "${b}"; §4.4 requires ` +
              `"${row.second}" -> "${row.third}"`,
          });
        }
        subjectShifted = false;
        continue;
      }

      if (subjectShifted && requiresInflection(b) && lookupBase(b)!.base === b) {
        findings.push({
          severity: 'hard',
          code: 'L1_UNINFLECTED',
          message:
            `\`named\` uses the bare stem "${b}" where 3rd-person agreement ` +
            `requires "${lookupBase(b)!.third}"`,
        });
      }
    }
  }

  const hard = findings.some((f) => f.severity === 'hard');

  // Machine-verified means: no hard error AND the table actually confirmed
  // the person transform somewhere. A record whose variants differ only in
  // pronouns (no verb changed) is also fully confirmed — L3 covered it and
  // the alignment held with no unexplained position.
  const machineVerified = !hard && (confirmedByTable || alignmentUsable);

  if (!hard && !machineVerified) {
    findings.push({
      severity: 'review',
      code: 'UNCONFIRMED_TRANSFORM',
      message:
        'person transform could not be machine-confirmed (verb outside the ' +
        'table, or variants differ structurally); routed to review',
    });
  }

  return { findings, machineVerified };
}
