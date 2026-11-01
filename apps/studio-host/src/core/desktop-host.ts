import { PRODUCT_NAME, formatWindowTitle } from '../ui/product-shell';
import type { CommandServices } from '@upstream/command/types';
import {
  buildContentLossNotice,
  type ContentLossReport,
} from '@upstream/core/export-content-loss';
import {
  DesktopSession,
  type DesktopDocumentFormat,
  type NativeDocumentState,
} from './desktop-session';
import {
  createDefaultDesktopHostDependencies,
  type AgentDocumentReport,
  type DesktopHostDependencies,
} from './desktop-host-dependencies';
import { AgentBridgeError } from '../agent/agent-errors';
import { DesktopPersistence, type PdfExportResult } from './desktop-persistence';
import {
  exportDesktopSource,
  syncDesktopPasswordRequirement,
} from './desktop-source-export';

export type { DesktopHostDependencies } from './desktop-host-dependencies';

interface NativeOpenResult extends NativeDocumentState {
  pageCount: number;
}

export interface DesktopOpenResult {
  fileName: string;
  pageCount: number;
}

export class DesktopHost {
  private readonly session = new DesktopSession();
  private readonly dependencies: DesktopHostDependencies;
  private readonly persistence: DesktopPersistence;
  private readonly openRequests = new Map<string, Promise<DesktopOpenResult | null>>();
  private pdfExportRequest: Promise<PdfExportResult | null> | null = null;
  private commandServices: CommandServices | null = null;
  private pendingNewDocument: NativeOpenResult | null = null;
  private lastAgentReport: string | null | undefined;
  private readonly savedListeners = new Set<() => void>();

  constructor(dependencies: Partial<DesktopHostDependencies> = {}) {
    this.dependencies = { ...createDefaultDesktopHostDependencies(), ...dependencies };
    this.persistence = new DesktopPersistence(this.dependencies);
  }

  get activeSession() {
    return this.session.active;
  }

  /** 사람·에이전트 저장이 끝날 때마다(에이전트 변경 배지 초기화용). */
  onSaved(listener: () => void): () => void {
    this.savedListeners.add(listener);
    return () => this.savedListeners.delete(listener);
  }

  private notifySaved(): void {
    for (const listener of this.savedListeners) listener();
  }

  bindCommandServices(services: CommandServices): void {
    this.commandServices = services;
  }

  async openDocumentFromDialog(): Promise<DesktopOpenResult | null> {
    const path = await this.dependencies.chooseOpenPath();
    return path ? this.openDocumentByPath(path) : null;
  }

  openDocumentByPath(path: string): Promise<DesktopOpenResult | null> {
    const existing = this.openRequests.get(path);
    if (existing) return existing;
    const pending = this.openDocument(path).finally(() => {
      if (this.openRequests.get(path) === pending) this.openRequests.delete(path);
    });
    this.openRequests.set(path, pending);
    return pending;
  }

  async beginNewDocument(services: CommandServices): Promise<boolean> {
    if (!await this.confirmDocumentReplacement(services)) return false;
    await this.abortPendingNewDocument();
    this.pendingNewDocument = await this.invoke<NativeOpenResult>('create_document');
    services.eventBus.emit('create-new-document', { skipUnsavedGuard: true });
    return true;
  }

  completePendingDocumentInitialization(): void {
    const result = this.pendingNewDocument;
    if (!result) return;
    this.pendingNewDocument = null;
    const previousDocId = this.session.commitOpen(result);
    this.updateDocumentTitle();
    if (previousDocId) void this.closeNativeDocument(previousDocId);
  }

  markDocumentDirty(): void {
    const docId = this.session.markDirty();
    if (docId) {
      void this.invoke<void>('mark_document_dirty', { docId }).catch((error) => {
        console.warn('[desktop-host] native dirty state update failed:', error);
      });
    }
    this.updateDocumentTitle();
  }

  syncDocumentTitle(): void {
    this.updateDocumentTitle();
  }

  async confirmDocumentReplacement(services = this.commandServices): Promise<boolean> {
    if (!services) return true;
    const context = services.getContext();
    if (!context.hasDocument || !context.isDirty) return true;
    const fileName = this.session.active?.fileName ?? services.wasm.fileName ?? '현재 문서';
    const result = await this.dependencies.showMessage(
      `${fileName}의 변경 내용을 저장할까요?`,
      {
        title: '저장 확인',
        kind: 'warning',
        buttons: { yes: '저장', no: '저장 안 함', cancel: '취소' },
      },
    );
    if (result === '저장 안 함' || result === 'No') return true;
    if (result !== '저장' && result !== 'Yes') return false;
    return (await this.saveCurrent()) !== null;
  }

