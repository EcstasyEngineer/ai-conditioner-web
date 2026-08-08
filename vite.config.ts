import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite is the build tool, not the architecture (DESIGN.md §1.2).
 *
 * `base: '/'` and the SPA-fallback requirement are recorded in
 * docs/v1/DEPLOYMENT.md; tests/repo-hygiene.test.ts asserts the two agree, so
 * changing one here without the other fails the suite.
 *
 * No path aliases. Deep-relative imports are noisier and completely unambiguous,
 * and an alias is exactly how `engine/` would end up resolving into `web/`
 * without the lint rule noticing.
 */
export default defineConfig({
  base: '/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
