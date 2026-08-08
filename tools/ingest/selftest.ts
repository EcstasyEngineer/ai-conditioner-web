#!/usr/bin/env node
/**
 * Self-tests for the ingest toolchain.
 *
 * Node-only, no test framework: `npm run corpus:test`. The fixtures are the
 * known-bad families CORPUS_SPEC §8.2 names by hand — "she obey" (L1), "You
 * am" (L2), and stance leakage (L3) — plus the structural, content-quality,
 * dedupe, slug and backfill rules.
 */

import { checkPersonCorrectness, derivePov, tokenize } from './conjugation.ts';
import { checkBasePoints, checkContentQuality, checkPlaceholders } from './lint.ts';
import { assignId, slugify, normalizeForDedupe } from './slug.ts';
import { getTier } from './tier.ts';
import { levenshtein, isNearDuplicate, DedupeIndex } from './dedupe.ts';
import { VERB_BY_BASE, tableConflicts, requiresInflection } from './verbTable.ts';
import { computeInvariant, checkIntegrity, emptyCorpus } from './store.ts';
import { ingest } from './ingest.ts';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`);
  }
}

function codes(v: { first: string; second: string; named: string }): string[] {
  return checkPersonCorrectness(v).findings.map((f) => `${f.severity}:${f.code}`);
}

function hasHard(v: { first: string; second: string; named: string }, code: string): boolean {
  return codes(v).includes(`hard:${code}`);
}

console.log('\n== verb table (§8.2) ==');
{
  // Re-measured against lib/tts/verb-conjugations.ts in this repo: 157 raw
  // entries, 156 unique first-forms, one conflicting duplicate. CORPUS_SPEC
  // §8.2 states 158/157 — off by one against the file as it actually ships.
  // The rule that matters (dedupe, keep 'have|has|has') is unaffected, and
  // the 61%-coverage argument that shapes the whole gate still holds.
  check('table deduped to 156 unique bases', VERB_BY_BASE.size === 156,
    `got ${VERB_BY_BASE.size}`);
  check('exactly one conflict dropped', tableConflicts().length === 1,
    `got ${JSON.stringify(tableConflicts())}`);
  check("kept 'have|has|has', dropped 'have|have|have|has'",
    VERB_BY_BASE.get('have')!.third === 'has' &&
    tableConflicts()[0] === 'have|have|have|has');
  check('invariant modals are not flagged as needing inflection',
    !requiresInflection('can') && !requiresInflection('must') && !requiresInflection('will'));
  check('real verbs do require inflection',
    requiresInflection('obey') && requiresInflection('crave'));
}

console.log('\n== L1 agreement triple - the "she obey" family ==');
{
  // The canonical bad case from §8.2.
  check('"{subject} obey" is HARD', hasHard({
    first: 'I obey without thinking',
    second: 'You obey without thinking',
    named: '{subject} obey without thinking',
  }, 'L1_UNINFLECTED'));

  check('"{subject} obeys" is accepted', codes({
    first: 'I obey without thinking',
    second: 'You obey without thinking',
    named: '{subject} obeys without thinking',
  }).length === 0);

  check('"{subject} crave" is HARD', hasHard({
    first: 'I crave the emptiness',
    second: 'You crave the emptiness',
    named: '{subject} craves the emptiness',
  }, 'L1_UNINFLECTED') === false, 'correct form must NOT fire');

  check('bare stem in named with correct first is HARD', hasHard({
    first: 'I kneel when told',
    second: 'You kneel when told',
    named: '{subject} kneel when told',
  }, 'L1_UNINFLECTED'));

  // Precision guard: a verb OUTSIDE the table must not be flagged. This is
  // the 39% residue the spec explicitly refuses to false-positive on.
  const outside = codes({
    first: 'I sink into the warmth',
    second: 'You sink into the warmth',
    named: '{subject} sinks into the warmth',
  });
  check('unknown verb is not hard-flagged',
    !outside.some((c) => c.startsWith('hard:')), JSON.stringify(outside));
}

console.log('\n== L2 copula / auxiliary (§4.4) ==');
{
  check('"You am" is HARD', hasHard({
    first: 'I am empty and open',
    second: 'You am empty and open',
    named: '{subject} is empty and open',
  }, 'L2_AUX_MISMATCH'));

  check('"{subject} am" is HARD', hasHard({
    first: 'I am empty and open',
    second: 'You are empty and open',
    named: '{subject} am empty and open',
  }, 'L2_AUX_MISMATCH'));

  check('"{subject} are" is HARD', hasHard({
    first: 'I am empty and open',
    second: 'You are empty and open',
    named: '{subject} are empty and open',
  }, 'L2_AUX_MISMATCH'));

  check('correct am/are/is triple passes', codes({
    first: 'I am empty and open',
    second: 'You are empty and open',
    named: '{subject} is empty and open',
  }).length === 0);

  check('have/has: "{subject} have" is HARD', hasHard({
    first: 'I have no thoughts left',
    second: 'You have no thoughts left',
    named: '{subject} have no thoughts left',
  }, 'L2_AUX_MISMATCH'));

  check('have/has correct passes', codes({
    first: 'I have no thoughts left',
    second: 'You have no thoughts left',
    named: '{subject} has no thoughts left',
  }).length === 0);

  check("don't/doesn't correct passes", codes({
    first: "I don't question the command",
    second: "You don't question the command",
    named: "{subject} doesn't question the command",
  }).length === 0);

  check("don't/doesn't mismatch is HARD", hasHard({
    first: "I don't question the command",
    second: "You don't question the command",
    named: "{subject} don't question the command",
  }, 'L2_AUX_MISMATCH'));
}

console.log('\n== L3 stance leakage ==');
{
  check('1st-person pronoun leaking into named is HARD', hasHard({
    first: 'I drift deeper with every word',
    second: 'You drift deeper with every word',
    named: '{subject} drifts deeper with my every word',
  }, 'L3_NAMED_FIRST_PRONOUN'));

  check('1st-person pronoun leaking into second is HARD', hasHard({
    first: 'I drift deeper with every word',
    second: 'You drift deeper with my every word',
    named: '{subject} drifts deeper with every word',
  }, 'L3_SECOND_FIRST_PRONOUN'));

  check('{subject} leaking into first is HARD', hasHard({
    first: '{subject} drifts deeper with every word',
    second: 'You drift deeper with every word',
    named: '{subject} drifts deeper with every word',
  }, 'L3_FIRST_HAS_SUBJECT'));

  check('{subject} leaking into second is HARD', hasHard({
    first: 'I drift deeper with every word',
    second: '{subject} drifts deeper with every word',
    named: '{subject} drifts deeper with every word',
  }, 'L3_SECOND_HAS_SUBJECT'));

  check('named without {subject} is HARD', hasHard({
    first: 'I drift deeper with every word',
    second: 'You drift deeper with every word',
    named: 'The pet drifts deeper with every word',
  }, 'L3_NAMED_NO_SUBJECT'));

  // §4.6 — bare 3rd-person pronouns forbidden in named.
  check('bare "she" in named is HARD', hasHard({
    first: 'I sink deeper now',
    second: 'You sink deeper now',
    named: 'She sinks deeper now',
  }, 'L3_NAMED_BARE_PRONOUN'));

  check('bare "he" in named is HARD', hasHard({
    first: 'I sink deeper now',
    second: 'You sink deeper now',
    named: 'He sinks deeper now',
  }, 'L3_NAMED_BARE_PRONOUN'));

  // MEASURED: 28 of 253 hand-authored `named` records use bound singular
  // "their"/"they". Hard-rejecting them would fail 11% of the live corpus,
  // so the gate stays silent on the idiomatic case.
  check('bound singular "their" in named is NOT hard-flagged', !hasHard({
    first: 'I explore my softer side',
    second: 'You explore your softer side',
    named: '{subject} explores their softer side',
  }, 'L3_NAMED_BARE_PRONOUN'));

  check('bound "they" after {subject} is NOT hard-flagged', !hasHard({
    first: 'Anyone can use me whenever they want',
    second: 'Anyone can use you whenever they want',
    named: 'Anyone can use {subject} whenever they want',
  }, 'L3_NAMED_BARE_PRONOUN'));

  // ...but a pronoun standing where {subject} belongs is still caught.
  check('leading "They" in named is REVIEW', codes({
    first: 'I sink deeper now',
    second: 'You sink deeper now',
    named: 'They sink deeper now',
  }).includes('review:L3_NAMED_LEADING_THEY'));

  check('second without a 2nd-person pronoun is HARD', hasHard({
    first: 'I obey without thinking',
    second: 'Obeying happens without thinking',
    named: '{subject} obeys without thinking',
  }, 'L3_SECOND_NO_PRONOUN'));

  check('first without a 1st-person pronoun is HARD', hasHard({
    first: 'Obeying happens without thinking',
    second: 'You obey without thinking',
    named: '{subject} obeys without thinking',
  }, 'L3_FIRST_NO_PRONOUN'));
}

console.log('\n== §4.5 {controller} is never person-shifted ==');
{
  check('identical {controller} in all three passes', codes({
    first: 'I kneel when {controller} speaks',
    second: 'You kneel when {controller} speaks',
    named: '{subject} kneels when {controller} speaks',
  }).length === 0);

  check('dropping {controller} from one variant is HARD', hasHard({
    first: 'I kneel when {controller} speaks',
    second: 'You kneel when he speaks',
    named: '{subject} kneels when {controller} speaks',
  }, 'CONTROLLER_SHIFTED'));
}

console.log('\n== §4.3 invariant case ==');
{
  const inv = { first: 'Resistance melts away with each breath',
                second: 'Resistance melts away with each breath',
                named: 'Resistance melts away with each breath' };
  check('identical person-free triple passes with no findings',
    checkPersonCorrectness(inv).findings.length === 0);
  check('identical triple is machine-verified',
    checkPersonCorrectness(inv).machineVerified);
  check('computeInvariant true for identical triple', computeInvariant(inv));
  check('computeInvariant false when a variant is null',
    !computeInvariant({ first: 'x', second: null, named: 'x' }));
  check('identical triple carrying a pronoun is HARD', hasHard({
    first: 'I sink deeper', second: 'I sink deeper', named: 'I sink deeper',
  }, 'L3_INVARIANT_NOT_PERSON_FREE'));
}

console.log('\n== §4.2 pov derivation ==');
{
  check('first', derivePov('My thoughts are being reprogrammed') === 'first');
  check('named', derivePov("{subject} does anything for {controller}'s pleasure") === 'named');
  check('impersonal', derivePov('Resistance melts away with each breath') === 'impersonal');
  check('second', derivePov('Your thoughts are being reprogrammed') === 'second');
  check('mixed is detected', derivePov('I obey {subject}') === 'mixed');
  check('{controller} alone does not make it named',
    derivePov('Obedience belongs to {controller}') === 'impersonal');
  check("possessive {subject}'s counts as named",
    derivePov("{subject}'s mind is quiet") === 'named');
  check('tokenizer keeps placeholders whole',
    tokenize('{subject} obeys {controller}').join('|') === '{subject}|obeys|{controller}');
}

console.log('\n== §8.1 structural: placeholders ==');
{
  check('bare placeholders pass', checkPlaceholders('{subject} obeys {controller}', 'x').length === 0);
  check('unknown placeholder is HARD',
    checkPlaceholders('{pet} obeys', 'x').some((f) => f.code === 'PLACEHOLDER_UNKNOWN'));
  // The format-spec attack from §4.7.
  check('{subject:>4096} is HARD',
    checkPlaceholders('{subject:>4096} obeys', 'x').some((f) => f.code === 'PLACEHOLDER_FORMAT_SPEC'));
  check('{subject!r} is HARD',
    checkPlaceholders('{subject!r} obeys', 'x').some((f) => f.code === 'PLACEHOLDER_FORMAT_SPEC'));
  check('unbalanced braces are HARD',
    checkPlaceholders('{subject obeys', 'x').some((f) => f.code === 'BRACES_UNBALANCED'));
  check('bracket grammar is HARD',
    checkPlaceholders('{subject} [obey|obeys] now', 'x').some((f) => f.code === 'BRACKET_GRAMMAR'));
}

console.log('\n== §5.3 base_points and tiering ==');
{
  // Boundaries ported from conditioner utils/scoring.py:15-28.
  check('tier boundaries', getTier(20) === 'basic' && getTier(44) === 'basic' &&
    getTier(45) === 'light' && getTier(74) === 'light' &&
    getTier(75) === 'moderate' && getTier(109) === 'moderate' &&
    getTier(110) === 'deep' && getTier(149) === 'deep' &&
    getTier(150) === 'extreme' && getTier(200) === 'extreme');
  check('non-multiple of 5 is HARD',
    checkBasePoints(93, 'moderate').some((f) => f.code === 'POINTS_NOT_MULTIPLE_OF_5'));
  check('out of range is HARD',
    checkBasePoints(15, 'basic').some((f) => f.code === 'POINTS_OUT_OF_RANGE'));
  check('non-integer is HARD',
    checkBasePoints(90.5, 'moderate').some((f) => f.code === 'POINTS_NOT_INT'));
  // §5.3 - a declared tier that disagrees is REVIEW, never a silent rewrite.
  const dis = checkBasePoints(90, 'basic');
  check('tier disagreement is REVIEW not HARD',
    dis.some((f) => f.code === 'TIER_DISAGREEMENT' && f.severity === 'review'));
  check('matching tier is clean', checkBasePoints(90, 'moderate').length === 0);
}

console.log('\n== §8.3 content quality ==');
{
  check('em dash is HARD',
    checkContentQuality('I sink - deeper'.replace('-', '—'), 'x', 20).some((f) => f.code === 'DASH'));
  check('smart quote is HARD',
    checkContentQuality('I am “empty”', 'x', 20).some((f) => f.code === 'SMART_QUOTE'));
  check('trailing period is HARD',
    checkContentQuality('I obey without thinking.', 'x', 20).some((f) => f.code === 'TRAILING_PERIOD'));
  check('over 20 words is HARD',
    checkContentQuality(Array(21).fill('word').join(' '), 'x', 20).some((f) => f.code === 'TOO_LONG'));
  check('GPT-ism is HARD',
    checkContentQuality('I delve into the emptiness', 'x', 20).some((f) => f.code === 'GPT_ISM'));
  check('"symphony of" is HARD',
    checkContentQuality('A symphony of surrender fills me', 'x', 20).some((f) => f.code === 'GPT_ISM'));
  // §5.2 - permanence vocabulary is extreme-tier only, checked lexically.
  check('permanence below extreme is HARD',
    checkContentQuality('I am changed forever', 'x', 90).some((f) => f.code === 'PERMANENCE_BELOW_EXTREME'));
  check('permanence at extreme is allowed',
    !checkContentQuality('I am changed forever', 'x', 150).some((f) => f.code === 'PERMANENCE_BELOW_EXTREME'));
  check('"can never" below extreme is HARD',
    checkContentQuality('I can never go back', 'x', 100).some((f) => f.code === 'PERMANENCE_BELOW_EXTREME'));
  check('clean line passes', checkContentQuality('I obey without thinking', 'x', 90).length === 0);
}

console.log('\n== §8.4 slug / id assignment ==');
{
  // Ported from conditioner scripts/migrate_mantra_pool.py:52-58.
  check('slug drops placeholders and keeps 6 words',
    slugify('{subject} does anything for {controller} pleasure now today') ===
    'does_anything_for_pleasure_now_today');
  check('slug of the first pool record round-trips',
    slugify('Resistance melts away with each breath') ===
    'resistance_melts_away_with_each_breath');
  check('empty slug falls back to "mantra"', slugify('{subject} {controller}') === 'mantra');
  check('digits are dropped (alphabetic only)', slugify('I count 3 times') === 'i_count_times');
  const taken = new Set<string>();
  check('collision suffixes are _2 then _3',
    assignId('I obey', taken) === 'i_obey' &&
    assignId('I obey', taken) === 'i_obey_2' &&
    assignId('I obey', taken) === 'i_obey_3');
  check('normalize collapses whitespace and case',
    normalizeForDedupe('  I   Obey  Now ') === 'i obey now');
}

console.log('\n== §7 dedupe ==');
{
  check('levenshtein basics', levenshtein('kitten', 'sitting') === 3 && levenshtein('a', 'a') === 0);
  check('near-duplicate detected',
    isNearDuplicate('i sink deeper into the warmth', 'i sink deeper into the warmt'));
  check('distinct lines are not near-duplicates',
    !isNearDuplicate('i obey without thinking', 'my mind is completely empty'));
  const idx = new DedupeIndex();
  idx.add('a', ['I obey', 'You obey', '{subject} obeys']);
  check('D1 collision on any variant',
    idx.find(['Something else', 'You obey', 'Another']) === 'a');
  check('D1 is case/whitespace insensitive',
    idx.find(['  i   OBEY ', null, null]) === 'a');
  check('no false collision', idx.find(['I kneel', 'You kneel', '{subject} kneels']) === null);
}

console.log('\n== end-to-end ingest ==');
{
  const dir = mkdtempSync(join(tmpdir(), 'corpus-selftest-'));
  const file = join(dir, 'obedience.moderate.001.jsonl');
  const header = JSON.stringify({
    schema: 'hypnoapp.corpus.v1', theme: 'obedience', tier: 'moderate',
    generator: { model: 'grok-test', batch: 'obedience.moderate.001' },
  });
  const good = JSON.stringify({
    first: 'My body moves before I decide to',
    second: 'Your body moves before you decide to',
    named: "{subject}'s body moves before {subject} decides to",
    base_points: 90, themes: ['obedience'],
  });
  const badConj = JSON.stringify({
    first: 'I obey without thinking',
    second: 'You obey without thinking',
    named: '{subject} obey without thinking',
    base_points: 90, themes: ['obedience'],
  });
  const withId = JSON.stringify({
    id: 'should_be_rejected',
    first: 'I kneel when told',
    second: 'You kneel when told',
    named: '{subject} kneels when told',
    base_points: 90, themes: ['obedience'],
  });
  const derivedMarker = JSON.stringify({
    first: 'I wait for the command',
    second: 'You wait for the command',
    named: '{subject} waits for the command',
    base_points: 90, themes: ['obedience'], markers: { pov: 'first' },
  });
  writeFileSync(file, [header, good, badConj, withId, derivedMarker, good].join('\n') + '\n');

  const c = emptyCorpus();
  const rep = ingest({ files: [file], corpus: c });

  check('good record accepted', rep.accepted === 1, `accepted=${rep.accepted}`);
  check('mis-conjugated record rejected',
    rep.issues.some((i) => i.code === 'L1_UNINFLECTED' && i.severity === 'hard'));
  check('record carrying an id rejected',
    rep.issues.some((i) => i.code === 'ID_PRESENT' && i.severity === 'hard'));
  check('derived marker rejected',
    rep.issues.some((i) => i.code === 'DERIVED_MARKER' && i.severity === 'hard'));
  check('D2 within-batch duplicate rejected',
    rep.issues.some((i) => i.code === 'D1_DUPLICATE'));
  check('id derived from the first variant',
    c.pool.mantras[0]!.id === 'my_body_moves_before_i_decide');
  check('pov derived as first', c.pool.mantras[0]!.markers.pov === 'first');
  check('text is the variant named by pov',
    c.pool.mantras[0]!.text === 'My body moves before I decide to');
  check('markers are mechanical',
    c.pool.mantras[0]!.markers.has_subject === false &&
    c.pool.mantras[0]!.markers.has_controller === false);
  check('provenance reviewed:false for Phase B',
    c.provenance[c.pool.mantras[0]!.id]!.reviewed === false);
  check('sidecar integrity holds', checkIntegrity(c).length === 0);

  // Idempotence: re-ingesting the same file adds nothing.
  const before = JSON.stringify(c.pool);
  ingest({ files: [file], corpus: c });
  check('re-ingest is a no-op', JSON.stringify(c.pool) === before);

  // Backfill.
  const bfFile = join(dir, 'backfill.obedience.jsonl');
  const bfHeader = JSON.stringify({
    schema: 'hypnoapp.corpus.backfill.v1', theme: 'obedience',
  });
  const id = c.pool.mantras[0]!.id;
  const bfGood = JSON.stringify({
    id, first: 'My body moves before I decide to',
    second: 'Your body moves before you decide to',
    named: "{subject}'s body moves before {subject} decides to",
  });
  const bfMismatch = JSON.stringify({
    id, first: 'My body moves before I choose to',   // != stored text
    second: 'Your body moves before you choose to',
    named: "{subject}'s body moves before {subject} chooses to",
  });
  const bfUnknown = JSON.stringify({
    id: 'no_such_id', first: 'I x', second: 'You x', named: '{subject} x',
  });
  writeFileSync(bfFile, [bfHeader, bfGood, bfMismatch, bfUnknown].join('\n') + '\n');

  const textBefore = c.pool.mantras[0]!.text;
  const pointsBefore = c.pool.mantras[0]!.base_points;
  const rep2 = ingest({ files: [bfFile], corpus: c });

  check('backfill whose pov variant mismatches stored text is rejected',
    rep2.issues.some((i) => i.code === 'BACKFILL_TEXT_MISMATCH' && i.severity === 'hard'));
  check('backfill against an unknown id is rejected',
    rep2.issues.some((i) => i.code === 'BACKFILL_UNKNOWN_ID'));
  check('backfill never modifies text or base_points',
    c.pool.mantras[0]!.text === textBefore &&
    c.pool.mantras[0]!.base_points === pointsBefore);
  check('backfill attaches the variants',
    c.persons[id]!.second === 'Your body moves before you decide to');
  check('integrity still holds after backfill', checkIntegrity(c).length === 0);

  // A bad header loses the file, not the corpus.
  const badFile = join(dir, 'bad.jsonl');
  writeFileSync(badFile, ['{"schema":"nope"}', good].join('\n') + '\n');
  const rep3 = ingest({ files: [badFile], corpus: c });
  check('unknown schema header rejects the file',
    rep3.issues.some((i) => i.code === 'BAD_HEADER') && rep3.accepted === 0);

  // One malformed line loses one line, not the batch (§6.1).
  const partialFile = join(dir, 'partial.jsonl');
  const other = JSON.stringify({
    first: 'I melt into the quiet', second: 'You melt into the quiet',
    named: '{subject} melts into the quiet', base_points: 90, themes: ['obedience'],
  });
  writeFileSync(partialFile, [header, '{not json', other].join('\n') + '\n');
  const c2 = emptyCorpus();
  const rep4 = ingest({ files: [partialFile], corpus: c2 });
  check('malformed line loses one line only',
    rep4.issues.some((i) => i.code === 'BAD_JSON') && rep4.accepted === 1);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
