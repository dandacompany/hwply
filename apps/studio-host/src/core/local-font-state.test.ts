import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
const enabled = { choice: 'enabled' as const, persisted: true, revision: 1, promptDismissed: false, error: null };
const font = { family: 'Local Test', postScriptName: 'LocalTest', style: 'normal', sourceKind: 'system-installed' };

describe('local-font catalog lifecycle', () => {
  beforeEach(() => {
    vi.resetModules(); invoke.mockReset();
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each(['unset', 'disabled'] as const)('does not query fonts for %s', async (choice) => {
    invoke.mockResolvedValue({ ...enabled, choice, persisted: choice !== 'unset' });
    const fonts = await import('./local-fonts');
    expect(await fonts.loadStoredLocalFonts()).toBeNull();
    expect(await fonts.ensureLocalFontsAvailable(['Local Test'])).toEqual(new Set());
    expect(await fonts.loadLocalFontBytesFor(['Local Test'])).toEqual(new Map());
    expect(invoke).toHaveBeenCalledExactlyOnceWith('get_local_font_preferences');
  });

  it('restores enabled and coalesces catalog requests without saving font data', async () => {
    invoke.mockImplementation(async (cmd) => cmd === 'get_local_font_preferences' ? enabled : [font]);
    const fonts = await import('./local-fonts');
    await Promise.all([fonts.loadStoredLocalFonts(), fonts.loadStoredLocalFonts()]);
    expect(fonts.getLocalFonts()).toEqual(['Local Test']);
    expect(fonts.getLocalFontState()).toMatchObject({ stored: true, storage: 'native-preference' });
    expect(invoke.mock.calls.map(([cmd]) => cmd)).toEqual(['get_local_font_preferences', 'list_local_fonts']);
  });

  it('discards pending detection after another window disables local fonts', async () => {
    let finish!: (value: unknown) => void;
    invoke.mockImplementation((cmd) => cmd === 'get_local_font_preferences'
      ? Promise.resolve(enabled) : new Promise((resolve) => { finish = resolve; }));
    const fonts = await import('./local-fonts');
    const pending = fonts.loadStoredLocalFonts();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('list_local_fonts'));
    const prefs = await import('./local-font-preferences');
    prefs.acceptFontPreferences({ ...enabled, choice: 'disabled', revision: 2 });
    finish([font]);
    expect(await pending).toBeNull();
    expect(fonts.getLocalFonts()).toEqual([]);
  });

  it('does not rescan failed catalogs on every document and allows a manual retry', async () => {
    invoke.mockImplementation(async (cmd) => {
      if (cmd === 'get_local_font_preferences') return enabled;
      throw new Error('/private/font.ttf');
    });
    const fonts = await import('./local-fonts');
    await fonts.loadStoredLocalFonts();
    await fonts.loadStoredLocalFonts();
    expect(invoke.mock.calls.filter(([cmd]) => cmd === 'list_local_fonts')).toHaveLength(1);
    expect(fonts.getLocalFontState().lastError).not.toContain('/private');
    invoke.mockResolvedValue([font]);
    await fonts.detectLocalFonts({ force: true });
    expect(fonts.getLocalFonts()).toEqual(['Local Test']);
    expect(fonts.getLocalFontState().lastError).toBeNull();
  });
});
