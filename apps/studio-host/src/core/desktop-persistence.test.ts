import { describe, expect, it, vi } from 'vitest';
import type { DesktopStudioHandlers } from '../embed/desktop-runtime';
import type { DesktopHostDependencies } from './desktop-host-dependencies';
import {
  DesktopPersistence,
  PDF_EXPORT_PIPELINE_TIMEOUT_MS,
} from './desktop-persistence';
import { createPdfExportSnapshot } from './pdf-export-snapshot';
import type { ActiveDesktopSession } from './desktop-session';
import type { DesktopSourceExport } from './desktop-source-export';

vi.mock('./pdf-export-snapshot', () => ({
  createPdfExportSnapshot: vi.fn(),
}));

const SNAPSHOT_ID = '123e4567-e89b-42d3-a456-426614174000';
const createSnapshot = vi.mocked(createPdfExportSnapshot);

describe('desktop persistence', () => {
  it('preserves HWPX on save and supports explicit cross-format save-as', async () => {
    const fixture = createFixture();
    fixture.dependencies.chooseDocumentSavePath = vi.fn().mockResolvedValue('/exports/converted.hwp');
    fixture.invoke.mockImplementation(async (command, args) => {
      if (command === 'check_external_modification') return { changed: false };
      if (command === 'prepare_staged_document_save') {
        return args?.format === 'hwpx' ? '/tmp/staged.hwpx' : '/tmp/staged.hwp';
      }
      if (command === 'commit_staged_document_save') {
        const request = args?.request as Record<string, unknown>;
        return nativeSave({
          sourcePath: request.targetPath,
          format: request.format,
          revision: request.format === 'hwpx' ? 2 : 3,
        });
      }
      throw new Error(`unexpected command: ${command}`);
    });
    const persistence = new DesktopPersistence(fixture.dependencies);
    const active = activeSession();

    const hwpx = await persistence.saveSource(active, fixture.exportSource);
    expect(hwpx?.state).toMatchObject({
      format: 'hwpx', sourcePath: '/documents/source.hwpx', fileName: 'source.hwpx',
    });
    expect(fixture.exportSource).toHaveBeenCalledWith('hwpx');
    expect(fixture.dependencies.chooseDocumentSavePath).not.toHaveBeenCalled();

    const hwp = await persistence.saveSource(active, fixture.exportSource, 'hwp', true);
    expect(fixture.dependencies.resolveSaveDefaultPath)
      .toHaveBeenCalledWith('source.hwp', '/documents/source.hwpx');
    expect(fixture.dependencies.chooseDocumentSavePath)
      .toHaveBeenCalledWith('/documents/source.hwp', 'hwp');
    expect(hwp?.state).toMatchObject({
      format: 'hwp', sourcePath: '/exports/converted.hwp', fileName: 'converted.hwp',
    });
    expect(fixture.invoke.mock.calls
      .filter(([command]) => command === 'commit_staged_document_save'))
      .toEqual([
        ['commit_staged_document_save', {
          request: {
            docId: 'doc',
            stagedPath: '/tmp/staged.hwpx',
            targetPath: '/documents/source.hwpx',
            format: 'hwpx',
            expectedRevision: 1,
            allowExternalOverwrite: false,
          },
        }],
        ['commit_staged_document_save', {
          request: {
            docId: 'doc',
            stagedPath: '/tmp/staged.hwp',
            targetPath: '/exports/converted.hwp',
            format: 'hwp',
            expectedRevision: 1,
            allowExternalOverwrite: false,
          },
        }],
      ]);
    expect(fixture.exportSource.mock.calls.map(([format]) => format)).toEqual(['hwpx', 'hwp']);
    expect(fixture.handlers.notifySaved).not.toHaveBeenCalled();
  });

  it('keeps the source state unchanged and removes staging when save commit fails', async () => {
    const fixture = createFixture();
    fixture.invoke.mockImplementation(async (command) => {
      if (command === 'check_external_modification') return { changed: false };
      if (command === 'prepare_staged_document_save') return '/tmp/staged.hwpx';
      if (command === 'commit_staged_document_save') throw new Error('commit failed');
      throw new Error(`unexpected command: ${command}`);
    });
    const persistence = new DesktopPersistence(fixture.dependencies);
    const active = activeSession({ dirty: true });
    const snapshot = { ...active };

    await expect(persistence.saveSource(active, fixture.exportSource)).rejects.toThrow('commit failed');

    expect(active).toEqual(snapshot);
    expect(fixture.handlers.notifySaved).not.toHaveBeenCalled();
    expect(fixture.dependencies.removeFile).toHaveBeenCalledWith('/tmp/staged.hwpx');
  });

  it('removes staging without writing when source export is cancelled', async () => {
    const fixture = createFixture();
    fixture.exportSource.mockResolvedValueOnce(null);
    fixture.invoke.mockImplementation(async (command) => {
      if (command === 'check_external_modification') return { changed: false };
      if (command === 'prepare_staged_document_save') return '/tmp/cancelled.hwpx';
      throw new Error(`unexpected command: ${command}`);
    });
    const persistence = new DesktopPersistence(fixture.dependencies);

    await expect(persistence.saveSource(activeSession(), fixture.exportSource))
      .resolves.toBeNull();

    expect(fixture.dependencies.writeDocument).not.toHaveBeenCalled();
    expect(fixture.dependencies.removeFile).toHaveBeenCalledWith('/tmp/cancelled.hwpx');
  });

  it('streams one HWPX snapshot while live page handlers keep changing', async () => {
    const fixture = createFixture();
    fixture.dependencies.choosePdfSavePath = vi.fn().mockResolvedValue('/exports/current.pdf');
    fixture.snapshot.pageCount = 3;
    fixture.snapshot.renderPageSvg.mockImplementation((page) => `<svg data-snapshot="${page}"/>`);
    createSnapshot.mockImplementationOnce(async () => {
      fixture.handlers.pageCount.mockResolvedValue(99);
      fixture.handlers.getPageSvg.mockImplementation(async (page) => `<svg data-live="${page}"/>`);
      return fixture.snapshot;
    });
    fixture.invoke.mockImplementation(async (command) => {
      if (command === 'begin_pdf_export') return 'pdf-job';
      if (command === 'append_pdf_page') return undefined;
      if (command === 'commit_pdf_export') {
        return { path: '/exports/current.pdf', pageCount: 3, textMode: 'searchable' };
      }
      throw new Error(`unexpected command: ${command}`);
    });
    const persistence = new DesktopPersistence(fixture.dependencies);

    await expect(
      persistence.exportPdf('source.hwpx', '/documents/source.hwpx', 'hwpx'),
    ).resolves.toEqual({ path: '/exports/current.pdf', pageCount: 3, textMode: 'searchable' });

    expect(fixture.dependencies.resolveSaveDefaultPath)
      .toHaveBeenCalledWith('source.pdf', '/documents/source.hwpx');
    expect(fixture.dependencies.choosePdfSavePath)
      .toHaveBeenCalledWith('/documents/source.pdf');
    expect(createSnapshot).toHaveBeenCalledOnce();
    expect(createSnapshot).toHaveBeenCalledWith({ source: fixture.handlers, format: 'hwpx' });
    expect(fixture.handlers.pageCount).not.toHaveBeenCalled();
    expect(fixture.handlers.getPageSvg).not.toHaveBeenCalled();
    expect(fixture.snapshot.renderPageSvg.mock.calls.map(([page]) => page)).toEqual([0, 1, 2]);
    expect(fixture.invoke).toHaveBeenCalledWith('begin_pdf_export', {
      request: {
        snapshotId: SNAPSHOT_ID,
        targetPath: '/exports/current.pdf',
        pageCount: 3,
      },
    });
    expect(fixture.invoke.mock.calls.filter(([command]) => command === 'append_pdf_page'))
      .toEqual([
        ['append_pdf_page', {
          request: {
            jobId: 'pdf-job', snapshotId: SNAPSHOT_ID,
            pageIndex: 0, svg: '<svg data-snapshot="0"/>',
          },
        }],
        ['append_pdf_page', {
          request: {
            jobId: 'pdf-job', snapshotId: SNAPSHOT_ID,
            pageIndex: 1, svg: '<svg data-snapshot="1"/>',
          },
        }],
        ['append_pdf_page', {
          request: {
            jobId: 'pdf-job', snapshotId: SNAPSHOT_ID,
            pageIndex: 2, svg: '<svg data-snapshot="2"/>',
          },
        }],
      ]);
    expect(fixture.invoke).toHaveBeenCalledWith('commit_pdf_export', {
      request: { jobId: 'pdf-job', snapshotId: SNAPSHOT_ID },
    });
    expect(fixture.snapshot.dispose).toHaveBeenCalledOnce();
    expect(fixture.handlers.notifySaved).not.toHaveBeenCalled();
  });

  it('selects an HWP snapshot and preserves the outlined fallback warning', async () => {
    const fixture = createFixture();
    fixture.dependencies.choosePdfSavePath = vi.fn().mockResolvedValue('/exports/current.pdf');
    fixture.snapshot.pageCount = 1;
    fixture.invoke.mockImplementation(async (command) => {
      if (command === 'begin_pdf_export') return 'fallback-job';
      if (command === 'append_pdf_page') return undefined;
      if (command === 'commit_pdf_export') {
        return {
          path: '/exports/current.pdf',
          pageCount: 2,
          textMode: 'outlined-fallback',
          warning: '검색 가능한 텍스트 변환 실패',
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });
    const persistence = new DesktopPersistence(fixture.dependencies);

    await persistence.exportPdf('source.hwp', null, 'hwp');
    expect(createSnapshot).toHaveBeenCalledWith({ source: fixture.handlers, format: 'hwp' });
    expect(fixture.dependencies.showMessage).toHaveBeenCalledWith(
      '검색 가능한 텍스트 변환 실패',
      { title: 'PDF 저장 경고', kind: 'warning' },
    );
    expect(fixture.snapshot.dispose).toHaveBeenCalledOnce();
    expect(fixture.handlers.notifySaved).not.toHaveBeenCalled();
  });

  it('does not start a native PDF job when the save dialog is cancelled', async () => {
    const fixture = createFixture();
    const persistence = new DesktopPersistence(fixture.dependencies);

    await expect(persistence.exportPdf('source.hwp', null, 'hwp')).resolves.toBeNull();

    expect(fixture.dependencies.handlers).not.toHaveBeenCalled();
    expect(createSnapshot).not.toHaveBeenCalled();
    expect(fixture.invoke).not.toHaveBeenCalled();
    expect(fixture.handlers.notifySaved).not.toHaveBeenCalled();
  });

  it('does not start a native job when snapshot capture fails', async () => {
    const fixture = createFixture();
    fixture.dependencies.choosePdfSavePath = vi.fn().mockResolvedValue('/exports/current.pdf');
    createSnapshot.mockRejectedValueOnce(new Error('snapshot failed'));
    const persistence = new DesktopPersistence(fixture.dependencies);

    await expect(persistence.exportPdf('source.hwp', null, 'hwp'))
      .rejects.toThrow('snapshot failed');

    expect(fixture.invoke).not.toHaveBeenCalled();
    expect(fixture.handlers.pageCount).not.toHaveBeenCalled();
    expect(fixture.handlers.getPageSvg).not.toHaveBeenCalled();
    expect(fixture.handlers.notifySaved).not.toHaveBeenCalled();
  });

  it.each(['render', 'append', 'commit'] as const)(
    'aborts and disposes once when the %s step fails',
    async (failedStep) => {
      const fixture = createFixture();
      fixture.dependencies.choosePdfSavePath = vi.fn().mockResolvedValue('/exports/current.pdf');
      fixture.snapshot.pageCount = 1;
      if (failedStep === 'render') {
        fixture.snapshot.renderPageSvg.mockImplementation(() => {
          throw new Error('render failed');
        });
      }
      fixture.invoke.mockImplementation(async (command) => {
        if (command === 'begin_pdf_export') return 'failed-job';
        if (command === 'append_pdf_page') {
          if (failedStep === 'append') throw new Error('append failed');
          return undefined;
        }
        if (command === 'commit_pdf_export') throw new Error('commit failed');
        if (command === 'abort_pdf_export') return undefined;
        throw new Error(`unexpected command: ${command}`);
      });
      const persistence = new DesktopPersistence(fixture.dependencies);

      await expect(persistence.exportPdf('source.hwp', null, 'hwp'))
        .rejects.toThrow(`${failedStep} failed`);

      expect(fixture.invoke).toHaveBeenCalledWith('abort_pdf_export', {
        request: { jobId: 'failed-job', snapshotId: SNAPSHOT_ID },
      });
      expect(fixture.invoke.mock.calls.filter(([command]) => command === 'abort_pdf_export'))
        .toHaveLength(1);
      expect(fixture.snapshot.dispose).toHaveBeenCalledOnce();
      expect(fixture.handlers.notifySaved).not.toHaveBeenCalled();
    },
  );

  it('times out a stalled append, then starts a fresh snapshot job', async () => {
    vi.useFakeTimers();
    try {
      const fixture = createFixture();
      fixture.dependencies.choosePdfSavePath = vi.fn().mockResolvedValue('/exports/current.pdf');
      const firstSnapshot = pdfSnapshot(1);
      const secondSnapshot = pdfSnapshot(1);
      createSnapshot
        .mockReset()
        .mockResolvedValueOnce(firstSnapshot)
        .mockResolvedValueOnce(secondSnapshot);
      let beginCount = 0;
      fixture.invoke.mockImplementation(async (command) => {
        if (command === 'begin_pdf_export') return `job-${++beginCount}`;
        if (command === 'append_pdf_page' && beginCount === 1) {
          return new Promise(() => undefined);
        }
        if (command === 'append_pdf_page' || command === 'abort_pdf_export') return undefined;
        if (command === 'commit_pdf_export') {
          return { path: '/exports/current.pdf', pageCount: 1, textMode: 'searchable' };
        }
        throw new Error(`unexpected command: ${command}`);
      });
      const persistence = new DesktopPersistence(fixture.dependencies);

      const first = persistence.exportPdf('source.hwp', null, 'hwp');
      const firstExpectation = expect(first).rejects.toThrow('10분 제한');
      await vi.advanceTimersByTimeAsync(0);
      expect(fixture.invoke.mock.calls.filter(([command]) => command === 'append_pdf_page'))
        .toHaveLength(1);
      await vi.advanceTimersByTimeAsync(PDF_EXPORT_PIPELINE_TIMEOUT_MS);
      await firstExpectation;

      expect(fixture.invoke).toHaveBeenCalledWith('abort_pdf_export', {
        request: { jobId: 'job-1', snapshotId: SNAPSHOT_ID },
      });
      expect(firstSnapshot.dispose).toHaveBeenCalledOnce();

      await expect(persistence.exportPdf('source.hwp', null, 'hwp')).resolves.toMatchObject({
        path: '/exports/current.pdf', pageCount: 1, textMode: 'searchable',
      });
      expect(beginCount).toBe(2);
      expect(secondSnapshot.dispose).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});

function createFixture() {
  const snapshot = pdfSnapshot(2);
  createSnapshot.mockReset().mockResolvedValue(snapshot);
  const invoke = vi.fn();
  const handlers: DesktopStudioHandlers = {
    loadFile: vi.fn(),
    pageCount: vi.fn().mockResolvedValue(2),
    getPageSvg: vi.fn().mockResolvedValue('<svg/>'),
    exportHwp: vi.fn().mockResolvedValue(new Uint8Array([7, 8, 9])),
    exportHwpx: vi.fn().mockResolvedValue(new Uint8Array([4, 5, 6])),
    notifySaved: vi.fn(),
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
    showMessage: vi.fn().mockResolvedValue(true),
    readDocument: vi.fn(),
    writeDocument: vi.fn().mockResolvedValue(undefined),
    removeFile: vi.fn().mockResolvedValue(undefined),
    handlers: vi.fn().mockResolvedValue(handlers),
    setWindowTitle: vi.fn().mockResolvedValue(undefined),
    reportAgentDocument: vi.fn().mockResolvedValue(undefined),
  };
  const exportSource = vi.fn<(
    format: 'hwp' | 'hwpx',
  ) => Promise<DesktopSourceExport | null>>(async (format) => ({
    artifact: {
      bytes: format === 'hwpx' ? new Uint8Array([4, 5, 6]) : new Uint8Array([7, 8, 9]),
      contentLoss: {
        schemaVersion: 1 as const,
        outputFormat: format,
        count: 0,
        losses: [],
      },
    },
    passwordProtected: false,
  }));
  return { dependencies, handlers: handlers as MockedHandlers, invoke, exportSource, snapshot };
}

type MockedHandlers = {
  [Key in keyof DesktopStudioHandlers]: ReturnType<typeof vi.fn>;
};

function activeSession(overrides: Partial<ActiveDesktopSession> = {}): ActiveDesktopSession {
  return {
    docId: 'doc',
    fileName: 'source.hwpx',
    sourcePath: '/documents/source.hwpx',
    format: 'hwpx',
    revision: 1,
    dirty: false,
    warnings: [],
    ...overrides,
  };
}

function nativeSave(overrides: Record<string, unknown> = {}) {
  return {
    docId: 'doc',
    sourcePath: '/documents/source.hwpx',
    format: 'hwpx',
    revision: 2,
    dirty: false,
    warnings: [],
    ...overrides,
  };
}

function pdfSnapshot(pageCount: number) {
  return {
    id: SNAPSHOT_ID,
    pageCount,
    renderPageSvg: vi.fn((page: number) => `<svg data-snapshot="${page}"/>`),
    dispose: vi.fn(),
  };
}
