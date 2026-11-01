import { cpus, platform, arch } from 'node:os';
import { bench, describe, vi } from 'vitest';
import { lookupCatalog, lookupEnabledPreference } from './local-font-lookup.fixture';
import type { LocalFontRecord } from './local-font-records';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

const batchSize = 100;
const iterations = 5;
console.info('LOOKUP_ENV', JSON.stringify({
  node: process.version, v8: process.versions.v8, platform: platform(), arch: arch(),
  cpu: cpus()[0]?.model, batchSize, iterations,
  note: 'Node adapter benchmark; synthetic catalog, no native font scan or rendering',
}));

for (const size of [0, 100, 500, 1000, 5000]) {
  describe(`${size} catalog records`, () => {
    const pair = Math.max(0, size / 2 - 1);
    const queries = [
      { kind: 'postscript-hit', name: `Lookup${pair}-Bold`, found: size > 0 },
      { kind: 'missing', name: 'Missing Font', found: false },
      { kind: 'korean-alias-hit', name: `조회 글꼴 ${pair} Bold`, found: size > 0 },
      { kind: 'ambiguous-family', name: `Lookup Family ${pair}`, found: false },
    ];
    for (const query of queries) registerLookupBenchmark(size, query);
  });
}

function registerLookupBenchmark(size: number, query: { kind: string; name: string; found: boolean }): void {
  let resolveFont: (name: string) => LocalFontRecord | null;
  const samples: number[] = [];
  bench(query.kind, () => {
    let matches = 0;
    const start = performance.now();
    for (let index = 0; index < batchSize; index += 1) {
      if (resolveFont(query.name)) matches += 1;
    }
    const elapsed = performance.now() - start;
    if (matches !== (query.found ? batchSize : 0)) throw new Error(`incorrect ${query.kind} result`);
    samples.push(elapsed);
  }, {
    time: 0, iterations, warmupTime: 0, warmupIterations: 1, throws: true,
    // Vitest's benchmark runner uses Tinybench hooks, not suite beforeAll/afterAll.
    async setup(_task, mode) {
      if (mode === 'warmup') resolveFont = await prepareLookup(size, query);
      samples.length = 0;
    },
    teardown(_task, mode) {
      if (mode !== 'run') return;
      // Tinybench can probe sync/async before sampling. Keep only measured batches.
      const values = samples.slice(-iterations);
      if (values.length !== iterations) throw new Error(`incomplete ${query.kind} measurement`);
      const sorted = [...values].sort((a, b) => a - b);
      console.info('LOOKUP_BATCH', JSON.stringify({
        size, kind: query.kind, batchSize, samplesMs: values, medianMs: sorted[2],
        minMs: sorted[0], maxMs: sorted[4],
      }));
      vi.unstubAllGlobals();
    },
  });
}

async function prepareLookup(size: number, query: { kind: string; name: string; found: boolean }) {
  vi.resetModules();
  invoke.mockReset();
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
  const preferences = await import('./local-font-preferences');
  preferences.acceptFontPreferences(lookupEnabledPreference);
  invoke.mockResolvedValue(lookupCatalog(size));
  const fonts = await import('./local-fonts');
  const preparationStarted = performance.now();
  await fonts.detectLocalFontEntries();
  const catalogMs = performance.now() - preparationStarted;
  const firstStarted = performance.now();
  const first = fonts.resolveLocalFont(query.name);
  const firstLookupMs = performance.now() - firstStarted;
  if (Boolean(first) !== query.found) throw new Error('invalid initial lookup result');
  console.info('LOOKUP_PREPARATION', JSON.stringify({ size, kind: query.kind, catalogMs, firstLookupMs }));
  return fonts.resolveLocalFont;
}
