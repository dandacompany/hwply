import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fontBytes = [...readFileSync(resolve(__dirname, '../../../../tests/gui/local-fonts/Abel-Regular.ttf'))];

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

describe('local fonts', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { document?: unknown }).document;
    delete (globalThis as { FontFace?: unknown }).FontFace;
    const { acceptFontPreferences } = await import('./local-font-preferences');
    acceptFontPreferences({ choice: 'enabled', persisted: true, revision: 1, promptDismissed: false, error: null });
  });

  it('hydrates desktop font families from the native catalog while filtering blocked authoring names', async () => {
    (globalThis as { window?: unknown }).window = { __TAURI_INTERNALS__: {} };
    invokeMock.mockResolvedValue([
      {
        family: 'HY헤드라인M',
        postScriptName: 'HYHeadLineM',
        style: 'normal',
        sourceKind: 'system-installed',
        path: '/System/Fonts/HYHeadLineM.ttf',
      },
      {
        family: '새 폰트',
        postScriptName: 'NewFont-Regular',
        style: 'normal',
        sourceKind: 'system-installed',
        path: '/System/Fonts/NewFont-Regular.ttf',
      },
      {
        family: '새 폰트',
        postScriptName: 'NewFont-Bold',
        style: 'normal',
        sourceKind: 'system-installed',
        path: '/System/Fonts/NewFont-Bold.ttf',
      },
    ]);

    const { detectLocalFonts, getLocalFonts } = await import('./local-fonts');

    await expect(detectLocalFonts()).resolves.toEqual(
      expect.arrayContaining(['새 폰트']),
    );
    expect(getLocalFonts()).toEqual(expect.arrayContaining(['새 폰트']));
    expect(getLocalFonts()).toEqual(['새 폰트']);
    expect(getLocalFonts()).not.toContain('HY헤드라인M');
    expect(invokeMock).toHaveBeenCalledWith('list_local_fonts');
  });

  it('loads requested safe file-backed fonts through the desktop bridge once per path', async () => {
    (globalThis as { window?: unknown }).window = { __TAURI_INTERNALS__: {} };
    const addedFamilies: string[] = [];
    installBinaryFontEnvironment(addedFamilies);
    invokeMock.mockImplementation(async (command: string, args?: { path?: string }) => {
      if (command === 'list_local_fonts') {
        return [
          {
            family: 'HYHeadLine M',
            postScriptName: 'HYHeadLineM',
            style: 'normal',
            weight: 400,
            sourceKind: 'file-backed',
            path: '/vendor/HYHeadLineM.ttf',
          },
          {
            family: '새 파일폰트',
            postScriptName: 'NewFont',
            style: 'normal',
            weight: 400,
            sourceKind: 'file-backed',
            path: '/vendor/NewFont.ttf',
          },
          {
            family: '맑은 고딕',
            postScriptName: 'MalgunGothic',
            style: 'normal',
            sourceKind: 'system-installed',
          },
        ];
      }
      if (command === 'read_local_font') {
        expect(args?.path).toBe('/vendor/NewFont.ttf');
        return fontBytes;
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const { ensureLocalFontsAvailable } = await import('./local-fonts');

    const availableFonts = await ensureLocalFontsAvailable(['HYHeadLine M', '새 파일폰트']);

    expect(Array.from(availableFonts)).toEqual(
      expect.arrayContaining(['새 파일폰트', '맑은 고딕']),
    );
    expect(availableFonts).not.toContain('HYHeadLine M');
    expect(availableFonts.size).toBe(2);
    expect(addedFamilies).toEqual(['새 파일폰트']);
    expect(invokeMock).toHaveBeenCalledWith('read_local_font', { path: '/vendor/NewFont.ttf' });
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it('returns an empty cached list before detection', async () => {
    const { getLocalFonts } = await import('./local-fonts');

    expect(getLocalFonts()).toEqual([]);
  });

  it('exposes the v0.8.2 local-font record, state, and byte-loading contract', async () => {
    (globalThis as { window?: unknown }).window = { __TAURI_INTERNALS__: {} };
    invokeMock.mockImplementation(async (command: string, args?: { path?: string }) => {
      if (command === 'list_local_fonts') {
        return [
          {
            family: '새 파일폰트',
            postScriptName: 'NewFont-Regular',
            style: 'normal',
            weight: 400,
            sourceKind: 'file-backed',
            path: '/vendor/NewFont-Regular.ttf',
          },
        ];
      }
      if (command === 'read_local_font') {
        expect(args?.path).toBe('/vendor/NewFont-Regular.ttf');
        return fontBytes;
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const {
      clearStoredLocalFonts,
      detectLocalFonts,
      getLocalFontState,
      loadLocalFontBytesFor,
      localFontFaceKey,
      resolveLocalFont,
    } = await import('./local-fonts');

    await expect(detectLocalFonts({ force: true })).resolves.toEqual(['새 파일폰트']);
    expect(getLocalFontState()).toMatchObject({
      supported: true,
      loaded: true,
      stored: true,
      count: 1,
    });

    const record = resolveLocalFont('NewFont-Regular');
    expect(record).toMatchObject({
      family: '새 파일폰트',
      postscriptName: 'NewFont-Regular',
    });

    const loadedBytes = await loadLocalFontBytesFor(['NewFont-Regular']);
    expect(record).not.toBeNull();
    const loaded = loadedBytes.get(localFontFaceKey(record!));
    expect(loaded).toBeDefined();
    expect(Array.from(new Uint8Array(loaded!))).toEqual(fontBytes);

    await clearStoredLocalFonts();
    expect(getLocalFontState()).toMatchObject({
      loaded: false,
      stored: true,
      count: 0,
    });
  });
});

function installBinaryFontEnvironment(addedFamilies: string[]) {
  (globalThis as { document?: unknown }).document = {
    fonts: {
      delete: vi.fn(),
      add: vi.fn((face: { family: string }) => {
        addedFamilies.push(face.family);
      }),
    },
  };
  (globalThis as { FontFace?: unknown }).FontFace = class {
    family: string;

    constructor(name: string) {
      this.family = name;
    }

    async load() {
      return this;
    }
  };
}
