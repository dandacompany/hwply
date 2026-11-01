import { ModalDialog } from '@upstream/ui/dialog';
import {
  ensureDesktopUpdater,
  getDesktopUpdaterController,
  invokeUpdaterButton,
  shouldOfferManualDownloads,
  updaterStatusMessage,
  type DesktopUpdaterController,
  type UpdaterSnapshot,
} from '../core/desktop-updater';

let activeDialog: UpdateDialog | null = null;

export async function showUpdateDialog(): Promise<void> {
  const controller = getDesktopUpdaterController()
    ?? await ensureDesktopUpdater(setStatusBarMessage);
  if (!controller) return;
  activeDialog?.hide();
  activeDialog = new UpdateDialog(controller);
  activeDialog.afterClose = () => {
    activeDialog = null;
  };
  activeDialog.show();
}

class UpdateDialog extends ModalDialog {
  private content!: HTMLDivElement;
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly controller: DesktopUpdaterController) {
    super('hwply 업데이트', 500);
  }

  protected createBody(): HTMLElement {
    this.content = document.createElement('div');
    this.content.className = 'updater-dialog-content';
    this.render(this.controller.current());
    return this.content;
  }

  protected onConfirm(): void {}

  override show(): void {
    super.show();
    this.dialog.classList.add('updater-dialog');
    this.replaceFooter();
    this.unsubscribe = this.controller.subscribe((snapshot) => this.render(snapshot));
  }

  override hide(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    super.hide();
  }

  private render(snapshot: UpdaterSnapshot | null, actionError?: string): void {
    this.content.replaceChildren();
    const status = document.createElement('p');
    status.className = 'updater-dialog-status';
    status.textContent = snapshot
      ? updaterStatusMessage(snapshot)
      : '업데이트 상태를 불러오고 있습니다…';
    this.content.appendChild(status);

    if (snapshot?.releaseNotes) {
      const notes = document.createElement('p');
      notes.className = 'updater-dialog-notes';
      notes.textContent = snapshot.releaseNotes;
      this.content.appendChild(notes);
    }
    if (snapshot?.progress?.percent !== null && snapshot?.progress?.percent !== undefined) {
      const progress = document.createElement('progress');
      progress.className = 'updater-dialog-progress';
      progress.max = 100;
      progress.value = snapshot.progress.percent;
      progress.setAttribute('aria-label', '업데이트 다운로드 진행률');
      this.content.appendChild(progress);
    }
    if (actionError) {
      const error = document.createElement('p');
      error.className = 'updater-dialog-error';
      error.textContent = actionError;
      this.content.appendChild(error);
    }

    const action = createAction(snapshot);
    if (action) {
      action.addEventListener('click', (event) => {
        void this.runAction(event.currentTarget);
      });
      this.content.appendChild(action);
    }
    if (shouldOfferManualDownloads(snapshot, actionError)) {
      const fallback = document.createElement('button');
      fallback.type = 'button';
      fallback.className = 'dialog-btn updater-dialog-downloads-link';
      fallback.dataset.updaterAction = 'manualDownloads';
      fallback.textContent = '다운로드 페이지 열기';
      fallback.addEventListener('click', (event) => {
        void this.runAction(event.currentTarget);
      });
      this.content.appendChild(fallback);
    }
  }

  private async runAction(target: EventTarget | null): Promise<void> {
    try {
      await invokeUpdaterButton(target, this.controller);
    } catch (error) {
      this.render(this.controller.current(), `업데이트 작업 실패: ${error}`);
    }
  }

  private replaceFooter(): void {
    const footer = this.dialog.querySelector('.dialog-footer');
    if (!footer) return;
    const close = document.createElement('button');
    close.className = 'dialog-btn dialog-btn-primary';
    close.textContent = '닫기';
    close.addEventListener('click', () => this.hide());
    footer.replaceChildren(close);
  }
}

function createAction(snapshot: UpdaterSnapshot | null): HTMLButtonElement | null {
  if (!snapshot) return null;
  const button = document.createElement('button');
  button.className = 'dialog-btn dialog-btn-primary updater-dialog-action';
  if (snapshot.status === 'available' && !snapshot.blocker) {
    button.dataset.updaterAction = 'apply';
    button.textContent = '다운로드 및 설치';
    return button;
  }
  if (snapshot.status === 'restartRequired') {
    button.dataset.updaterAction = 'restart';
    button.textContent = '앱 다시 시작';
    return button;
  }
  if (
    (snapshot.status === 'idle' && !snapshot.blocker)
    || (snapshot.status === 'error' && snapshot.failure?.retryable)
    || snapshot.blocker === 'dirtyDocuments'
  ) {
    button.dataset.updaterAction = snapshot.blocker === 'dirtyDocuments' ? 'apply' : 'check';
    button.textContent = snapshot.blocker === 'dirtyDocuments' ? '저장 후 다시 시도' : '다시 확인';
    return button;
  }
  return null;
}

function setStatusBarMessage(message: string): void {
  const status = document.getElementById('sb-message');
  if (status) status.textContent = message;
}
