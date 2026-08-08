/**
 * Structural (§8.1) and content-quality (§8.3) gates.
 *
 * The ingester REJECTS, never repairs.
 */

import type { Tier } from './types.ts';
import { getTier } from './tier.ts';
import type { GateFinding } from './conjugation.ts';

/* ------------------------------------------------------------------ *
 * §8.1.3 / §4.7 — placeholders: exactly two, bare form only
 * ------------------------------------------------------------------ */

const ALLOWED_PLACEHOLDERS = new Set(['subject', 'controller']);

export function checkPlaceholders(text: string, label: string): GateFinding[] {
  const findings: GateFinding[] = [];

  // Balanced braces, no nesting.
  let depth = 0;
  for (const ch of text) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    if (depth < 0 || depth > 1) break;
  }
  if (depth !== 0) {
    findings.push({
      severity: 'hard',
      code: 'BRACES_UNBALANCED',
      message: `${label}: unbalanced braces`,
    });
    return findings;
  }

  for (const m of text.matchAll(/\{([^{}]*)\}/g)) {
    const inner = m[1]!;
    if (ALLOWED_PLACEHOLDERS.has(inner)) continue;

    // §4.7 — format specs are an attack, not a typo: '{subject:>4096}'
    // passes a naive probe and then blows past output limits.
    if (/[:!]/.test(inner)) {
      const base = inner.split(/[:!]/)[0]!;
      findings.push({
        severity: 'hard',
        code: 'PLACEHOLDER_FORMAT_SPEC',
        message:
          `${label}: placeholder "{${inner}}" carries a format spec or ` +
          `conversion; only bare {${base}} is permitted`,
      });
      continue;
    }
    findings.push({
      severity: 'hard',
      code: 'PLACEHOLDER_UNKNOWN',
      message:
        `${label}: unknown placeholder "{${inner}}"; only {subject} and ` +
        '{controller} exist',
    });
  }

  // §4.7 — no [verb|verbs] bracket grammar in the OUTPUT.
  if (/\[[^\]]*\|[^\]]*\]/.test(text)) {
    findings.push({
      severity: 'hard',
      code: 'BRACKET_GRAMMAR',
      message:
        `${label}: [a|b] bracket grammar is a generation intermediate and ` +
        'must be expanded before emission',
    });
  }

  return findings;
}

/* ------------------------------------------------------------------ *
 * §8.3 — content quality
 * ------------------------------------------------------------------ */

/** §5.2 — permanence vocabulary is extreme-tier only. Lexical, no classifier. */
const PERMANENCE_VOCAB = [
  'forever',
  'permanent',
  'permanently',
  'never again',
  'for good',
  'irreversible',
  'can never',
];

/** §8.3.8 — GPT-ism blacklist. */
const GPT_ISMS = [
  'delve',
  'tapestry',
  'symphony of',
  'journey',
  'beacon',
  'vessel of',
];

const WORD_MAX = 20;

export function wordCount(text: string): number {
  return (text.trim().match(/\S+/g) ?? []).length;
}

