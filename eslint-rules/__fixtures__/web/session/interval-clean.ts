// CLEAN FIXTURE — zero lint errors.
//
// The correct session clock: performance.now() sampled inside a rAF loop,
// paused on visibilitychange. A one-shot setTimeout for a fade beat is
// allowed on purpose — a single delay is not a drifting tick source.

// @ts-nocheck

export function goodClock(onFrame: (elapsedMs: number) => void): () => void {
  const origin = performance.now();
  let raf = 0;
  let running = true;

  const tick = () => {
    if (running) onFrame(performance.now() - origin);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  const onVisibility = () => {
    running = document.visibilityState === 'visible';
  };
  document.addEventListener('visibilitychange', onVisibility);

  // One-shot delay for the threshold fade: allowed.
  setTimeout(() => onFrame(0), 800);

  return () => {
    cancelAnimationFrame(raf);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
