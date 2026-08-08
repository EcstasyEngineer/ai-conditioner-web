/**
 * Browser entry point.
 *
 * The mount call and the `#root` contract are M0's and are unchanged; what M7
 * replaced is the placeholder body, which is now `App` (DESIGN.md §6.1).
 *
 * `StrictMode` is kept, and it is worth saying why given that this app mounts an
 * imperative session: StrictMode double-invokes effects in development, so
 * `PlayRoute`'s mount effect runs, tears down and runs again. That is a FEATURE
 * here — it is the cheapest possible test that the session's `dispose()` really
 * releases the clock, the lanes, the bed and the GL context, because a leak
 * shows up immediately as a doubled session rather than at minute eighteen of a
 * sitting.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app.tsx';

const root = document.getElementById('root');
if (!root) {
  throw new Error('#root is missing from index.html');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
