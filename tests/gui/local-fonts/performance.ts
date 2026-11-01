import { browser } from '@wdio/globals';

export interface OpenTiming { ms: number; pageCount: number }
export interface InputTiming { ms: number; pixelProbeMs: number; frames: number }
export interface ScrollTiming { gapsMs: number[]; positions: number[]; maximum: number }

// Transfer bytes before starting the WebView clock; WebDriver transport is excluded.
export async function prepareDocument(data: number[], fileName: string): Promise<void> {
  await browser.execute((data, fileName) => {
    (window as Window & { __fontPerfDocument?: unknown }).__fontPerfDocument = {
      data: new Uint8Array(data), fileName, skipUnsavedGuard: true, suppressDialogs: true,
    };
  }, data, fileName);
}

export async function measureOpen(): Promise<OpenTiming> {
  return browser.executeAsync(done => {
    const id = `font-performance-${Math.random()}`;
    const start = performance.now();
    const timer = setTimeout(() => finish({ error: 'loadFile timed out' }), 90000);
    function finish(value: unknown) {
      clearTimeout(timer); window.removeEventListener('message', listener); done(value);
    }
    function listener(event: MessageEvent) {
      if (event.source !== window || event.data?.type !== 'rhwp-response' || event.data.id !== id) return;
      if (event.data.error) { finish({ error: event.data.error }); return; }
      void document.fonts.ready.then(() => requestAnimationFrame(() => requestAnimationFrame(() => {
        finish({ ms: performance.now() - start, pageCount: event.data.result.pageCount });
      })));
    }
    window.addEventListener('message', listener);
    window.postMessage({ type: 'rhwp-request', id, method: 'loadFile',
      params: (window as Window & { __fontPerfDocument?: unknown }).__fontPerfDocument }, '*');
  }).then(value => {
    const timing = value as OpenTiming & { error?: string };
    if (timing.error || !Number.isFinite(timing.ms) || timing.pageCount < 1) {
      throw new Error(timing.error ?? 'invalid document timing');
    }
    return timing;
  });
}

// The public form fixture starts in a table. Click its visible first label cell
// before measuring input; loadFile's initial body cursor need not be visible.
export async function focusFirstFormCell(): Promise<void> {
  const point = await browser.execute(() => {
    const page = document.querySelector<HTMLCanvasElement>('#scroll-content > canvas[data-rhwp-rendered-zoom]');
    if (!page) throw new Error('missing form canvas');
    const box = page.getBoundingClientRect();
    return { x: Math.floor(box.left + box.width * 0.2), y: Math.floor(box.top + box.height * 0.1) };
  });
  await browser.performActions([{ type: 'pointer', id: 'font-performance-pointer',
    parameters: { pointerType: 'mouse' }, actions: [
      { type: 'pointerMove', origin: 'viewport', duration: 0, ...point },
      { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 },
    ] }]);
  await browser.releaseActions();
  await browser.waitUntil(async () => browser.execute(() =>
    document.activeElement?.getAttribute('aria-label') === '문서 편집 입력'),
  { timeout: 5000, timeoutMsg: 'form cell click did not activate editor input' });
}

// Measures editor input to changed page pixels plus a subsequent animation frame.
// This is a canvas observation, not a claim about physical display presentation.
export async function measureInput(text: string): Promise<InputTiming> {
  const raw = await browser.executeAsync((text, done) => {
    const page = () => document.querySelector<HTMLCanvasElement>('#scroll-content > canvas[data-rhwp-rendered-zoom]');
    const input = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="문서 편집 입력"]');
    if (!input || !page()) { done({ error: 'missing editor/canvas' }); return; }
    const probeStart = performance.now();
    const before = page()!.toDataURL();
    const pixelProbeMs = performance.now() - probeStart;
    let frames = 0;
    let finished = false;
    const timer = setTimeout(() => finish({ error: 'input did not change document pixels' }), 90000);
    function finish(value: unknown) {
      if (finished) return;
      finished = true; clearTimeout(timer); done(value);
    }
    function observe() {
      if (finished) return;
      frames++;
      const current = page();
      if (current && current.toDataURL() !== before) {
        requestAnimationFrame(() => finish({ ms: performance.now() - start, pixelProbeMs, frames }));
      } else requestAnimationFrame(observe);
    }
    input.focus(); input.value = text;
    const start = performance.now();
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
    requestAnimationFrame(observe);
  }, text);
  const value = raw as InputTiming & { error?: string };
  if (value.error || !Number.isFinite(value.ms)) throw new Error(value.error ?? 'invalid input timing');
  return value;
}

// A fixed 90-frame traversal down and back up the actual scrollable document.
export async function measureScroll(): Promise<ScrollTiming> {
  const raw = await browser.executeAsync(done => {
    const container = document.getElementById('scroll-container');
    if (!container) { done({ error: 'missing scroll container' }); return; }
    const maximum = container.scrollHeight - container.clientHeight;
    if (maximum <= 0) { done({ error: 'document is not scrollable' }); return; }
    container.scrollTop = 0;
    const positions: number[] = [];
    const gapsMs: number[] = [];
    let previous: number | null = null;
    let finished = false;
    const timer = setTimeout(() => { finished = true; done({ error: 'scroll timed out' }); }, 90000);
    function tick(now: number) {
      if (finished) return;
      if (previous !== null) gapsMs.push(now - previous);
      previous = now;
      const step = positions.length;
      container!.scrollTop = maximum * (step <= 45 ? step / 45 : (90 - step) / 45);
      positions.push(container!.scrollTop);
      if (step === 90) { clearTimeout(timer); done({ gapsMs, positions, maximum }); }
      else requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
  const value = raw as ScrollTiming & { error?: string };
  if (value.error || value.gapsMs.length !== 90 || Math.max(...value.positions) < value.maximum * 0.9) {
    throw new Error(value.error ?? 'incomplete scroll traversal');
  }
  return value;
}

export async function startLongTaskObservation(): Promise<void> {
  await browser.execute(() => {
    const state = window as Window & { __fontPerfTasks?: { startTime: number; duration: number }[];
      __fontPerfObserver?: PerformanceObserver };
    state.__fontPerfObserver?.disconnect();
    state.__fontPerfTasks = [];
    if (typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes?.includes('longtask')) return;
    state.__fontPerfObserver = new PerformanceObserver(list => {
      state.__fontPerfTasks!.push(...list.getEntries().map(entry => ({ startTime: entry.startTime, duration: entry.duration })));
    });
    state.__fontPerfObserver.observe({ entryTypes: ['longtask'] });
  });
}

export async function finishLongTaskObservation() {
  return browser.execute(() => {
    const state = window as Window & { __fontPerfTasks?: { startTime: number; duration: number }[];
      __fontPerfObserver?: PerformanceObserver };
    const pending = state.__fontPerfObserver?.takeRecords() ?? [];
    state.__fontPerfObserver?.disconnect();
    return { supported: typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask') === true,
      entries: [...(state.__fontPerfTasks ?? []), ...pending.map(entry => ({ startTime: entry.startTime, duration: entry.duration }))] };
  });
}
