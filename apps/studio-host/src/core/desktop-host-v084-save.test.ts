import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopStudioHandlers } from '../embed/desktop-runtime';
import { DesktopHost, type DesktopHostDependencies } from './desktop-host';

describe('desktop host v0.8.4 explicit save', () => {
  beforeEach(() => {
    (globalThis as { document?: unknown }).document = { title: '' };
  });

  it('preserves password protection and warns only after a lossy native save commits', async () => {
    const fixture = createFixture();
    const host = new DesktopHost(fixture.dependencies);
    host.bindCommandServices(fixture.services as never);

    await host.openDocumentByPath('/documents/protected.hwp');
    expect(fixture.wasm.requiresPasswordForSave).toBe(true);
    await host.saveCurrent();

    expect(fixture.dependencies.chooseDocumentSavePassword)
      .toHaveBeenCalledWith('protected.hwp');
    expect(fixture.wasm.exportHwpWithPasswordAndReport).toHaveBeenCalledWith('새암호123');
    expect(fixture.writeDocument).toHaveBeenCalledWith(
      '/tmp/protected.hwp',
      new Uint8Array([9, 8, 7]),
    );
    expect(fixture.wasm.requiresPasswordForSave).toBe(true);
    const showMessage = fixture.dependencies.showMessage as ReturnType<typeof vi.fn>;
    expect(fixture.handlers.notifySaved.mock.invocationCallOrder[0])
      .toBeLessThan(showMessage.mock.invocationCallOrder[0]);
    expect(showMessage).toHaveBeenCalledWith(
      [
        'HWP 파일은 저장되었지만 일부 내용을 보존하지 못했습니다.',
        '• 문서 개체: sections/0/paragraphs/1/controls/2',
      ].join('\n'),
      { title: '문서 저장 경고', kind: 'warning' },
    );
  });
});

function createFixture() {
  const invoke = vi.fn(async (command: string) => {
    if (command === 'prepare_document_open') return undefined;
    if (command === 'open_document_tracking') return nativeOpen();
    if (command === 'record_recent_document') return undefined;
    if (command === 'check_external_modification') return { changed: false };
    if (command === 'prepare_staged_document_save') return '/tmp/protected.hwp';
    if (command === 'commit_staged_document_save') return nativeSave();
    throw new Error(`unexpected command: ${command}`);
  });
  const writeDocument = vi.fn().mockResolvedValue(undefined);
  const handlers = {
    loadFile: vi.fn().mockResolvedValue({ pageCount: 2 }),
    pageCount: vi.fn(),
    getPageSvg: vi.fn(),
    exportHwp: vi.fn(),
    exportHwpx: vi.fn(),
    notifySaved: vi.fn().mockResolvedValue({ ok: true, wasDirty: true }),
    exportHml: vi.fn().mockResolvedValue(new Uint8Array([3])),
    getDocumentState: vi.fn(),
    getSelectionContext: vi.fn(),
    applyTextCommand: vi.fn(),
    focusTarget: vi.fn(),
  } satisfies DesktopStudioHandlers;
  const dependencies: DesktopHostDependencies = {
    invoke,
    chooseOpenPath: vi.fn().mockResolvedValue(null),
    chooseDocumentSavePath: vi.fn().mockResolvedValue(null),
    choosePdfSavePath: vi.fn().mockResolvedValue(null),
    resolveSaveDefaultPath: vi.fn(async (fileName) => `/documents/${fileName}`),
    chooseDocumentSavePassword: vi.fn().mockResolvedValue('새암호123'),
    showMessage: vi.fn().mockResolvedValue(true),
    readDocument: vi.fn().mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]) }),
    writeDocument,
    removeFile: vi.fn().mockResolvedValue(undefined),
    handlers: vi.fn().mockResolvedValue(handlers),
    setWindowTitle: vi.fn().mockResolvedValue(undefined),
    reportAgentDocument: vi.fn().mockResolvedValue(undefined),
  };
  const wasm = {
    fileName: 'protected.hwp',
    requiresPasswordForSave: false,
    getDocumentInfo: vi.fn(() => ({ encrypted: true })),
    exportHwpWithPasswordAndReport: vi.fn(() => ({
      bytes: new Uint8Array([9, 8, 7]),
      contentLoss: {
        schemaVersion: 1,
        outputFormat: 'hwp',
        count: 1,
        losses: [{
          code: 'controlOmitted',
          subject: 'control',
          path: 'sections/0/paragraphs/1/controls/2',
          reason: 'unsupportedByOutputFormat',
        }],
      },
    })),
  };
  const services = {
    eventBus: { emit: vi.fn() },
    wasm,
    getContext: () => ({ hasDocument: true, isDirty: false }),
    getInputHandler: () => null,
  };
  return { dependencies, handlers, services, wasm, writeDocument };
}

function nativeOpen() {
  return {
    docId: 'protected',
    fileName: 'protected.hwp',
    sourcePath: '/documents/protected.hwp',
    format: 'hwp',
    pageCount: 2,
    revision: 1,
    dirty: false,
    warnings: [],
  };
}

function nativeSave() {
  const { fileName: _fileName, pageCount: _pageCount, ...result } = nativeOpen();
  return { ...result, revision: 2 };
}
