/**
 * The app shell — DESIGN.md §6.1, §6.7.
 *
 * Two screens and the state that moves between them. "The UI is a pure function
 * producing a config object and holds no session state" — so what lives here is
 * the corpus, the config, and which of the two screens is showing. Session state
 * lives inside `mountSession`, where the one clock is.
 *
 * ROUTING IS A UNION, NOT A ROUTER. Two screens, one transition each way, and
 * the play route must not be reachable by typing a URL — a session that begins
 * because a link was pasted has no Begin gesture in front of it, which is what
 * §6.7 relies on to make the autoplay failure impossible. A `Route` union of two
 * cases is the whole requirement; a router would add a way to violate it.
 *
 * That is also why `docs/v1/DEPLOYMENT.md` still needs the SPA fallback (D5): a
 * hard refresh on any path must serve `index.html` and land on Configure rather
 * than 404. The app has one entry point by design; the server has to agree.
 *
 * §6.5's PRELOAD is why the corpus loads here and not in the setup screen. "The
 * full plan is computed, the pool filtered, the first three variants resolved,
 * fonts loaded and the shader compiled — all while the user is still reading
 * their sample on the setup screen." Begin therefore has nothing to wait for and
 * needs no spinner.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { Corpus, ValidationError } from '../engine/types/record.ts';
import type { SessionPlan } from '../engine/types/plan.ts';
import type { SessionOptions, UserConfig } from '../engine/types/config.ts';
import { isLoadFailure, loadCorpus } from '../engine/corpus/load.ts';

import { SetupScreen } from './setup/SetupScreen.tsx';
import { PlayRoute } from './play/PlayRoute.tsx';
import { defaultStorage, loadConfig, saveConfig, type ConfigStorage } from './persist/config.ts';

/**
 * Where the corpus files sit, as URLs the bundler emitted.
 *
 * `new URL(..., import.meta.url)` rather than a literal path or a direct JSON
 * import, and all three halves of that are deliberate:
 *
 *   NOT a literal `'corpus/pool.json'`. `corpus/` is not `public/`, so a literal
 *   path resolves in dev (where Vite serves from the project root) and 404s in
 *   the built bundle. That failure appears only after deploy, which is exactly
 *   the class of difference DEPLOYMENT.md §1 rejects. Written this way the file
 *   is emitted as a build asset and the URL carries `base` automatically.
 *
 *   NOT `import pool from '../corpus/pool.json'`. That inlines 1.75MB of JSON
 *   into the entry chunk, which has to parse before the setup screen paints —
 *   and §6.5's whole preload argument is that the corpus loads WHILE the user
 *   reads their sample. Fetched as an asset, it is three parallel requests
 *   against a shell that has already rendered.
 *
 *   NOT the `?url` suffix, which does the same job but needs `vite/client`'s
 *   ambient module declaration. The browser tsconfig sets `types: []` ON PURPOSE
 *   (M0's Node firewall: a stray ambient type package is how `process` becomes
 *   available in a browser file), and this form is plain ES that typechecks
 *   without buying that whole surface for three strings.
 */
export const CORPUS_URLS = Object.freeze({
  pool: new URL('../corpus/pool.json', import.meta.url).href,
  persons: new URL('../corpus/persons.json', import.meta.url).href,
  provenance: new URL('../corpus/provenance.json', import.meta.url).href,
});

/** The two screens. A union, not a path — see the note at the top of this file. */
type Route = { name: 'configure' } | { name: 'play'; plan: SessionPlan };

/** What the corpus fetch produced. */
type CorpusState =
  | { status: 'loading' }
  | { status: 'ready'; corpus: Corpus }
  | { status: 'failed'; reason: string; errors: ValidationError[] };

/**
 * How the app gets its corpus.
 *
 * Injected so the shell has one seam for tests and for the headless harness,
 * and so `fetch` appears in exactly one place in the module rather than in the
 * middle of a component. The engine may not fetch (§1.3); this is `web/`, which
 * may, and it hands already-parsed values to `loadCorpus`.
 */
export type CorpusFetcher = () => Promise<{
  pool: unknown;
  persons: unknown;
  provenance?: unknown;
}>;

