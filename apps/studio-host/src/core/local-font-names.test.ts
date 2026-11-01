import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalFontEntry } from './local-font-records';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
// Use the real renderer/session; only native WASM parsing is replaced in Node.
vi.mock('@upstream/view/canvaskit-wasm-url', () => ({ default: '/unused.wasm' }));
vi.mock('canvaskit-wasm', () => ({ default: async () => ({
  Typeface: { MakeFreeTypeFaceFromData: () => ({ delete() {} }) },
  FontMgr: { FromData: () => ({ countFamilies: () => 1, getFamilyName: () => 'NanumSquare', delete() {} }) },
}) }));
const bytes = [...readFileSync(resolve(__dirname, '../../../../tests/gui/local-fonts/nanumsquare/NanumSquareB.ttf'))];
const bold: LocalFontEntry = {
  family: 'NanumSquare', postScriptName: 'NanumSquareB', style: 'normal', weight: 700,
  sourceKind: 'file-backed', path: '/fonts/NanumSquareB.ttf',
  fullName: 'NanumSquare Bold', aliases: ['NanumSquare Bold', '나눔스퀘어 Bold', 'NanumSquare', '나눔스퀘어'],
};
const regular: LocalFontEntry = {
  ...bold, postScriptName: 'NanumSquareR', weight: 400, path: '/fonts/NanumSquareR.ttf',
  fullName: 'NanumSquare Regular', aliases: ['NanumSquare Regular', '나눔스퀘어 Regular', 'NanumSquare', '나눔스퀘어'],
};
let entries: LocalFontEntry[];
let registered: { family: string; weight?: string }[];

beforeEach(async () => {
  vi.resetModules(); invoke.mockReset(); entries = []; registered = [];
  const globals = {
    window: { __TAURI_INTERNALS__: {}, setTimeout },
    document: { fonts: { add: (face: { family: string; weight?: string }) => registered.push(face), delete: vi.fn() } },
    FontFace: class {
      constructor(public family: string, _bytes: unknown, public descriptors: FontFaceDescriptors) {}
      get weight() { return this.descriptors.weight; }
      async load() { return this; }
    },
  };
  for (const [key, value] of Object.entries(globals)) vi.stubGlobal(key, value);
  vi.stubGlobal('fetch', async () => ({ ok: false }));
  invoke.mockImplementation(async (command: string) => command === 'list_local_fonts' ? entries : bytes);
  const preferences = await import('./local-font-preferences');
  preferences.acceptFontPreferences({ choice: 'enabled', persisted: true, revision: 1, promptDismissed: false, error: null });
});

afterEach(() => vi.unstubAllGlobals());

describe('desktop face names', () => {
  it('resolves Korean Bold with Regular present and round-trips through the CanvasKit full-name lookup', async () => {
    entries = [bold, { ...bold, family: '나눔스퀘어' }, regular, { ...regular, family: '나눔스퀘어' }];
    const fonts = await import('./local-fonts');
    await fonts.detectLocalFonts();
    const record = fonts.resolveLocalFont('나눔스퀘어 Bold');
    expect(record?.postscriptName).toBe('NanumSquareB');
    expect(fonts.resolveLocalFont('NanumSquareB')).toEqual(record);
    expect(fonts.resolveLocalFont(record!.fullName)).toEqual(record);
    expect(fonts.resolveLocalFont('나눔스퀘어')).toBeNull();
    await fonts.ensureLocalFontsAvailable(['나눔스퀘어 Bold']);
    expect(registered.map(f => f.family)).toContain(record!.family);
    expect(registered.every(f => f.weight === '700')).toBe(true);
    expect(registered.map(f => f.family)).toContain('나눔스퀘어 Bold');
    const loaded = await fonts.loadLocalFontBytesFor([record!.fullName]);
    expect([...new Uint8Array(loaded.get(fonts.localFontFaceKey(record!))!)]).toEqual(bytes);
    expect(invoke.mock.calls.filter(([name]) => name === 'read_local_font')).toEqual([
      ['read_local_font', { path: bold.path }],
    ]);
  });

  it('does not collapse two physical files with the same names', async () => {
    entries = [bold, { ...bold, path: '/other/NanumSquareB.ttf' }];
    const fonts = await import('./local-fonts');
    await fonts.detectLocalFonts();
    expect(fonts.resolveLocalFont('나눔스퀘어 Bold')).toBeNull();
    expect(fonts.resolveLocalFont('NanumSquareB')).toBeNull();
    expect((await fonts.loadLocalFontBytesFor(['나눔스퀘어 Bold'])).size).toBe(0);
    expect(invoke).not.toHaveBeenCalledWith('read_local_font', expect.anything());
  });

  it('reads the selected file rather than the first row sharing its PostScript name', async () => {
    entries = [{ ...bold, family: 'Another Face', fullName: 'Another Face', aliases: ['Another Face'], path: '/other.ttf' }, bold];
    const fonts = await import('./local-fonts');
    await fonts.detectLocalFonts();
    const record = fonts.resolveLocalFont('나눔스퀘어 Bold')!;
    const loaded = await fonts.loadLocalFontBytesFor([record.fullName]);
    expect(loaded.size).toBe(1);
    expect(invoke).toHaveBeenCalledWith('read_local_font', { path: bold.path });
    expect(invoke).not.toHaveBeenCalledWith('read_local_font', { path: '/other.ttf' });
  });
  it('prepares one CanvasKit face across Korean, English and PostScript names, including refresh', async () => {
    entries = [regular, bold, { ...bold, family: '나눔스퀘어' }];
    const fonts = await import('./local-fonts');
    await fonts.detectLocalFonts();
    const { CanvasKitLayerRenderer } = await import('@upstream/view/canvaskit-renderer');
    const renderer = await CanvasKitLayerRenderer.create();
    try {
      expect(await renderer.prepareLocalFonts(['나눔스퀘어 Bold', 'NanumSquare Bold', 'NanumSquareB'])).toBe(1);
      expect(renderer.diagnostics().localTypefaceCount).toBe(1);
      expect(await renderer.prepareLocalFonts(['나눔스퀘어 Bold'])).toBe(0);
      renderer.resetDocumentResources();
      await fonts.detectLocalFonts({ force: true });
      expect(await renderer.prepareLocalFonts(['나눔스퀘어 Bold'])).toBe(1);
      expect(renderer.diagnostics().localTypefaceLoadFailureCount).toBe(0);
    } finally { renderer.dispose(); }
  });

  it('prefers a real full face name over another face sharing that family alias', async () => {
    entries = [bold, { ...regular, fullName: 'NanumSquare' }];
    const fonts = await import('./local-fonts');
    await fonts.detectLocalFonts();
    expect(fonts.resolveLocalFont('NanumSquare')?.postscriptName).toBe('NanumSquareR');
    expect(fonts.resolveLocalFont('나눔스퀘어 Bold')?.postscriptName).toBe('NanumSquareB');
  });

  it('preserves the OS CSS family when a system face is not registered from bytes', async () => {
    entries = [{ ...bold, sourceKind: 'system-installed', path: '/system/NanumSquareB.ttf' }];
    const fonts = await import('./local-fonts');
    await fonts.detectLocalFonts();
    expect(fonts.resolveLocalFont('나눔스퀘어 Bold')?.family).toBe('NanumSquare');
    await fonts.ensureLocalFontsAvailable(['나눔스퀘어 Bold']);
    expect(registered).toEqual([]);
    expect(invoke).not.toHaveBeenCalledWith('read_local_font', expect.anything());
  });

});
