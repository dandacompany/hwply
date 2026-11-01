import type { DesktopStudioHandlers } from '../embed/desktop-runtime';
import type { ContentLossReport } from '@upstream/core/export-content-loss';
import type { DesktopHostDependencies } from './desktop-host-dependencies';
import {
  createPdfExportSnapshot,
  type PdfExportSnapshot,
} from './pdf-export-snapshot';
import type { DesktopSourceExport } from './desktop-source-export';
import type {
  ActiveDesktopSession,
  DesktopDocumentFormat,
  NativeDocumentState,
} from './desktop-session';

interface NativeSaveResult extends Omit<NativeDocumentState, 'fileName'> {}

export const PDF_EXPORT_PIPELINE_TIMEOUT_MS = 10 * 60 * 1_000;

export interface PdfExportResult {
  path: string;
  pageCount: number;
  textMode: 'searchable' | 'outlined-fallback';
  warning?: string | null;
}

interface SourceSaveResult {
  state: NativeDocumentState;
  handlers: DesktopStudioHandlers;
  contentLoss: ContentLossReport | null;
  passwordProtected: boolean;
}

export type DesktopSourceExporter = (
  format: DesktopDocumentFormat,
) => Promise<DesktopSourceExport | null>;

export class DesktopPersistence {
  constructor(private readonly dependencies: DesktopHostDependencies) {}

  async saveSource(
    active: Readonly<ActiveDesktopSession>,
    exportSource: DesktopSourceExporter,
    requestedFormat = active.format,
    forceSaveAs = false,
  ): Promise<SourceSaveResult | null> {
    let targetPath = active.sourcePath;
    if (forceSaveAs || !targetPath || requestedFormat !== active.format) {
      const defaultPath = await this.dependencies.resolveSaveDefaultPath(
        suggestedDocumentName(active.fileName, requestedFormat),
        active.sourcePath,
      );
      const selected = await this.dependencies.chooseDocumentSavePath(
        defaultPath,
        requestedFormat,
      );
      if (!selected) return null;
      targetPath = withExtension(selected, requestedFormat);
    }

    const allowExternalOverwrite = await this.confirmExternalOverwrite(active.docId, targetPath);
    if (allowExternalOverwrite === null) return null;
    return this.saveSourceTo(active, exportSource, {
      targetPath,
      format: requestedFormat,
      allowExternalOverwrite,
    });
  }

  /** 대화상자 없이 정해진 경로로 저장한다(사람 저장의 뒷부분, 에이전트 저장 전체). */
  async saveSourceTo(
    active: Readonly<ActiveDesktopSession>,
    exportSource: DesktopSourceExporter,
    { targetPath, format: requestedFormat, allowExternalOverwrite }: {
      targetPath: string;
      format: DesktopDocumentFormat;
      allowExternalOverwrite: boolean;
    },
  ): Promise<SourceSaveResult | null> {
    const stagedPath = await this.invoke<string>('prepare_staged_document_save', {
      targetPath,
      format: requestedFormat,
    });
    try {
      const handlers = await this.dependencies.handlers();
      const exported = await exportSource(requestedFormat);
      if (!exported) return null;
      await this.dependencies.writeDocument(stagedPath, exported.artifact.bytes);
      const result = await this.invoke<NativeSaveResult>('commit_staged_document_save', {
        request: {
          docId: active.docId,
          stagedPath,
          targetPath,
          format: requestedFormat,
          expectedRevision: active.revision,
          allowExternalOverwrite,
        },
      });
      return {
        state: { ...result, fileName: fileNameFromPath(targetPath) },
        handlers,
        contentLoss: exported.artifact.contentLoss,
        passwordProtected: exported.passwordProtected,
      };
    } finally {
      await this.dependencies.removeFile(stagedPath).catch(() => undefined);
    }
  }

  /** 대상 파일이 hwply 밖에서 바뀌었는지(대화상자 없음). */
  async isChangedOnDisk(docId: string, targetPath: string): Promise<boolean> {
    const status = await this.invoke<{ changed: boolean }>('check_external_modification', {
      docId,
      targetPath,
    });
    return status.changed;
  }

  async exportPdf(
    fileName: string,
    sourcePath: string | null,
    format: DesktopDocumentFormat,
  ): Promise<PdfExportResult | null> {
    const defaultPath = await this.dependencies.resolveSaveDefaultPath(
      suggestedPdfName(fileName),
      sourcePath,
    );
    const selected = await this.dependencies.choosePdfSavePath(defaultPath);
    if (!selected) return null;
    const result = await this.exportPdfToTarget(format, withExtension(selected, 'pdf'));
    if (result.textMode === 'outlined-fallback') {
      await this.dependencies.showMessage(
        result.warning ?? '검색 가능한 텍스트 변환에 실패해 글자 윤곽선으로 저장했습니다.',
        { title: 'PDF 저장 경고', kind: 'warning' },
      );
    }
    return result;
  }

