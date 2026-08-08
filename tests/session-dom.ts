/**
 * A DOM stand-in for the session tests.
 *
 * The same choice `backdrop-mount.test.ts` makes, for the same reason: the
 * suite stays in the default Node environment with no jsdom dependency, and the
 * fake records exactly what M4 touches so an assertion can read it back. That
 * is a feature rather than a compromise — `mountSession` writes styles and
 * nothing else, so a fake that records style writes is a more precise
 * instrument than a real DOM, where "did this lane get painted" becomes a
 * question about computed styles and layout.
 *
 * Every member here exists because `lanes.ts` or `mountSession.ts` uses it. If
 * a future edit reaches for something else, this file failing to provide it is
 * the correct outcome: it means the renderer grew a dependency on the DOM that
 * the module's own tests can no longer verify.
 */

/** Records every write, so a test can assert on what the renderer actually did. */
export class FakeStyle {
  private readonly values = new Map<string, string>();
  /** Every write in order, including redundant ones. Used to prove skips. */
  readonly writes: { property: string; value: string }[] = [];

  private get(property: string): string {
    return this.values.get(property) ?? '';
  }

  private set(property: string, value: string): void {
    this.values.set(property, value);
    this.writes.push({ property, value });
  }

  get opacity(): string {
    return this.get('opacity');
  }
  set opacity(v: string) {
    this.set('opacity', v);
  }
  get display(): string {
    return this.get('display');
  }
  set display(v: string) {
    this.set('display', v);
  }
  get transform(): string {
    return this.get('transform');
  }
  set transform(v: string) {
    this.set('transform', v);
  }
  get filter(): string {
    return this.get('filter');
  }
  set filter(v: string) {
    this.set('filter', v);
  }
  get transition(): string {
    return this.get('transition');
  }
  set transition(v: string) {
    this.set('transition', v);
  }
  get position(): string {
    return this.get('position');
  }
  set position(v: string) {
    this.set('position', v);
  }
  get inset(): string {
    return this.get('inset');
  }
  set inset(v: string) {
    this.set('inset', v);
  }
  get overflow(): string {
    return this.get('overflow');
  }
  set overflow(v: string) {
    this.set('overflow', v);
  }
  get background(): string {
    return this.get('background');
  }
  set background(v: string) {
    this.set('background', v);
  }
  get left(): string {
    return this.get('left');
  }
  set left(v: string) {
    this.set('left', v);
  }
  get top(): string {
    return this.get('top');
  }
  set top(v: string) {
    this.set('top', v);
  }
  get maxWidth(): string {
    return this.get('maxWidth');
  }
  set maxWidth(v: string) {
    this.set('maxWidth', v);
  }
  get textAlign(): string {
    return this.get('textAlign');
  }
  set textAlign(v: string) {
    this.set('textAlign', v);
  }
  get fontSize(): string {
    return this.get('fontSize');
  }
  set fontSize(v: string) {
    this.set('fontSize', v);
  }
  get lineHeight(): string {
    return this.get('lineHeight');
  }
  set lineHeight(v: string) {
    this.set('lineHeight', v);
  }
  get willChange(): string {
    return this.get('willChange');
  }
  set willChange(v: string) {
    this.set('willChange', v);
  }
  get pointerEvents(): string {
    return this.get('pointerEvents');
  }
  set pointerEvents(v: string) {
    this.set('pointerEvents', v);
  }
  get userSelect(): string {
    return this.get('userSelect');
  }
  set userSelect(v: string) {
    this.set('userSelect', v);
  }
  get letterSpacing(): string {
    return this.get('letterSpacing');
  }
  set letterSpacing(v: string) {
    this.set('letterSpacing', v);
  }

  /** How many times a property was written, redundant writes included. */
  writeCount(property: string): number {
    return this.writes.filter((w) => w.property === property).length;
  }
}

export class FakeElement {
  readonly tag: string;
  readonly style = new FakeStyle();
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  className = '';
  textContent = '';
  parent: FakeElement | null = null;
  removed = false;