export function checkContentQuality(
  text: string,
  label: string,
  basePoints: number,
): GateFinding[] {
  const findings: GateFinding[] = [];
  const lower = text.toLowerCase();

  // §8.3.5 — no em/en dashes, no smart quotes, no trailing periods.
  if (/[—–]/.test(text)) {
    findings.push({
      severity: 'hard',
      code: 'DASH',
      message: `${label}: em/en dash`,
    });
  }
  if (/[‘’“”]/.test(text)) {
    findings.push({
      severity: 'hard',
      code: 'SMART_QUOTE',
      message: `${label}: smart quote (use a straight apostrophe)`,
    });
  }
  if (/\.\s*$/.test(text)) {
    findings.push({
      severity: 'hard',
      code: 'TRAILING_PERIOD',
      message: `${label}: trailing period`,
    });
  }

  // §8.3.6 — 3-15 words typical, 20 hard maximum.
  const n = wordCount(text);
  if (n > WORD_MAX) {
    findings.push({
      severity: 'hard',
      code: 'TOO_LONG',
      message: `${label}: ${n} words exceeds the hard maximum of ${WORD_MAX}`,
    });
  } else if (n < 3) {
    findings.push({
      severity: 'review',
      code: 'VERY_SHORT',
      message: `${label}: ${n} words is below the typical 3-15 band`,
    });
  } else if (n > 15) {
    findings.push({
      severity: 'review',
      code: 'LONG',
      message: `${label}: ${n} words is above the typical 3-15 band`,
    });
  }

  // §5.2 / §8.3.7 — permanence vocabulary only at extreme tier.
  if (getTier(basePoints) !== 'extreme') {
    for (const term of PERMANENCE_VOCAB) {
      if (lower.includes(term)) {
        findings.push({
          severity: 'hard',
          code: 'PERMANENCE_BELOW_EXTREME',
          message:
            `${label}: permanence vocabulary "${term}" requires the extreme ` +
            `tier (base_points >= 150); this record has ${basePoints}`,
        });
      }
    }
  }

  // §8.3.8 — GPT-isms.
  for (const term of GPT_ISMS) {
    const re = new RegExp(`\\b${term.replace(/ /g, '\\s+')}\\b`, 'i');
    if (re.test(text)) {
      findings.push({
        severity: 'hard',
        code: 'GPT_ISM',
        message: `${label}: blacklisted phrasing "${term}"`,
      });
    }
  }

  return findings;
}

/* ------------------------------------------------------------------ *
 * §8.1.2 — base_points
 * ------------------------------------------------------------------ */

export function checkBasePoints(
  basePoints: unknown,
  declaredTier: Tier,
): GateFinding[] {
  const findings: GateFinding[] = [];
  if (typeof basePoints !== 'number' || !Number.isInteger(basePoints)) {
    return [
      {
        severity: 'hard',
        code: 'POINTS_NOT_INT',
        message: `base_points must be an integer, got ${JSON.stringify(basePoints)}`,
      },
    ];
  }
  if (basePoints % 5 !== 0) {
    findings.push({
      severity: 'hard',
      code: 'POINTS_NOT_MULTIPLE_OF_5',
      message: `base_points ${basePoints} is not a multiple of 5`,
    });
  }
  if (basePoints < 20 || basePoints > 200) {
    findings.push({
      severity: 'hard',
      code: 'POINTS_OUT_OF_RANGE',
      message: `base_points ${basePoints} is outside 20-200`,
    });
  }
  const actual = getTier(basePoints);
  if (actual !== declaredTier) {
    // §5.3 — a declared tier that disagrees with getTier() pins the record
    // for a human. Never a silent rewrite in either direction.
    findings.push({
      severity: 'review',
      code: 'TIER_DISAGREEMENT',
      message:
        `base_points ${basePoints} lands in "${actual}" but the batch ` +
        `declares "${declaredTier}"`,
    });
  }
  return findings;
}

/* ------------------------------------------------------------------ *
 * §8.3.9 — prompt contamination (REVIEW, reported per batch)
 * ------------------------------------------------------------------ */

const STOPWORDS = new Set([
  'this', 'that', 'with', 'from', 'your', 'have', 'they', 'them', 'then',
  'than', 'when', 'what', 'which', 'were', 'been', 'each', 'more', 'most',
  'some', 'such', 'only', 'other', 'into', 'over', 'also', 'about', 'their',
  'there', 'these', 'those', 'would', 'could', 'should', 'will', 'shall',
  'must', 'like', 'just', 'very', 'much', 'many', 'been', 'being', 'does',
  'mantra', 'mantras', 'theme', 'tier', 'record', 'records', 'person',
  'first', 'second', 'named', 'write', 'words', 'word', 'line', 'lines',
]);

export function distinctiveWords(prompt: string): Set<string> {
  const out = new Set<string>();
  for (const w of prompt.toLowerCase().match(/[a-z]{4,}/g) ?? []) {
    if (!STOPWORDS.has(w)) out.add(w);
  }
  return out;
}

export function promptContamination(
  texts: string[],
  promptWords: Set<string>,
): Map<string, number> {
  const hits = new Map<string, number>();
  for (const text of texts) {
    for (const w of new Set(text.toLowerCase().match(/[a-z]{4,}/g) ?? [])) {
      if (promptWords.has(w)) hits.set(w, (hits.get(w) ?? 0) + 1);
    }
  }
  return hits;
}