  private async exportPdfToTarget(
    format: DesktopDocumentFormat,
    targetPath: string,
  ): Promise<PdfExportResult> {
    const deadline = pdfNow() + PDF_EXPORT_PIPELINE_TIMEOUT_MS;
    const handlers = await runPdfStep(() => this.dependencies.handlers(), deadline);
    const snapshot = await runPdfStep(
      () => createPdfExportSnapshot({ source: handlers, format }),
      deadline,
    );
    let jobId: string | null = null;
    try {
      jobId = await runPdfStep(() => this.invoke<string>('begin_pdf_export', {
        request: {
          snapshotId: snapshot.id,
          targetPath,
          pageCount: snapshot.pageCount,
        },
      }), deadline);
      await this.appendPdfSnapshot(jobId, snapshot, deadline);
      const result = await runPdfStep(() => this.invoke<PdfExportResult>('commit_pdf_export', {
        request: { jobId, snapshotId: snapshot.id },
      }), deadline);
      jobId = null;
      return result;
    } finally {
      if (jobId) await this.abortPdfJob(jobId, snapshot.id, deadline);
      disposePdfSnapshot(snapshot);
    }
  }

  private async appendPdfSnapshot(
    jobId: string,
    snapshot: PdfExportSnapshot,
    deadline: number,
  ): Promise<void> {
    for (let pageIndex = 0; pageIndex < snapshot.pageCount; pageIndex += 1) {
      assertPdfDeadline(deadline);
      const svg = snapshot.renderPageSvg(pageIndex);
      assertPdfDeadline(deadline);
      await runPdfStep(() => this.invoke<void>('append_pdf_page', {
        request: { jobId, snapshotId: snapshot.id, pageIndex, svg },
      }), deadline);
    }
  }

  private async abortPdfJob(
    jobId: string,
    snapshotId: string,
    deadline: number,
  ): Promise<void> {
    try {
      const abort = this.invoke<void>('abort_pdf_export', {
        request: { jobId, snapshotId },
      }).catch(() => undefined);
      await runPdfStep(() => abort, deadline).catch(() => undefined);
    } catch {
      // Native reaper가 응답이 끊긴 job의 최종 회수 경계다.
    }
  }

  private async confirmExternalOverwrite(
    docId: string,
    targetPath: string,
  ): Promise<boolean | null> {
    const status = await this.invoke<{
      changed: boolean;
      sourcePath?: string | null;
      reason?: string | null;
    }>('check_external_modification', { docId, targetPath });
    if (!status.changed) return false;
    const result = await this.dependencies.showMessage(
      [
        '원본 파일이 hwply 밖에서 변경되었습니다.',
        status.sourcePath ? `파일: ${status.sourcePath}` : '',
        status.reason ?? '',
        '그대로 저장하면 외부에서 변경된 내용이 사라질 수 있습니다.',
      ].filter(Boolean).join('\n'),
      {
        title: '외부 변경 감지',
        kind: 'warning',
        buttons: { yes: '덮어쓰기', no: '저장 취소', cancel: '취소' },
      },
    );
    return result === '덮어쓰기' || result === 'Yes' ? true : null;
  }

  private invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
    return this.dependencies.invoke(command, args) as Promise<T>;
  }
}

function suggestedDocumentName(fileName: string, format: DesktopDocumentFormat): string {
  return `${documentStem(fileName) || 'document'}.${format}`;
}

function suggestedPdfName(fileName: string): string {
  return `${documentStem(fileName) || 'document'}.pdf`;
}

function documentStem(fileName: string): string {
  return fileName.replace(/\.(hwp|hwpx)$/i, '');
}

function withExtension(path: string, extension: DesktopDocumentFormat | 'pdf'): string {
  if (new RegExp(`\\.${extension}$`, 'i').test(path)) return path;
  return `${path.replace(/\.(hwp|hwpx|pdf)$/i, '')}.${extension}`;
}

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).pop() || 'document.hwp';
}

async function runPdfStep<T>(operation: () => Promise<T>, deadline: number): Promise<T> {
  const remaining = deadline - pdfNow();
  if (remaining <= 0) throw pdfPipelineTimeoutError();
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = globalThis.setTimeout(() => reject(pdfPipelineTimeoutError()), remaining);
  });
  try {
    const result = await Promise.race([operation(), timeout]);
    assertPdfDeadline(deadline);
    return result;
  } finally {
    if (timer !== undefined) globalThis.clearTimeout(timer);
  }
}

function assertPdfDeadline(deadline: number): void {
  if (pdfNow() > deadline) throw pdfPipelineTimeoutError();
}

function pdfPipelineTimeoutError(): Error {
  return new Error('PDF 저장 시간이 10분 제한을 초과했습니다');
}

function pdfNow(): number {
  return globalThis.performance.now();
}

function disposePdfSnapshot(snapshot: PdfExportSnapshot): void {
  try {
    snapshot.dispose();
  } catch (error) {
    console.warn('[desktop-persistence] PDF snapshot cleanup failed:', error);
  }
}
