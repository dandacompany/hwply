import { describe, expect, it, vi } from 'vitest';
import {
  exportDesktopSource,
  syncDesktopPasswordRequirement,
} from './desktop-source-export';

describe('desktop source export', () => {
  it('uses the reported exporter after flushing deferred pagination', async () => {
    const fixture = createFixture();

    await expect(exportDesktopSource(
      fixture.services as never,
      'hwpx',
      fixture.promptPassword,
    )).resolves.toEqual({
      artifact: fixture.hwpxArtifact,
      passwordProtected: false,
    });

    expect(fixture.input.flushDeferredPaginationIfNeeded)
      .toHaveBeenCalledWith('native-save');
    expect(fixture.wasm.exportHwpxWithReport).toHaveBeenCalledOnce();
    expect(fixture.promptPassword).not.toHaveBeenCalled();
  });

  it('preserves an encrypted document with a one-shot password exporter', async () => {
    const fixture = createFixture({ encrypted: true });
    fixture.promptPassword.mockResolvedValue('새암호123');

    const result = await exportDesktopSource(
      fixture.services as never,
      'hwp',
      fixture.promptPassword,
    );

    expect(fixture.promptPassword).toHaveBeenCalledWith('document.hwp');
    expect(fixture.wasm.exportHwpWithPasswordAndReport).toHaveBeenCalledWith('새암호123');
    expect(fixture.wasm.exportHwpWithReport).not.toHaveBeenCalled();
    expect(result).toEqual({ artifact: fixture.hwpArtifact, passwordProtected: true });
  });

  it('cancels before serialization when the password dialog is cancelled', async () => {
    const fixture = createFixture({ requiresPasswordForSave: true });

    await expect(exportDesktopSource(
      fixture.services as never,
      'hwp',
      fixture.promptPassword,
    )).resolves.toBeNull();

    expect(fixture.wasm.exportHwpWithReport).not.toHaveBeenCalled();
    expect(fixture.wasm.exportHwpWithPasswordAndReport).not.toHaveBeenCalled();
  });

  it('rejects serialization while deferred pagination remains pending', async () => {
    const fixture = createFixture();
    fixture.input.hasDeferredPaginationPending.mockReturnValue(true);

    await expect(exportDesktopSource(
      fixture.services as never,
      'hwp',
      fixture.promptPassword,
    )).rejects.toThrow('저장 전 페이지네이션을 완료하지 못했습니다');

    expect(fixture.wasm.exportHwpWithReport).not.toHaveBeenCalled();
  });

  it('syncs only the encrypted boolean after an upstream document open', () => {
    const fixture = createFixture({ encrypted: true });

    syncDesktopPasswordRequirement(fixture.services as never);

    expect(fixture.wasm.requiresPasswordForSave).toBe(true);
  });
});

function createFixture(options: {
  encrypted?: boolean;
  requiresPasswordForSave?: boolean;
} = {}) {
  const hwpArtifact = exportArtifact('hwp', [1, 2, 3]);
  const hwpxArtifact = exportArtifact('hwpx', [4, 5, 6]);
  const wasm = {
    fileName: 'document.hwp',
    requiresPasswordForSave: options.requiresPasswordForSave ?? false,
    getDocumentInfo: vi.fn(() => ({ encrypted: options.encrypted ?? false })),
    exportHwpWithReport: vi.fn(() => hwpArtifact),
    exportHwpxWithReport: vi.fn(() => hwpxArtifact),
    exportHwpWithPasswordAndReport: vi.fn(() => hwpArtifact),
    exportHwpxWithPasswordAndReport: vi.fn(() => hwpxArtifact),
  };
  const input = {
    flushDeferredPaginationIfNeeded: vi.fn(),
    hasDeferredPaginationPending: vi.fn(() => false),
  };
  const services = { wasm, getInputHandler: () => input };
  return {
    hwpArtifact,
    hwpxArtifact,
    wasm,
    input,
    services,
    promptPassword: vi.fn().mockResolvedValue(null),
  };
}

function exportArtifact(outputFormat: 'hwp' | 'hwpx', bytes: number[]) {
  return {
    bytes: new Uint8Array(bytes),
    contentLoss: { schemaVersion: 1 as const, outputFormat, count: 0, losses: [] },
  };
}