export const fetchCorpus: CorpusFetcher = async () => {
  const [pool, persons, provenance] = await Promise.all([
    fetchJson(CORPUS_URLS.pool),
    fetchJson(CORPUS_URLS.persons),
    // Provenance is optional and never rendered (§2.5): a deployment without it
    // is a working deployment, so its absence resolves rather than rejects.
    fetchJson(CORPUS_URLS.provenance).catch(() => ({})),
  ]);
  return { pool, persons, provenance };
};

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} responded ${response.status}`);
  return (await response.json()) as unknown;
}

export interface AppProps {
  fetchCorpus?: CorpusFetcher;
  storage?: ConfigStorage | null;
  /** Fixed seed. Omitted, each visit gets its own session from the same config. */
  seed?: number;
  reducedMotion?: boolean;
  /** Skip audio. The full-session harness runs with this on. */
  silent?: boolean;
}

export function App({
  fetchCorpus: fetcher = fetchCorpus,
  storage = defaultStorage(),
  seed,
  reducedMotion,
  silent,
}: AppProps = {}) {
  const [corpusState, setCorpusState] = useState<CorpusState>({ status: 'loading' });
  const [route, setRoute] = useState<Route>({ name: 'configure' });
  const [config, setConfig] = useState<UserConfig>(() => loadConfig(storage).config);
  const [attempt, setAttempt] = useState(0);

  /**
   * Engine tuning, owned here because a preset expands into BOTH halves.
   *
   * Deliberately NOT persisted alongside the config. `SessionOptions` is engine
   * tuning rather than a user choice (§4.6, R11) — every field is a knob a bad
   * sitting adjusts, not a preference someone selected — and storing it would
   * mean a build that retunes a default is overridden by a value written by an
   * older build. A preset applied in this session applies for this session.
   */
  const [options, setOptions] = useState<Partial<SessionOptions>>({});

  /**
   * The session seed.
   *
   * Fixed for the lifetime of the mount when not supplied, rather than drawn per
   * plan: the setup screen rebuilds the plan on every keystroke, and a seed that
   * moved with it would reshuffle the live sample under a user who was only
   * typing their name. `Math.random` is legal here — this is `web/`, and the
   * engine receives the number rather than calling for it.
   */
  const sessionSeed = useMemo(
    () => seed ?? Math.floor(Math.random() * 0x7fffffff),
    [seed],
  );

  useEffect(() => {
    let cancelled = false;
    setCorpusState({ status: 'loading' });

    fetcher()
      .then((files) => {
        if (cancelled) return;
        const result = loadCorpus(files.pool, files.persons, files.provenance);
        if (isLoadFailure(result)) {
          setCorpusState({
            status: 'failed',
            reason: 'The mantra library did not pass validation.',
            errors: result,
          });
          return;
        }
        // §6.7: dropped records are a console warning, never a rendered hole.
        for (const w of result.warnings) console.warn(`[corpus] ${w.kind}: ${w.message}`);
        setCorpusState({ status: 'ready', corpus: result });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setCorpusState({
          status: 'failed',
          reason: "Couldn't load the mantra library.",
          errors: [],
        });
        console.error('[corpus] fetch failed', error);
      });

    return () => {
      cancelled = true;
    };
  }, [fetcher, attempt]);

  const onConfigChange = useCallback((next: UserConfig) => setConfig(next), []);

  const onStart = useCallback((plan: SessionPlan, used: UserConfig) => {
    saveConfig(used, storage);
    setRoute({ name: 'play', plan });
  }, [storage]);

  const onDone = useCallback(() => setRoute({ name: 'configure' }), []);

  /**
   * `again` — §6.6's other choice.
   *
   * Replaces the plan object identity so `PlayRoute`'s mount effect re-runs and
   * the session starts from its threshold. The CONTENT is the same session: the
   * user asked for that one again, not for a different one.
   */
  const onAgain = useCallback(() => {
    setRoute((current) =>
      current.name === 'play' ? { name: 'play', plan: { ...current.plan } } : current,
    );
  }, []);

  if (corpusState.status === 'loading') {
    return (
      <main className="app app--loading" data-testid="app-loading">
        <p>Loading…</p>
      </main>
    );
  }

  if (corpusState.status === 'failed') {
    // §6.7, verbatim: never a blank screen or a React error boundary. Begin is
    // not merely disabled — there is no form to press it in.
    return (
      <main className="app app--failed" data-testid="app-failed">
        <p role="alert">{corpusState.reason} Retry.</p>
        <button type="button" data-testid="retry" onClick={() => setAttempt((n) => n + 1)}>
          Retry
        </button>
        {corpusState.errors.length > 0 ? (
          <ul className="corpus-errors">
            {corpusState.errors.slice(0, 5).map((e, i) => (
              <li key={`${e.kind}-${i}`}>{e.message}</li>
            ))}
          </ul>
        ) : null}
      </main>
    );
  }

  if (route.name === 'play') {
    return (
      <PlayRoute
        plan={route.plan}
        onAgain={onAgain}
        onDone={onDone}
        reducedMotion={reducedMotion}
        silent={silent}
      />
    );
  }

  return (
    <SetupScreen
      corpus={corpusState.corpus}
      config={config}
      onConfigChange={onConfigChange}
      onOptionsChange={setOptions}
      onStart={onStart}
      options={options}
      seed={sessionSeed}
      storage={storage}
    />
  );
}
