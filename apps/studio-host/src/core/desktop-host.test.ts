import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentExportArtifact } from '@upstream/core/export-content-loss';
import { DesktopHost, type DesktopHostDependencies } from './desktop-host';
import type { DesktopStudioHandlers } from '../embed/desktop-runtime';
import { DesktopPersistence, type PdfExportResult } from './desktop-persistence';

describe('desktop host', () => {
  beforeEach(() => {
    (globalThis as { document?: unknown }).document = { title: '' };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads native bytes through the upstream handler before committing the session', async () => {
    const fixture = createFixture();
    fixture.invoke.mockImplementation(async (command) => {
      if (command === 'prepare_document_open') return undefined;
      if (command === 'open_document_tracking') return nativeOpen({ docId: 'opened' });
      if (command === 'record_recent_document') return undefined;
      throw new Error(`unexpected command: ${command}`);
    });
    const host = new DesktopHost(fixture.dependencies);
    host.bindCommandServices(fixture.services as never);

    await expect(host.openDocumentByPath('/documents/opened.hwp')).resolves.toEqual({
      fileName: 'opened.hwp',
      pageCount: 2,
    });
    expect(fixture.dependencies.setWindowTitle).toHaveBeenCalledWith('opened.hwp — hwply');

    expect(fixture.handlers.loadFile).toHaveBeenCalledWith(
      new Uint8Array([1, 2, 3]),
      'opened.hwp',
      false,
      false,
    );
    expect(host.activeSession).toMatchObject({ docId: 'opened', sourcePath: '/documents/opened.hwp' });
    expect(fixture.invoke).toHaveBeenCalledWith('record_recent_document', {
      path: '/documents/opened.hwp',
    });
    expect(document.title).toBe('opened.hwp — hwply');
  });

  it('closes a native tracking session when the Studio load fails', async () => {
    const fixture = createFixture();
    fixture.handlers.loadFile.mockRejectedValue(new Error('parse failed'));
    fixture.invoke.mockImplementation(async (command) => {
      if (command === 'prepare_document_open') return undefined;
      if (command === 'open_document_tracking') return nativeOpen({ docId: 'failed' });
      if (command === 'close_document') return undefined;
      throw new Error(`unexpected command: ${command}`);
    });
    const host = new DesktopHost(fixture.dependencies);
    host.bindCommandServices(fixture.services as never);

    await expect(host.openDocumentByPath('/documents/failed.hwp')).rejects.toThrow('parse failed');

    expect(host.activeSession).toBeNull();
    expect(fixture.invoke).toHaveBeenCalledWith('close_document', { docId: 'failed' });
  });

  it('coalesces concurrent event and pending opens for the same path', async () => {
    const fixture = createFixture();
    let releaseLoad!: () => void;
    fixture.handlers.loadFile.mockImplementation(() => new Promise((resolve) => {
      releaseLoad = () => resolve({ pageCount: 2 });
    }));
    fixture.invoke.mockImplementation(async (command) => {
      if (command === 'prepare_document_open') return undefined;
      if (command === 'open_document_tracking') return nativeOpen({ docId: 'single' });
      if (command === 'record_recent_document') return undefined;
      throw new Error(`unexpected command: ${command}`);
    });
    const host = new DesktopHost(fixture.dependencies);
    host.bindCommandServices(fixture.services as never);

    const first = host.openDocumentByPath('/documents/once.hwp');
    const second = host.openDocumentByPath('/documents/once.hwp');
    await vi.waitFor(() => expect(fixture.handlers.loadFile).toHaveBeenCalledOnce());
    releaseLoad();
    await Promise.all([first, second]);

    expect(first).toBe(second);
    expect(fixture.handlers.loadFile).toHaveBeenCalledOnce();
  });

  it('syncs dirty state and saves the active HWP format through native staging', async () => {
    const fixture = createFixture();
    fixture.invoke.mockImplementation(async (command) => {
      if (command === 'prepare_document_open') return undefined;
      if (command === 'open_document_tracking') return nativeOpen({ docId: 'saved' });
      if (command === 'record_recent_document') return undefined;
      if (command === 'mark_document_dirty') return undefined;
      if (command === 'check_external_modification') return { changed: false };
      if (command === 'prepare_staged_document_save') return '/tmp/staged.hwp';
      if (command === 'commit_staged_document_save') {
        return nativeSave({ docId: 'saved', sourcePath: '/documents/opened.hwp', revision: 2 });
      }
      throw new Error(`unexpected command: ${command}`);
    });
    const host = new DesktopHost(fixture.dependencies);
    host.bindCommandServices(fixture.services as never);
    await host.openDocumentByPath('/documents/opened.hwp');

    host.markDocumentDirty();
    host.markDocumentDirty();
    expect(document.title).toBe('● opened.hwp — hwply');
    const result = await host.saveCurrent();
    expect(document.title).toBe('opened.hwp — hwply');

    expect(fixture.invoke).toHaveBeenCalledTimes(7);
    expect(fixture.invoke).toHaveBeenCalledWith('mark_document_dirty', { docId: 'saved' });
    expect(fixture.writeDocument).toHaveBeenCalledWith(
      '/tmp/staged.hwp',
      new Uint8Array([7, 8, 9]),
    );
    expect(fixture.invoke).toHaveBeenCalledWith('prepare_staged_document_save', {
      targetPath: '/documents/opened.hwp',
      format: 'hwp',
    });
    expect(fixture.wasm.exportHwpxWithReport).not.toHaveBeenCalled();
    expect(fixture.handlers.notifySaved).toHaveBeenCalledWith('opened.hwp');
    expect(result).toMatchObject({ revision: 2, dirty: false });
    expect(host.activeSession).toMatchObject({ revision: 2, dirty: false });
  });

  it('commits a pending native blank session only after upstream initialization', async () => {
    const fixture = createFixture();
    fixture.invoke.mockImplementation(async (command) => {
      if (command === 'create_document') {
        return nativeOpen({ docId: 'new-doc', fileName: '새 문서.hwp', sourcePath: null });
      }
      throw new Error(`unexpected command: ${command}`);
    });
    const host = new DesktopHost(fixture.dependencies);
    const eventBus = { emit: vi.fn() };
    const services = commandServices({ eventBus });

    await expect(host.beginNewDocument(services as never)).resolves.toBe(true);
    expect(host.activeSession).toBeNull();
    expect(eventBus.emit).toHaveBeenCalledWith('create-new-document', { skipUnsavedGuard: true });

    host.completePendingDocumentInitialization();
    expect(host.activeSession).toMatchObject({ docId: 'new-doc', sourcePath: null });
  });

  it('coalesces concurrent PDF export requests in one WebView', async () => {
    const fixture = createFixture();
    fixture.invoke.mockImplementation(async (command) => {
      if (command === 'prepare_document_open') return undefined;
      if (command === 'open_document_tracking') {
        return nativeOpen({
          docId: 'pdf-doc',
          fileName: 'source.hwpx',
          sourcePath: '/documents/source.hwpx',
          format: 'hwpx',
          dirty: true,
        });
      }
      if (command === 'record_recent_document') return undefined;
      throw new Error(`unexpected command: ${command}`);
    });
    const host = new DesktopHost(fixture.dependencies);
    await host.openDocumentByPath('/documents/source.hwpx');
    const active = host.activeSession;
    if (!active) throw new Error('active session fixture missing');
    const activeBefore = { ...active, warnings: [...active.warnings] };
    let finishExport!: (result: PdfExportResult) => void;
    const exportResult = new Promise<PdfExportResult>((resolve) => {
      finishExport = resolve;
    });
    const exportPdf = vi.spyOn(DesktopPersistence.prototype, 'exportPdf')
      .mockReturnValue(exportResult);

    const first = host.exportCurrentPdf();
    const second = host.exportCurrentPdf();
    expect(exportPdf).toHaveBeenCalledOnce();
    expect(exportPdf).toHaveBeenCalledWith(
      'source.hwpx',
      '/documents/source.hwpx',
      'hwpx',
    );
    finishExport({
      path: '/documents/source.pdf',
      pageCount: 2,
      textMode: 'searchable',
    });
    await Promise.all([first, second]);

    expect(first).toBe(second);
    expect(host.activeSession).toEqual(activeBefore);
    expect(fixture.handlers.notifySaved).not.toHaveBeenCalled();
  });

  describe('agent bridge', () => {
    async function openedHost(fixture: ReturnType<typeof createFixture>, extra: (command: string, args: unknown) => unknown = () => {
      throw new Error('unexpected');
    }) {
      fixture.invoke.mockImplementation(async (command, args) => {
        if (command === 'prepare_document_open') return undefined;
        if (command === 'open_document_tracking') return nativeOpen({ docId: 'doc' });
        if (command === 'record_recent_document') return undefined;
        if (command === 'mark_document_dirty') return undefined;
        return extra(command, args);
      });
      const host = new DesktopHost(fixture.dependencies);
      host.bindCommandServices(fixture.services as never);
      await host.openDocumentByPath('/documents/opened.hwp');
      return host;
    }

    it('saveForAgent without a path gives SAVE_PATH_REQUIRED and opens no dialog', async () => {
      const fixture = createFixture();
      fixture.invoke.mockImplementation(async (command) => {
        if (command === 'create_document') return nativeOpen({ docId: 'blank', fileName: '', sourcePath: null });
        throw new Error(`unexpected command: ${command}`);
      });
      const host = new DesktopHost(fixture.dependencies);
      await host.beginNewDocument(fixture.services as never);
      host.completePendingDocumentInitialization();

      await expect(host.saveForAgent({ force: false })).rejects.toMatchObject({ code: 'SAVE_PATH_REQUIRED' });
      expect(fixture.dependencies.chooseDocumentSavePath).not.toHaveBeenCalled();
      expect(fixture.dependencies.showMessage).not.toHaveBeenCalled();
    });

    it('saveForAgent refuses FILE_CHANGED_ON_DISK unless force', async () => {
      const fixture = createFixture();
      const host = await openedHost(fixture, (command) => {
        if (command === 'check_external_modification') return { changed: true, reason: 'mtime' };
        if (command === 'prepare_staged_document_save') return '/tmp/staged.hwp';
        if (command === 'commit_staged_document_save') return nativeSave({ docId: 'doc', revision: 2 });
        throw new Error(`unexpected command: ${command}`);
      });

      await expect(host.saveForAgent({ force: false })).rejects.toMatchObject({ code: 'FILE_CHANGED_ON_DISK' });
      expect(fixture.invoke).not.toHaveBeenCalledWith('prepare_staged_document_save', expect.anything());

      const saved = await host.saveForAgent({ force: true });
      expect(saved.path).toBe('/documents/opened.hwp');
      expect(fixture.invoke).toHaveBeenCalledWith('commit_staged_document_save', {
        request: expect.objectContaining({ allowExternalOverwrite: true, targetPath: '/documents/opened.hwp' }),
      });
      expect(fixture.dependencies.showMessage).not.toHaveBeenCalled();
    });

    it('saveForAgent reports content loss as warnings instead of a dialog', async () => {
      const fixture = createFixture();
      fixture.wasm.exportHwpxWithReport.mockReturnValue({
        bytes: new Uint8Array([4, 5, 6]),
        contentLoss: {
          schemaVersion: 1, outputFormat: 'hwpx', count: 1,
          losses: [{ code: 'x', subject: 'equation', path: 'body/0', reason: 'unsupported' } as never],
        },
      });
      const host = await openedHost(fixture, (command) => {
        if (command === 'check_external_modification') return { changed: false };
        if (command === 'prepare_staged_document_save') return '/tmp/staged.hwpx';
        if (command === 'commit_staged_document_save') {
          return nativeSave({ docId: 'doc', format: 'hwpx', sourcePath: '/documents/out.hwpx', revision: 2 });
        }
        throw new Error(`unexpected command: ${command}`);
      });

      const saved = await host.saveForAgent({ targetPath: '/documents/out.hwpx', force: false });
      expect(saved.path).toBe('/documents/out.hwpx');
      expect(saved.warnings).toHaveLength(1);
      expect(saved.warnings[0]).toContain('HWPX');
      expect(fixture.dependencies.showMessage).not.toHaveBeenCalled();
      expect(host.activeSession).toMatchObject({ format: 'hwpx', fileName: 'out.hwpx' });
    });

    it('reloadForAgent passes the session file name and marks Studio and the session dirty', async () => {
      const fixture = createFixture();
      const host = await openedHost(fixture);
      fixture.handlers.loadFile.mockClear();

      await host.reloadForAgent(new Uint8Array([5, 5]));

      expect(fixture.handlers.loadFile).toHaveBeenCalledWith(new Uint8Array([5, 5]), 'opened.hwp', true, true);
      expect(fixture.services.documentState.markDirty).toHaveBeenCalledWith('agent-replace');
      expect(host.activeSession?.dirty).toBe(true);
      expect(fixture.invoke).toHaveBeenCalledWith('mark_document_dirty', { docId: 'doc' });
    });

    it('notifies save listeners after a human or agent save', async () => {
      const fixture = createFixture();
      const host = await openedHost(fixture, (command) => {
        if (command === 'check_external_modification') return { changed: false };
        if (command === 'prepare_staged_document_save') return '/tmp/staged.hwp';
        if (command === 'commit_staged_document_save') return nativeSave({ docId: 'doc', revision: 2 });
        throw new Error(`unexpected command: ${command}`);
      });
      const listener = vi.fn();
      host.onSaved(listener);
      await host.saveCurrent();
      await host.saveForAgent({ force: false });
      expect(listener).toHaveBeenCalledTimes(2);
    });

    it('attaches the session to the agent bridge once per change and detaches on release', async () => {
      const fixture = createFixture();
      const host = await openedHost(fixture, (command) => {
        if (command === 'close_document') return undefined;
        throw new Error(`unexpected command: ${command}`);
      });
      host.syncDocumentTitle();
      host.syncDocumentTitle();
      expect(fixture.dependencies.reportAgentDocument).toHaveBeenCalledTimes(1);
      expect(fixture.dependencies.reportAgentDocument).toHaveBeenLastCalledWith({
        docId: 'doc',
        fileName: 'opened.hwp',
        sourcePath: '/documents/opened.hwp',
        format: 'hwp',
        encrypted: false,
      });

      await host.confirmWindowClose();
      expect(fixture.dependencies.reportAgentDocument).toHaveBeenLastCalledWith(null);
    });
  });
});

