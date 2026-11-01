import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

const family = 'hwply Local Test';
const postscriptName = 'hwplyLocalTest-Regular';
const entry = {
  family,
  postScriptName: postscriptName,
  style: 'normal',
  sourceKind: 'system-installed',
};

async function consumers() {
  const local = await import('@/core/local-fonts');
  const { analyzeDocumentFonts } = await import('@upstream/core/document-font-status');
  const { fontFamilyChainForDisplay } = await import('@upstream/core/font-substitution');
  return { local, analyzeDocumentFonts, fontFamilyChainForDisplay };
}

describe('pinned upstream local-font consumers', () => {
  beforeEach(async () => {
    vi.resetModules();
    invoke.mockReset();
    invoke.mockResolvedValue([entry]);
    // Both implementations support this environment, exposing split state rather
    // than letting an unsupported browser short-circuit the prompt regression.
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {}, queryLocalFonts: vi.fn() });
    vi.stubGlobal('queryLocalFonts', vi.fn());
    const { acceptFontPreferences } = await import('./local-font-preferences');
    acceptFontPreferences({ choice: 'enabled', persisted: true, revision: 1, promptDismissed: false, error: null });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('reports native detection support without the browser Local Font Access API', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    vi.stubGlobal('queryLocalFonts', undefined);
    const { local, analyzeDocumentFonts } = await consumers();
    expect(local.getLocalFontDetectionMethod()).toBe('local-font-access');
    expect(analyzeDocumentFonts([family])).toMatchObject({
      localSupported: true,
      detectionMethod: 'local-font-access',
      shouldPromptLocalAccess: true,
    });
    vi.stubGlobal('window', undefined);
    expect(local.getLocalFontDetectionMethod()).toBeNull();
    expect(analyzeDocumentFonts([family])).toMatchObject({
      localSupported: false,
      detectionMethod: null,
      shouldPromptLocalAccess: false,
    });
  });

  it('uses the detected catalog for status and the real display family chain', async () => {
    const { local, analyzeDocumentFonts, fontFamilyChainForDisplay } = await consumers();
    expect(analyzeDocumentFonts([family]).shouldPromptLocalAccess).toBe(true);
    expect(fontFamilyChainForDisplay(postscriptName)).not.toContain(family);

    await local.detectLocalFonts();

    expect(analyzeDocumentFonts([family, postscriptName])).toMatchObject({
      localSnapshotLoaded: true,
      localSnapshotStored: local.getLocalFontState().stored,
      localSnapshotComplete: true,
      detectionMethod: 'local-font-access',
      shouldPromptLocalAccess: false,
      summary: { available: 2, needsLocalCheck: 0 },
    });
    expect(fontFamilyChainForDisplay(postscriptName)).toMatch(/^"hwply Local Test",/);
    expect(invoke).toHaveBeenCalledExactlyOnceWith('list_local_fonts');
  });

  it('reuses detection across same and different document analyses', async () => {
    const { local, analyzeDocumentFonts } = await consumers();
    await local.detectLocalFonts();
    for (const fonts of [[family], [family], ['Uninstalled Test Font']]) {
      const report = analyzeDocumentFonts(fonts);
      expect(report.localSnapshotStored).toBe(local.getLocalFontState().stored);
      expect(report.shouldPromptLocalAccess).toBe(false);
    }
    expect(analyzeDocumentFonts(['Uninstalled Test Font']).fonts[0])
      .toMatchObject({ status: 'missing', source: 'unknown' });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('distinguishes an empty completed catalog from an unchecked catalog', async () => {
    invoke.mockResolvedValue([]);
    const { local, analyzeDocumentFonts } = await consumers();
    expect(analyzeDocumentFonts([family]).shouldPromptLocalAccess).toBe(true);
    await local.detectLocalFonts();
    expect(analyzeDocumentFonts([family])).toMatchObject({
      localSnapshotLoaded: true,
      localSnapshotComplete: true,
      shouldPromptLocalAccess: false,
      summary: { available: 0, needsLocalCheck: 0, missing: 1 },
    });
  });

  it('observes replacement and clearing without reimporting consumers', async () => {
    const { local, analyzeDocumentFonts, fontFamilyChainForDisplay } = await consumers();
    await local.detectLocalFonts();
    invoke.mockResolvedValue([]);
    await local.detectLocalFonts({ force: true });
    expect(analyzeDocumentFonts([family]).fonts[0].status).toBe('missing');
    expect(fontFamilyChainForDisplay(postscriptName)).not.toContain(family);

    await local.clearStoredLocalFonts();
    expect(analyzeDocumentFonts([family])).toMatchObject({
      localSnapshotLoaded: false,
      localSnapshotStored: true,
      shouldPromptLocalAccess: true,
    });
  });

  it('does not retain successful status after a forced catalog read fails', async () => {
    const { local, analyzeDocumentFonts, fontFamilyChainForDisplay } = await consumers();
    await local.detectLocalFonts();
    invoke.mockRejectedValue(new Error('catalog unavailable'));
    await expect(local.detectLocalFonts({ force: true })).rejects.toThrow('로컬 글꼴 목록을 읽지 못했습니다');
    expect(analyzeDocumentFonts([family])).toMatchObject({
      localSnapshotLoaded: false,
      localSnapshotStored: true,
      summary: { available: 0, needsLocalCheck: 1 },
    });
    expect(fontFamilyChainForDisplay(postscriptName)).not.toContain(family);
  });
});
