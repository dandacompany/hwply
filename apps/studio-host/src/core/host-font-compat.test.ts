import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostFontProvider, HostFontSnapshot } from './host-font-contract';
import { lookupEnabledPreference, lookupFont } from './local-font-lookup.fixture';
const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
const regular = { id: 'regular', family: 'Host Family', fullName: 'Host Regular',
  postscriptName: 'Host-Regular', style: 'Regular', weight: 400, slant: 'normal' as const,
  aliases: ['호스트 글꼴'] };
const bold = { ...regular, id: 'bold', fullName: 'Host Bold', postscriptName: 'Host-Bold',
  style: 'Bold', weight: 700 };
function transport() {
  let changed = () => {};
  const snapshot: HostFontSnapshot = { revision: 'r1', faces: [regular, bold] };
  const provider: HostFontProvider = {
    getSnapshot: vi.fn(async () => snapshot),
    readFace: vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]).buffer })),
    subscribe: vi.fn(listener => { changed = listener; return vi.fn(); }),
  };
  return { provider, snapshot, changed: () => changed() };
}
beforeEach(async () => {
  vi.resetModules(); invoke.mockReset();
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
  (await import('./local-font-preferences')).acceptFontPreferences(lookupEnabledPreference);
});
afterEach(() => vi.unstubAllGlobals());

