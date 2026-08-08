/**
 * The session clock — DESIGN.md §5.4, acceptance C8.
 *
 * One decision, stated as plainly as it can be: **`elapsedMs` is the sum of
 * `performance.now()` deltas taken inside a `requestAnimationFrame` callback,
 * and it advances only while the session is running and the tab is visible.**
 * No repeating timer appears anywhere in this path, which is lint-enforced by
 * M0's `no-set-interval-in-session-path` rule.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM THE RENDERER. The failure it prevents
 * was MEASURED in this repo: `src/routes/Player.tsx:75` drove playback from a
 * hardcoded repeating timer. Backgrounded tabs throttle those, so that clock
 * accumulates a backlog while hidden and dumps a dozen queued lines the instant
 * the user switches back. A rAF loop cannot accumulate a backlog — the browser
 * simply stops calling it — but that alone is not sufficient, because the
 * WALL-CLOCK gap is still there in `performance.now()` when the loop resumes.
 * Reading absolute `performance.now() - startedAt` would therefore reproduce
 * the burst even from a rAF loop.
 *
 * So the clock ACCUMULATES DELTAS and clamps each one:
 *
 *   1. Every frame adds `now - lastNow` to `elapsedMs`, not `now - startedAt`.
 *      Time that passes while paused is never in the sum, so a resume continues
 *      from where the session stopped rather than jumping.
 *   2. Each delta is clamped to `maxFrameMs`. A single long frame — a GC pause,
 *      a tab that was hidden for a moment before `visibilitychange` fired, a
 *      laptop lid — advances the session by at most one plausible frame instead
 *      of by the whole gap. This is the belt to the visibility braces.
 *
 * The clock owns NO content. It does not know what a lane is, what a plan is,
 * or when a session ends; it emits `(elapsedMs, deltaMs)` and the renderer
 * decides. That is what makes it testable without a browser: `now` and the rAF
 * scheduler are both injectable, so a test can run a 20-minute session in a
 * millisecond and assert on the numbers.
 */

/** Milliseconds. Named so signatures read as intent rather than as numbers. */
export type Ms = number;

/** A monotonic clock reading in ms. Defaults to `performance.now`, never `Date.now`. */
export type NowFn = () => Ms;

/** A rAF-shaped scheduler. Injectable so tests drive frames by hand. */
export interface FrameScheduler {
  request(callback: (timestamp: Ms) => void): number;
  cancel(handle: number): void;
}

/** What the clock reports on every frame it advances. */
export interface ClockTick {
  /** Accumulated running time. Never includes paused or hidden time. */
  elapsedMs: Ms;
  /** How much this frame added, after clamping. */
  deltaMs: Ms;
  /** Raw clock reading for this frame, for diagnostics. */
  nowMs: Ms;
}

export interface ClockOptions {
  /** Monotonic time source. Defaults to `performance.now()`. */
  now?: NowFn;
  /** Frame scheduler. Defaults to the browser's rAF. */
  scheduler?: FrameScheduler;
  /**
   * Something that reports document visibility and notifies on change.
   * Defaults to the real `document`. Injectable because C8's central assertion
   * — background for 60s, return, get no burst — has to be testable.
   */
  visibility?: VisibilitySource;
  /**
   * The largest delta a single frame may contribute.
   *
   * 250ms is four 60fps frames' worth: generous enough that a normal hitch is
   * not silently swallowed (which would make the session run slow), tight
   * enough that a 60-second gap cannot become 60 seconds of session. The
   * asymmetry is deliberate — a session that lags a quarter-second is
   * imperceptible; one that skips a minute of content is the bug.
   */
  maxFrameMs?: Ms;
  /**
   * Whether to pause when the document hides. True per §5.4. Configurable only
   * so a test can isolate the delta clamp from the visibility handler.
   */
  pauseWhenHidden?: boolean;
}