function createFixture() {
  const invoke = vi.fn();
  const writeDocument = vi.fn().mockResolvedValue(undefined);
  const handlers: DesktopStudioHandlers = {
    loadFile: vi.fn().mockResolvedValue({ pageCount: 2 }),
    pageCount: vi.fn().mockResolvedValue(2),
    getPageSvg: vi.fn().mockResolvedValue('<svg/>'),
    exportHwp: vi.fn().mockResolvedValue(new Uint8Array([7, 8, 9])),
    exportHwpx: vi.fn().mockResolvedValue(new Uint8Array([4, 5, 6])),
    notifySaved: vi.fn().mockResolvedValue({ ok: true, wasDirty: true }),
    exportHml: vi.fn().mockResolvedValue(new Uint8Array([3])),
    getDocumentState: vi.fn(),
    getSelectionContext: vi.fn(),
    applyTextCommand: vi.fn(),
    focusTarget: vi.fn(),
  };
  const dependencies: DesktopHostDependencies = {
    invoke,
    chooseOpenPath: vi.fn().mockResolvedValue(null),
    chooseDocumentSavePath: vi.fn().mockResolvedValue(null),
    choosePdfSavePath: vi.fn().mockResolvedValue(null),
    resolveSaveDefaultPath: vi.fn(async (fileName) => `/documents/${fileName}`),
    chooseDocumentSavePassword: vi.fn().mockResolvedValue(null),
    showMessage: vi.fn().mockResolvedValue('취소'),
    readDocument: vi.fn().mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]) }),
    writeDocument,
    removeFile: vi.fn().mockResolvedValue(undefined),
    handlers: vi.fn().mockResolvedValue(handlers),
    setWindowTitle: vi.fn().mockResolvedValue(undefined),
    reportAgentDocument: vi.fn().mockResolvedValue(undefined),
  };
  const wasm = {
    fileName: 'document.hwp',
    requiresPasswordForSave: false,
    getDocumentInfo: vi.fn(() => ({ encrypted: false })),
    exportHwpWithReport: vi.fn(() => exportArtifact('hwp', [7, 8, 9])),
    exportHwpxWithReport: vi.fn(() => exportArtifact('hwpx', [4, 5, 6])),
  };
  const services = {
    eventBus: { emit: vi.fn() },
    wasm,
    documentState: { markDirty: vi.fn() },
    getContext: () => ({ hasDocument: true, isDirty: false }),
    getInputHandler: () => null,
  };
  return {
    dependencies,
    handlers: handlers as MockedHandlers,
    invoke,
    writeDocument,
    services,
    wasm,
  };
}

function exportArtifact(
  outputFormat: 'hwp' | 'hwpx',
  bytes: number[],
): DocumentExportArtifact {
  return {
    bytes: new Uint8Array(bytes),
    contentLoss: { schemaVersion: 1 as const, outputFormat, count: 0, losses: [] },
  };
}

type MockedHandlers = {
  [Key in keyof DesktopStudioHandlers]: ReturnType<typeof vi.fn>;
};

function nativeOpen(overrides: Record<string, unknown> = {}) {
  return {
    docId: 'doc',
    fileName: 'opened.hwp',
    sourcePath: '/documents/opened.hwp',
    format: 'hwp',
    pageCount: 2,
    revision: 1,
    dirty: false,
    warnings: [],
    ...overrides,
  };
}

function nativeSave(overrides: Record<string, unknown> = {}) {
  const { fileName: _fileName, pageCount: _pageCount, ...result } = nativeOpen(overrides);
  return result;
}

function commandServices({ eventBus }: { eventBus: { emit: ReturnType<typeof vi.fn> } }) {
  return {
    eventBus,
    wasm: { fileName: 'document.hwp' },
    getContext: () => ({ hasDocument: false, isDirty: false }),
  };
}