describe('rhwp host font protocol at the product boundary', () => {
  it('keeps native renderer resolution and the legacy catalog on one index and byte cache', async () => {
    const native = lookupFont(0);
    invoke.mockImplementation(async command => command === 'list_local_fonts' ? [native] :
      [...readFileSync(new URL('../../../../tests/gui/local-fonts/Abel-Regular.ttf', import.meta.url))]);
    const fonts = await import('./local-fonts');
    await fonts.prepareHostFontCatalog();
    expect(fonts.hasHostFontProvider()).toBe(false);
    expect(fonts.resolveRendererLocalFont(native.postScriptName)).toEqual(fonts.resolveLocalFont(native.postScriptName));
    const record = fonts.resolveRendererLocalFont(native.postScriptName)!;
    const first = await fonts.loadRendererLocalFont(record);
    const second = await fonts.loadLocalFontBytes(native.postScriptName);
    expect(first?.faceIndex).toBe(0);
    expect(new Uint8Array(first!.bytes)).toEqual(new Uint8Array(second!));
    expect(invoke.mock.calls.filter(([cmd]) => cmd === 'read_local_font')).toHaveLength(1);
    await fonts.clearStoredLocalFonts();
    expect(await fonts.loadRendererLocalFont(record)).toBeNull();
  });

  it('indexes one host catalog for legacy and new consumers with exact-name/style selection', async () => {
    const { provider } = transport();
    const fonts = await import('./local-fonts');
    await fonts.setHostFontProvider(provider);
    expect(fonts.getHostFontState()).toMatchObject({ active: true, count: 2, lastError: null });
    expect(fonts.getLocalFontRecords()).toHaveLength(2);
    expect(fonts.resolveLocalFont('호스트 글꼴')).toBeNull();
    const selected = fonts.resolveRendererLocalFont('호스트 글꼴', { weight: 700, slant: 'normal' });
    expect(selected?.postscriptName).toBe('Host-Bold');
    expect(fonts.resolveRendererLocalFont('Host-Regular', { weight: 700, slant: 'italic' })?.postscriptName).toBe('Host-Regular');
    expect(fonts.localFontFaceKey(selected!)).toBe(selected!.hostReference!.key);
    expect((provider.getSnapshot as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
    expect(invoke).not.toHaveBeenCalled();
    const [a, b] = await Promise.all([fonts.loadRendererLocalFont(selected!), fonts.loadRendererLocalFont(selected!)]);
    expect(provider.readFace).toHaveBeenCalledOnce();
    expect(provider.readFace).toHaveBeenCalledWith('bold', 'r1', expect.any(AbortSignal));
    expect(a?.bytes).not.toBe(b?.bytes);
    new Uint8Array(a!.bytes)[0] = 99;
    expect(new Uint8Array(b!.bytes)[0]).toBe(1);
  });

  it('discards pending bytes on a revision change and removes only its own subscription', async () => {
    const host = transport();
    let finish!: (data: { bytes: ArrayBuffer }) => void;
    host.provider.readFace = vi.fn(() => new Promise<{ bytes: ArrayBuffer }>(resolve => { finish = resolve; }));
    const fonts = await import('./local-fonts');
    const listener = vi.fn();
    const off = fonts.onHostFontsChanged(listener);
    await fonts.setHostFontProvider(host.provider);
    const record = fonts.resolveRendererLocalFont('Host-Regular')!;
    const pending = fonts.loadRendererLocalFont(record);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    host.snapshot.revision = 'r2'; host.changed();
    finish({ bytes: new ArrayBuffer(8) });
    expect(await pending).toBeNull();
    await fonts.prepareHostFontCatalog();
    expect(await fonts.loadRendererLocalFont(record)).toBeNull();
    expect(fonts.resolveRendererLocalFont('Host-Regular')?.hostReference?.revision).toBe('r2');
    off(); listener.mockClear(); host.changed();
    expect(listener).not.toHaveBeenCalled();
  });

  it('respects native font preferences and filters blocked host aliases', async () => {
    const host = transport();
    host.snapshot.faces = [{ ...regular, fullName: regular.family },
      { ...bold, aliases: ['HY헤드라인M', 'Allowed Alias'] }];
    const fonts = await import('./local-fonts');
    await fonts.setHostFontProvider(host.provider);
    expect(fonts.resolveRendererLocalFont('Host Family', { weight: 700, slant: 'normal' })?.postscriptName).toBe('Host-Bold');
    expect(fonts.resolveRendererLocalFont('HY헤드라인M')).toBeNull();
    expect(fonts.resolveRendererLocalFont('Allowed Alias')?.postscriptName).toBe('Host-Bold');
    const prefs = await import('./local-font-preferences');
    prefs.acceptFontPreferences({ ...lookupEnabledPreference, choice: 'disabled', revision: 2 });
    expect(fonts.hasHostFontProvider()).toBe(false);
    await fonts.prepareHostFontCatalog();
    expect(fonts.getLocalFontRecords()).toEqual([]);
    expect(await fonts.loadRendererLocalFont({ ...fonts.resolveLocalFont('Host-Regular')!, sourceKey: 'stale', family: 'Host Family' })).toBeNull();
    prefs.acceptFontPreferences({ ...lookupEnabledPreference, revision: 3 });
    await fonts.prepareHostFontCatalog();
    expect(fonts.hasHostFontProvider()).toBe(true);
    expect(fonts.getLocalFontRecords()).toHaveLength(2);
  });

  it('keeps snapshot/provider failures visible without leaking host paths', async () => {
    const host = transport();
    host.provider.getSnapshot = vi.fn(async () => { throw new Error('/private/secret.ttf'); });
    const fonts = await import('./local-fonts');
    await fonts.setHostFontProvider(host.provider);
    expect(fonts.getHostFontState()).toMatchObject({ active: true, count: 0 });
    expect(fonts.getHostFontState().lastError).toBeTruthy();
    expect(fonts.getHostFontState().lastError).not.toContain('/private');
    expect(fonts.resolveRendererLocalFont('Host-Regular')).toBeNull();
  });
  it('keeps a replacement catalog when the previous snapshot finishes late', async () => {
    const old = transport();
    const current = transport();
    current.snapshot.faces = [{ ...regular, id: 'new', family: 'New Family', fullName: 'New Face', postscriptName: 'New-Face' }];
    let finish!: (value: HostFontSnapshot) => void;
    old.provider.getSnapshot = vi.fn(() => new Promise<HostFontSnapshot>(resolve => { finish = resolve; }));
    const fonts = await import('./local-fonts');
    const pending = fonts.setHostFontProvider(old.provider);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    const oldSignal = (old.provider.getSnapshot as ReturnType<typeof vi.fn>).mock.calls[0][0] as AbortSignal;
    await fonts.setHostFontProvider(current.provider);
    expect(oldSignal.aborted).toBe(true);
    old.changed();
    finish(old.snapshot); await pending;
    expect(fonts.getLocalFonts()).toEqual(['New Family']);
    expect(fonts.resolveRendererLocalFont('Host-Regular')).toBeNull();
    expect(fonts.resolveRendererLocalFont('New-Face')).not.toBeNull();
  });

  it.each(['duplicate-id', 'weight', 'aliases'] as const)('rejects malformed host metadata (%s)', async kind => {
    const host = transport();
    host.snapshot.faces = kind === 'duplicate-id' ? [regular, { ...bold, id: regular.id }]
      : [{ ...regular, ...(kind === 'weight' ? { weight: 1001 } : { aliases: new Array(33).fill('Alias') }) }];
    const fonts = await import('./local-fonts');
    await fonts.setHostFontProvider(host.provider);
    expect(fonts.getHostFontState().lastError).toBeTruthy();
    expect(fonts.getLocalFontRecords()).toEqual([]);
    expect(host.provider.readFace).not.toHaveBeenCalled();
  });

  it('preserves a selected collection face and rejects an invalid face index', async () => {
    const host = transport();
    const fonts = await import('./local-fonts');
    await fonts.setHostFontProvider(host.provider);
    const record = fonts.resolveRendererLocalFont('Host-Regular')!;
    host.provider.readFace = vi.fn(async () => ({ bytes: new ArrayBuffer(8), faceIndex: 2 }));
    expect((await fonts.loadRendererLocalFont(record))?.faceIndex).toBe(2);
    host.provider.readFace = vi.fn(async () => ({ bytes: new ArrayBuffer(8), faceIndex: -1 }));
    expect(await fonts.loadRendererLocalFont(record)).toBeNull();
  });

});