  async saveCurrent(
    format?: DesktopDocumentFormat,
    forceSaveAs = false,
  ): Promise<NativeDocumentState | null> {
    const active = this.session.active;
    if (!active) throw new Error('native 문서 세션이 없습니다');
    const services = this.requireCommandServices();
    const saved = await this.persistence.saveSource(
      active,
      (targetFormat) => exportDesktopSource(
        services,
        targetFormat,
        this.dependencies.chooseDocumentSavePassword,
      ),
      format,
      forceSaveAs,
    );
    if (!saved) return null;
    this.session.commitSave(saved.state);
    this.notifySaved();
    await saved.handlers.notifySaved(saved.state.fileName);
    services.wasm.requiresPasswordForSave = saved.passwordProtected;
    this.updateDocumentTitle();
    await this.showContentLossWarning(saved.contentLoss);
    return saved.state;
  }

  /**
   * 에이전트 저장(스펙 §8.4). 대화상자를 띄우지 않는다: 경로가 없으면 SAVE_PATH_REQUIRED,
   * 디스크 파일이 밖에서 바뀌었으면 force 없이는 FILE_CHANGED_ON_DISK, 내용 손실은 warnings 로.
   */
  async saveForAgent({ targetPath, force }: { targetPath?: string; force: boolean }): Promise<{
    state: NativeDocumentState;
    path: string;
    warnings: string[];
  }> {
    const active = this.session.active;
    if (!active) throw new Error('native 문서 세션이 없습니다');
    const path = targetPath ?? active.sourcePath;
    if (!path) {
      throw new AgentBridgeError('SAVE_PATH_REQUIRED', '저장한 적 없는 문서입니다. 저장 경로를 지정하세요.');
    }
    const format = formatFromPath(path);
    const changed = await this.persistence.isChangedOnDisk(active.docId, path);
    if (changed && !force) {
      throw new AgentBridgeError(
        'FILE_CHANGED_ON_DISK',
        `디스크의 파일이 hwply 밖에서 바뀌었습니다: ${path}. 덮어쓰려면 force 를 쓰세요.`,
      );
    }
    const services = this.requireCommandServices();
    const saved = await this.persistence.saveSourceTo(
      active,
      (targetFormat) => exportDesktopSource(services, targetFormat, async () => null),
      { targetPath: path, format, allowExternalOverwrite: force },
    );
    if (!saved) throw new AgentBridgeError('DOCUMENT_ENCRYPTED', '암호 문서는 에이전트가 저장할 수 없습니다.');
    this.session.commitSave(saved.state);
    this.notifySaved();
    await saved.handlers.notifySaved(saved.state.fileName);
    services.wasm.requiresPasswordForSave = saved.passwordProtected;
    this.updateDocumentTitle();
    const notice = saved.contentLoss ? buildContentLossNotice(saved.contentLoss) : null;
    return { state: saved.state, path, warnings: notice ? [notice] : [] };
  }

  /**
   * 왕복 교체(스펙 §8.4, 스파이크 S3). 같은 파일명으로 다시 올리고, Studio 와 세션 모두 dirty 로 둔다 —
   * 재적재는 Studio 를 clean 으로 초기화하는데 내용은 디스크와 다르다(창 닫기 확인이 Studio dirty 를 본다).
   */
  async reloadForAgent(bytes: Uint8Array): Promise<void> {
    const active = this.session.active;
    if (!active) throw new Error('native 문서 세션이 없습니다');
    const services = this.requireCommandServices();
    const handlers = await this.dependencies.handlers();
    await handlers.loadFile(bytes, active.fileName, true, true);
    syncDesktopPasswordRequirement(services);
    services.documentState.markDirty('agent-replace');
    this.markDocumentDirty();
  }

  exportCurrentPdf(): Promise<PdfExportResult | null> {
    if (this.pdfExportRequest) return this.pdfExportRequest;
    const active = this.session.active;
    const pending = this.persistence.exportPdf(
      active?.fileName ?? 'document.hwp',
      active?.sourcePath ?? null,
      active?.format ?? 'hwp',
    ).finally(() => {
      if (this.pdfExportRequest === pending) this.pdfExportRequest = null;
    });
    this.pdfExportRequest = pending;
    return pending;
  }