  /** Every `textContent` assignment, so a test can count DOM text writes. */
  readonly textWrites: string[] = [];

  constructor(tag: string) {
    this.tag = tag;
    // A plain field would not record; an accessor pair would shadow the
    // declaration above. Defining it here keeps `textContent` a normal-looking
    // property at every call site while still being observable.
    let value = '';
    Object.defineProperty(this, 'textContent', {
      get: () => value,
      set: (next: string) => {
        value = next;
        this.textWrites.push(next);
      },
      enumerable: true,
      configurable: true,
    });
  }

  appendChild(child: FakeElement): FakeElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    this.removed = true;
    if (this.parent) {
      const i = this.parent.children.indexOf(this);
      if (i >= 0) this.parent.children.splice(i, 1);
      this.parent = null;
    }
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  /** Depth-first search by class name. */
  find(className: string): FakeElement | null {
    if (this.className.split(' ').includes(className)) return this;
    for (const child of this.children) {
      const hit = child.find(className);
      if (hit) return hit;
    }
    return null;
  }

  /** Every descendant, self included. */
  all(): FakeElement[] {
    return [this, ...this.children.flatMap((c) => c.all())];
  }
}

export function fakeDocument(): { createElement(tag: string): HTMLElement; created: FakeElement[] } {
  const created: FakeElement[] = [];
  return {
    createElement(tag: string): HTMLElement {
      const el = new FakeElement(tag);
      created.push(el);
      return el as unknown as HTMLElement;
    },
    created,
  };
}

/** A rAF stand-in a test drives by hand, one frame at a time. */
export class FakeScheduler {
  private next = 1;
  private readonly pending = new Map<number, (t: number) => void>();
  /** Frames requested but never run because they were cancelled. */
  cancelled = 0;

  request(callback: (t: number) => void): number {
    const handle = this.next++;
    this.pending.set(handle, callback);
    return handle;
  }

  cancel(handle: number): void {
    if (this.pending.delete(handle)) this.cancelled += 1;
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  /** Run every currently-pending callback once. Newly requested frames wait. */
  flush(timestamp = 0): number {
    const batch = [...this.pending.entries()];
    this.pending.clear();
    for (const [, callback] of batch) callback(timestamp);
    return batch.length;
  }
}

/** A visibility source a test flips by hand. */
export class FakeVisibility {
  private isHidden = false;
  private readonly listeners = new Set<() => void>();

  hidden(): boolean {
    return this.isHidden;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  set(hidden: boolean): void {
    this.isHidden = hidden;
    for (const listener of [...this.listeners]) listener();
  }
}

/** A keydown target a test dispatches into. */
export class FakeKeyTarget {
  private readonly listeners = new Set<(event: { key: string }) => void>();

  addEventListener(_type: 'keydown', listener: (event: { key: string }) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'keydown', listener: (event: { key: string }) => void): void {
    this.listeners.delete(listener);
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  press(key: string): void {
    for (const listener of [...this.listeners]) listener({ key });
  }
}

/**
 * A hand-driven clock plus scheduler, wired together.
 *
 * `advance(ms)` moves the clock and runs one frame — which is what a rAF loop
 * does, and what lets a test run a 20-minute session in a few milliseconds.
 */
export class FakeFrameDriver {
  readonly scheduler = new FakeScheduler();
  private t = 0;

  now = (): number => this.t;

  /** Move time forward and run one frame. */
  advance(ms: number): void {
    this.t += ms;
    this.scheduler.flush(this.t);
  }

  /** Move time forward WITHOUT running a frame — a hidden or throttled tab. */
  skip(ms: number): void {
    this.t += ms;
  }

  /** Run a frame without moving time. */
  frame(): void {
    this.scheduler.flush(this.t);
  }

  get time(): number {
    return this.t;
  }

  /** Advance in `stepMs` slices, as a real loop would. */
  run(totalMs: number, stepMs = 16): void {
    let remaining = totalMs;
    while (remaining > 0) {
      const slice = Math.min(stepMs, remaining);
      this.advance(slice);
      remaining -= slice;
    }
  }
}
