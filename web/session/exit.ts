/**
 * The exit — DESIGN.md §6.6, acceptance C5, C9.
 *
 * ```
 * text stops -> field and bed fade over 4s -> black for 2s -> `again · done`
 * ```
 *
 * **No stats, no score, no "you completed 340 mantras", no share prompt.**
 * Coming out of trance into a gamification screen is a category error, and the
 * absence is the feature: this file's entire output surface is two opacities
 * and one line of text with two words in it. Everything the old app would have
 * put here — counts, streaks, a share button — is not disabled behind a flag,
 * it is not built.
 *
 * WHERE THIS SITS RELATIVE TO THE PLAN'S OWN TAIL. §4.11's tail (2.5s of quiet
 * plus a 1.5s fade) is specified at the PLAN level and this exit at the UI
 * level, and they COMPOSE (§6.6). The plan's tail is the session ending: the
 * last token drains, then quiet, then the master fade takes the text down. This
 * file starts where that finishes — `ended` on the frame is what arms it. So a
 * session never stops abruptly (C5) and never double-fades: the text is already
 * gone before the field starts moving.
 *
 * ESCAPE (C9). An escape mid-session runs THIS SAME SEQUENCE, only faster. A
 * hard cut out of deep trance is unpleasant, so the requirement is "stops
 * within 1.5s with a fade, never a cut" — which is a shorter exit, not a
 * different one. `ABORT_FADE_MS` is that budget, and the same state machine
 * plays it.
 */

import { ease } from '../../engine/render/ease.ts';

/** §6.6: field and bed fade over four seconds. */
export const EXIT_FADE_MS = 4000;

/** §6.6: black for two seconds before the line appears. */
export const EXIT_BLACK_MS = 2000;

/** How long the closing line takes to cross-fade in. §5.6's floor, generously. */
export const EXIT_LINE_FADE_MS = 800;

/**
 * The escape budget — C9: "Escape stops within 1.5s with a fade, never a cut."
 *
 * 1200ms of fade leaves 300ms of headroom inside the 1.5s so the promise holds
 * on a frame-dropping machine rather than exactly on a fast one.
 */
export const ABORT_FADE_MS = 1200;

/** The closing line. Two words and a middot; §6.6 permits nothing else. */
export const EXIT_LINE = 'again · done';

/**
 * The reduced-motion exit (§5.6, C9).
 *
 * Cross-fades collapse to 200ms, but the BLACK does not: the two seconds of
 * nothing between the field going and the line arriving is a pause, not an
 * animation, and shortening it would take away the beat that makes the ending
 * an ending. Reduced motion means less movement, not less time.
 */
export const REDUCED_EXIT_FADE_MS = 200;

export type ExitStage = 'fading' | 'black' | 'closed';

/** What the exit sequence looks like at one instant. */
export interface ExitState {
  stage: ExitStage;
  /** Field and bed multiplier in [0,1], falling to 0 across the fade. */
  field: number;
  /** Text master multiplier. Zero throughout: the text stopped before this began. */
  text: number;
  /** Opacity of the `again · done` line, in [0,1]. */
  line: number;
  /** True once the line is fully present and the session is over. */
  complete: boolean;
}

export interface ExitOptions {
  /** 200ms cross-fades (§5.6). The black beat is unchanged. */
  reducedMotion?: boolean;
  /**
   * Run the abort-length fade instead of the full exit.
   *
   * Set when Escape or `stop()` ends a session early. Same sequence, 1200ms of
   * fade instead of 4000 — because C9 asks for a fast fade, and a fast fade of
   * the sequence the user would have gotten anyway is less jarring than a
   * second, different ending they have never seen.
   */
  abort?: boolean;
}

interface ExitSchedule {
  fadeMs: number;
  blackMs: number;
  lineFadeMs: number;
  totalMs: number;
}

export function exitSchedule(options: ExitOptions = {}): ExitSchedule {
  const fadeMs = options.abort
    ? ABORT_FADE_MS
    : options.reducedMotion
      ? Math.max(REDUCED_EXIT_FADE_MS, EXIT_FADE_MS / 2)
      : EXIT_FADE_MS;
  // An aborted exit skips the two-second black: the user asked to leave, and
  // holding them on a black screen after they pressed Escape reads as a hang.
  const blackMs = options.abort ? 0 : EXIT_BLACK_MS;
  const lineFadeMs = options.reducedMotion ? REDUCED_EXIT_FADE_MS : EXIT_LINE_FADE_MS;
  return { fadeMs, blackMs, lineFadeMs, totalMs: fadeMs + blackMs + lineFadeMs };
}

/**
 * The exit at `tMs` into the sequence. Pure; driven from the same rAF loop.
 *
 * `tMs` is time since the exit ARMED, not session elapsed time — the exit
 * outlives the session clock, which stops when the plan does.
 */
export function exitAt(tMs: number, options: ExitOptions = {}): ExitState {
  const schedule = exitSchedule(options);
  const t = Number.isFinite(tMs) && tMs > 0 ? tMs : 0;

  if (t < schedule.fadeMs) {
    // `late` on the way out: the field lingers and then goes, which is the
    // shape of a light being turned down rather than switched off.
    const p = schedule.fadeMs > 0 ? t / schedule.fadeMs : 1;
    return { stage: 'fading', field: 1 - ease('late', p), text: 0, line: 0, complete: false };
  }

  const afterFade = t - schedule.fadeMs;
  if (afterFade < schedule.blackMs) {
    return { stage: 'black', field: 0, text: 0, line: 0, complete: false };
  }

  const intoLine = afterFade - schedule.blackMs;
  const p = schedule.lineFadeMs > 0 ? Math.min(1, intoLine / schedule.lineFadeMs) : 1;
  return {
    stage: 'closed',
    field: 0,
    text: 0,
    line: ease('early', p),
    complete: p >= 1,
  };
}

/**
 * Low-contrast, per §6.6. Held as a number because "low-contrast" has to be a
 * value somewhere and a magic `0.35` inside a style string is where it drifts.
 *
 * This is the ONE place in the app where low contrast is correct: the line is
 * an exit affordance for someone surfacing, not content to be read, and it
 * carries no information that is lost if it is missed. The side lanes' 0.30
 * alpha is a different case entirely and IS held to 4.5:1 (C9).
 */
export const EXIT_LINE_OPACITY = 0.35;
