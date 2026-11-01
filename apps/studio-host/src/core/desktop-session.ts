export type DesktopDocumentFormat = 'hwp' | 'hwpx';

export interface NativeDocumentState {
  docId: string;
  fileName: string;
  sourcePath?: string | null;
  format: DesktopDocumentFormat;
  revision: number;
  dirty: boolean;
  warnings: unknown[];
}

export interface ActiveDesktopSession {
  docId: string;
  fileName: string;
  sourcePath: string | null;
  format: DesktopDocumentFormat;
  revision: number;
  dirty: boolean;
  warnings: unknown[];
}

export class DesktopSession {
  private activeSession: ActiveDesktopSession | null = null;

  get active(): Readonly<ActiveDesktopSession> | null {
    return this.activeSession;
  }

  commitOpen(result: NativeDocumentState): string | null {
    const previousDocId = this.activeSession?.docId ?? null;
    this.activeSession = normalizeSession(result);
    return previousDocId === result.docId ? null : previousDocId;
  }

  commitSave(result: NativeDocumentState): void {
    if (this.activeSession && this.activeSession.docId !== result.docId) {
      throw new Error('저장 결과의 문서 세션이 현재 문서와 일치하지 않습니다');
    }
    this.activeSession = normalizeSession(result);
  }

  markDirty(): string | null {
    if (!this.activeSession || this.activeSession.dirty) return null;
    this.activeSession = { ...this.activeSession, dirty: true };
    return this.activeSession.docId;
  }

  release(): string | null {
    const docId = this.activeSession?.docId ?? null;
    this.activeSession = null;
    return docId;
  }
}

function normalizeSession(result: NativeDocumentState): ActiveDesktopSession {
  return {
    docId: result.docId,
    fileName: result.fileName || fileNameFromPath(result.sourcePath) || 'document.hwp',
    sourcePath: result.sourcePath ?? null,
    format: result.format,
    revision: result.revision,
    dirty: result.dirty,
    warnings: [...result.warnings],
  };
}

function fileNameFromPath(path: string | null | undefined): string | null {
  return path?.split(/[\\/]/).pop() || null;
}