  async confirmWindowClose(): Promise<boolean> {
    if (!await this.confirmDocumentReplacement()) return false;
    await this.abortPendingNewDocument();
    const docId = this.session.release();
    if (docId) await this.closeNativeDocument(docId);
    this.updateDocumentTitle();
    return true;
  }

  takePendingOpenPaths(): Promise<string[]> {
    return this.invoke<string[]>('take_pending_open_paths');
  }

  createNewWindow(): Promise<string> {
    return this.invoke<string>('create_editor_window');
  }

  destroyCurrentWindow(): Promise<void> {
    return this.invoke<void>('destroy_current_window');
  }

  private async openDocument(path: string): Promise<DesktopOpenResult | null> {
    await this.abortPendingNewDocument();
    await this.invoke<void>('prepare_document_open', { path });
    const { bytes, sourceFingerprint } = await this.dependencies.readDocument(path);
    const result = await this.invoke<NativeOpenResult>('open_document_tracking', {
      path,
      sourceFingerprint,
    });
    try {
      const handlers = await this.dependencies.handlers();
      const loaded = await handlers.loadFile(bytes, result.fileName, false, false);
      if (this.commandServices) syncDesktopPasswordRequirement(this.commandServices);
      const previousDocId = this.session.commitOpen(result);
      await this.invoke<void>('record_recent_document', { path }).catch((error) => {
        console.warn('[desktop-host] recent document update failed:', error);
      });
      if (previousDocId) await this.closeNativeDocument(previousDocId);
      this.updateDocumentTitle();
      return { fileName: result.fileName, pageCount: loaded.pageCount };
    } catch (error) {
      await this.closeNativeDocument(result.docId);
      throw error;
    }
  }

  private async abortPendingNewDocument(): Promise<void> {
    const pending = this.pendingNewDocument;
    this.pendingNewDocument = null;
    if (pending) await this.closeNativeDocument(pending.docId);
  }

  private async closeNativeDocument(docId: string): Promise<void> {
    await this.invoke<void>('close_document', { docId }).catch((error) => {
      console.warn('[desktop-host] native document cleanup failed:', error);
    });
  }

  private async invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
    return this.dependencies.invoke(command, args) as Promise<T>;
  }

  private requireCommandServices(): CommandServices {
    if (!this.commandServices) throw new Error('Studio command services가 준비되지 않았습니다');
    return this.commandServices;
  }

  private async showContentLossWarning(report: ContentLossReport | null) {
    if (!report) return;
    const notice = buildContentLossNotice(report);
    if (!notice) return;
    await this.dependencies.showMessage(notice, {
      title: '문서 저장 경고',
      kind: 'warning',
    }).catch((error) => {
      console.warn('[desktop-host] 내용 손실 경고 표시 실패:', error);
    });
  }

  private updateDocumentTitle(): void {
    if (typeof document === 'undefined') return;
    const active = this.session.active;
    const title = active ? formatWindowTitle(active.fileName, active.dirty) : PRODUCT_NAME;
    document.title = title;
    void this.dependencies.setWindowTitle(title).catch((error) => {
      console.warn('[desktop-host] native window title update failed:', error);
    });
    this.reportAgentDocument();
  }

  /** 세션이 바뀔 때마다 부른다. 같은 내용이면 다시 보내지 않는다. */
  private reportAgentDocument(): void {
    const active = this.session.active;
    const report: AgentDocumentReport | null = active
      ? {
        docId: active.docId,
        fileName: active.fileName,
        sourcePath: active.sourcePath,
        format: active.format,
        encrypted: this.commandServices?.wasm.requiresPasswordForSave ?? false,
      }
      : null;
    const key = report ? JSON.stringify(report) : null;
    if (key === this.lastAgentReport) return;
    this.lastAgentReport = key;
    void this.dependencies.reportAgentDocument(report).catch((error) => {
      console.warn('[desktop-host] agent bridge report failed:', error);
    });
  }
}

function formatFromPath(path: string): DesktopDocumentFormat {
  const match = /\.(hwp|hwpx)$/i.exec(path);
  if (!match) throw new AgentBridgeError('BAD_REQUEST', `hwp 또는 hwpx 경로여야 합니다: ${path}`);
  return match[1].toLowerCase() as DesktopDocumentFormat;
}

let desktopHost = new DesktopHost();

export function getDesktopHost(): DesktopHost {
  return desktopHost;
}

export function setDesktopHostForTests(host: DesktopHost): void {
  desktopHost = host;
}