/** The document-visibility facts the clock needs, and nothing else. */
export interface VisibilitySource {
  /** True when the tab is currently hidden. */
  hidden(): boolean;
  /** Subscribe to changes. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

/** Default: four frames at 60fps. See `ClockOptions.maxFrameMs`. */
export const DEFAULT_MAX_FRAME_MS = 250;

export interface SessionClock {
  /** Begin advancing. Idempotent; a second call while running does nothing. */
  start(): void;
  /**
   * Stop advancing and hold `elapsedMs` where it is. Idempotent.
   *
   * This is the user-facing pause AND the visibility pause. They are the same
   * operation deliberately: two independent pause states is how a session ends
   * up resumed by a tab focus the user never asked to resume.
   */
  pause(): void;
  /** Resume from the held `elapsedMs`. No-op while the tab is hidden. */
  resume(): void;
  /** Stop for good and release the frame handle and the visibility listener. */
  dispose(): void;
  /** The accumulated running time. Readable between frames. */
  readonly elapsedMs: Ms;
  /** Whether frames are currently advancing the clock. */
  readonly running: boolean;
  /** Whether a pause came from `pause()` rather than from the tab hiding. */
  readonly pausedByUser: boolean;
  /** Total wall time skipped by the visibility pause and the delta clamp. */
  readonly skippedMs: Ms;
}

/** The browser's rAF, wrapped so the default path needs no branch at the call site. */
export function browserScheduler(): FrameScheduler {
  return {
    request: (callback) => requestAnimationFrame(callback),
    cancel: (handle) => cancelAnimationFrame(handle),
  };
}

/**
 * The real `document` as a `VisibilitySource`.
 *
 * Degrades to "always visible, never changes" when there is no document, so the
 * clock is constructible in a test or a headless dump without a DOM shim.
 */
export function documentVisibility(): VisibilitySource {
  const doc = (globalThis as { document?: Document }).document;
  if (!doc) {
    return { hidden: () => false, subscribe: () => () => {} };
  }
  return {
    hidden: () => doc.visibilityState === 'hidden',
    subscribe: (listener) => {
      doc.addEventListener('visibilitychange', listener);
      return () => doc.removeEventListener('visibilitychange', listener);
    },
  };
}

/**
 * Build a session clock.
 *
 * `onTick` runs once per advanced frame, inside the rAF callback. It is the
 * ONLY place the renderer is driven from — there is no second timer anywhere in
 * the session path, which is the whole point of C8.
 */
export function createClock(onTick: (tick: ClockTick) => void, options: ClockOptions = {}): SessionClock {
  const now = options.now ?? (() => performance.now());
  const scheduler = options.scheduler ?? browserScheduler();
  const visibility = options.visibility ?? documentVisibility();
  const maxFrameMs = Math.max(1, options.maxFrameMs ?? DEFAULT_MAX_FRAME_MS);
  const pauseWhenHidden = options.pauseWhenHidden !== false;

  let elapsedMs = 0;
  let skippedMs = 0;
  let running = false;
  let disposed = false;
  let pausedByUser = false;
  /** True when the clock was running when the tab hid, so return can resume it. */
  let pausedByVisibility = false;
  let lastNow = 0;
  let handle: number | null = null;

  function frame(): void {
    handle = null;
    if (!running || disposed) return;

    const nowMs = now();
    const raw = nowMs - lastNow;
    lastNow = nowMs;

    // A negative delta means a non-monotonic time source. Contributing it would
    // run the session backwards; contributing zero merely costs a frame.
    const delta = raw > 0 ? Math.min(raw, maxFrameMs) : 0;
    if (raw > delta) skippedMs += raw - delta;

    elapsedMs += delta;

    // Schedule the NEXT frame before running the callback, so a throwing
    // renderer stops the pixels rather than the clock. A session whose clock
    // dies mid-trance is stuck on one frame with the bed still playing; one
    // whose renderer throws once recovers on the following frame.
    handle = scheduler.request(frame);
    onTick({ elapsedMs, deltaMs: delta, nowMs });
  }

  function schedule(): void {
    if (handle === null && running && !disposed) {
      handle = scheduler.request(frame);
    }
  }

  function stopFrames(): void {
    if (handle !== null) {
      scheduler.cancel(handle);
      handle = null;
    }
  }

  function begin(): void {
    if (running || disposed) return;
    running = true;
    lastNow = now();
    schedule();
  }

  function halt(): void {
    if (!running) return;
    running = false;
    stopFrames();
  }

  const unsubscribe = pauseWhenHidden
    ? visibility.subscribe(() => {
        if (disposed) return;
        if (visibility.hidden()) {
          // §5.4: pause on hide. The clock would already stop accumulating
          // because rAF stops firing — but a browser that keeps firing a
          // throttled rAF, or one that fires a single catch-up frame on
          // return, would hand us the whole gap as one delta. Pausing here and
          // resetting `lastNow` on return makes the gap structurally
          // unrepresentable rather than merely clamped.
          if (running) {
            pausedByVisibility = true;
            halt();
          }
        } else if (pausedByVisibility && !pausedByUser) {
          // Return from hidden resumes ONLY a session the tab paused. A session
          // the USER paused stays paused across a tab switch, because "I paused
          // this" outranks "the tab came back".
          pausedByVisibility = false;
          begin();
        }
      })
    : () => {};

  return {
    start(): void {
      pausedByUser = false;
      if (pauseWhenHidden && visibility.hidden()) {
        // Starting into a hidden tab arms the visibility resume rather than
        // running blind: the threshold sequence is a visual event and playing
        // it to nobody wastes it.
        pausedByVisibility = true;
        return;
      }
      begin();
    },
    pause(): void {
      pausedByUser = true;
      pausedByVisibility = false;
      halt();
    },
    resume(): void {
      pausedByUser = false;
      if (pauseWhenHidden && visibility.hidden()) {
        pausedByVisibility = true;
        return;
      }
      pausedByVisibility = false;
      begin();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      halt();
      unsubscribe();
    },
    get elapsedMs(): Ms {
      return elapsedMs;
    },
    get running(): boolean {
      return running;
    },
    get pausedByUser(): boolean {
      return pausedByUser;
    },
    get skippedMs(): Ms {
      return skippedMs;
    },
  };
}
