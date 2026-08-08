/**
 * Browser entry point.
 *
 * M0 SPINE ONLY. This exists so `npm run build` is a real signal from the first
 * commit rather than a script that has never run — a build that cannot fail
 * cannot tell you anything.
 *
 * M7 replaces the body of this file with the shell (`web/app.tsx`, the setup
 * screen and the play route). The mount call and the `#root` contract stay.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const root = document.getElementById('root');
if (!root) {
  throw new Error('#root is missing from index.html');
}

createRoot(root).render(
  <StrictMode>
    <main>
      <h1>hypnoapp</h1>
      <p>Build spine only. The shell lands with M7.</p>
    </main>
  </StrictMode>,
);
