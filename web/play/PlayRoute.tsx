/**
 * The Play route — DESIGN.md §6.1, §6.5, §6.6, §6.7; acceptance D1.
 *
 * "Three lanes, backdrop, bed, and nothing else visible. No chrome, no progress
 * bar." This component is therefore almost entirely lifecycle: it owns three
 * resources (the backdrop, the bed, the session), starts them in the right
 * order, and tears them down exactly once.
 *
 * REACT IS NOT IN THE RENDER PATH (§5.4, C4). This renders two empty divs and a
 * canvas, then hands them to `mountSession` and `mountBackdrop`. From that
 * moment until dispose, every pixel change is a direct style write from M4's one
 * rAF loop. The component re-rendering does not touch the session, and the
 * session does not cause the component to re-render — `onProgress` fires ~60
 * times a second and is deliberately NOT wired to state, because a `setState`
 * per frame is a React reconcile per frame and that is precisely the thing §5.4
 * exists to keep out of the session path.
 *
 * THE BED STARTS ON THE BEGIN GESTURE (§6.7). `createBed` is called during the
 * click handler's synchronous descendants — inside the user-activation window —
 * so the autoplay-policy failure mode is structurally impossible rather than
 * handled. What it is NOT is started from a timer, which is what would break it.
 *
 * THE PLAN IS NEVER RE-PLANNED HERE. It arrives as a prop, already built by the
 * setup screen and already the object the live sample was drawn from. A play
 * route that called `plan()` again would be a second plan, possibly different,
 * and the twenty minutes the user is about to sit through would not be the one
 * they were shown.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { SessionPlan } from '../../engine/types/plan.ts';
import { mountSession, type SessionHandle } from '../session/mountSession.ts';
import { mountBackdrop, type BackdropHandle } from '../backdrop/mountBackdrop.ts';
import { createBed, type AudioBed } from '../audio/bed.ts';

export interface PlayRouteProps {
  plan: SessionPlan;
  /** The user chose `again`. The shell re-mounts with the same plan. */
  onAgain(): void;
  /** The user chose `done`. The shell returns to Configure. */
  onDone(): void;
  /**
   * Force the reduced-motion path. Read from the media query when omitted.
   * Threaded through to both the backdrop and the session so the two agree.
   */
  reducedMotion?: boolean;
  /** Skip audio entirely. Used by the headless full-session test. */
  silent?: boolean;
  /** Injected by tests; the real mounts are the defaults. */
  mounts?: PlayMounts;
}

/**
 * The three constructors, injectable as a unit.
 *
 * Together rather than one prop each, because a test that fakes the session but
 * not the bed is a test that opens an `AudioContext` in jsdom — and the three
 * are lifecycled as one thing here anyway.
 */
export interface PlayMounts {
  mountSession: typeof mountSession;
  mountBackdrop: typeof mountBackdrop;
  createBed: typeof createBed;
}

const REAL_MOUNTS: PlayMounts = { mountSession, mountBackdrop, createBed };

/** What the exit offers, after the fade — §6.6. No stats, no score, no share. */
type Ending = 'running' | 'ended';

export function PlayRoute({
  plan,
  onAgain,
  onDone,
  reducedMotion,
  silent = false,
  mounts = REAL_MOUNTS,
}: PlayRouteProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ending, setEnding] = useState<Ending>('running');

  /**
   * `onEnd` reaches the effect through a ref rather than the dependency array.
   *
   * The effect must run exactly once per plan: it mounts a twenty-minute
   * session, and a re-run would tear that session down and start a new one from
   * zero. Putting a callback in the deps makes that happen on any parent
   * re-render that did not memoize it — a defect that would be invisible in a
   * unit test and catastrophic at minute eighteen.
   */
  const endedRef = useRef(false);
  const handleEnd = useCallback(() => {
    if (endedRef.current) return;
    endedRef.current = true;
    setEnding('ended');
  }, []);
  const handleEndRef = useRef(handleEnd);
  handleEndRef.current = handleEnd;

  useEffect(() => {
    const stage = stageRef.current;
    if (stage === null) return;

    endedRef.current = false;
    setEnding('running');

    let backdrop: BackdropHandle | null = null;
    let bed: AudioBed | null = null;
    let session: SessionHandle | null = null;

    const canvas = canvasRef.current;
    if (canvas !== null) {
      backdrop = mounts.mountBackdrop(canvas, 'pink_spiral', { reducedMotion });
    }

    if (!silent) {
      // §6.7: constructed inside the Begin gesture's activation window. The
      // session calls `start()` on its first frame, which is still inside it.
      bed = mounts.createBed(plan.bed.preset, { gainDb: plan.bed.gainDb });
    }

    session = mounts.mountSession(
      stage,
      plan,
      {
        onEnd: () => handleEndRef.current(),
        // Deliberately empty. Progress drives the field through M4's own
        // forwarding, and there is no progress bar to update (§6.1).
        onProgress: () => {},
      },
      {
        field: backdrop ?? undefined,
        bed: bed ?? undefined,
        reducedMotion,
      },
    );

    return () => {
      // Order matters: the session holds references to both of the others and
      // pushes to them from its loop, so it stops first.
      session?.dispose();
      bed?.dispose();
      backdrop?.dispose();
    };
  }, [plan, reducedMotion, silent, mounts]);

  return (
    <div className="play-route" data-testid="play-route">
      <canvas ref={canvasRef} className="play-field" data-testid="play-field" />
      <div ref={stageRef} className="play-stage" data-testid="play-stage" />

      {/* §6.6: black, then one low-contrast line. `again · done` and nothing
          else — coming out of trance into a gamification screen is a category
          error, so there is no count, no score and no share prompt here. */}
      {ending === 'ended' ? (
        <div className="play-ending" data-testid="play-ending">
          <button type="button" data-testid="again" onClick={onAgain}>
            again
          </button>
          <span aria-hidden="true"> · </span>
          <button type="button" data-testid="done" onClick={onDone}>
            done
          </button>
        </div>
      ) : null}
    </div>
  );
}
