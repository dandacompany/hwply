import type { AgentActivityEvent } from '../agent/agent-adapter';

/** 토스트가 떠 있는 시간. */
export const AGENT_TOAST_MS = 8_000;

/**
 * 에이전트 변경 표시(스펙 §7): 창 오른쪽 위 배지("에이전트 변경 N")와 토스트.
 * 승인 창은 없다. 왕복 교체는 토스트·배지에서 직전 스냅샷으로 되돌린다.
 */
export class AgentActivity {
  private count = 0;
  private roundtrips = 0;
  private badge: HTMLButtonElement | null = null;
  private toast: HTMLElement | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly onRestoreLatest: () => Promise<void>,
    private readonly platform: 'macos' | 'windows' | 'other' = 'macos',
  ) {}

  record(event: AgentActivityEvent): void {
    this.count += 1;
    if (event.kind === 'roundtrip') this.roundtrips += 1;
    this.renderBadge();
    this.showToast(event);
  }

  resetCount(): void {
    this.count = 0;
    this.roundtrips = 0;
    this.badge?.remove();
    this.badge = null;
  }

  private renderBadge(): void {
    if (!this.badge) {
      this.badge = this.root.ownerDocument.createElement('button');
      this.badge.type = 'button';
      this.badge.className = 'hwply-agent-badge';
      this.badge.addEventListener('click', () => {
        if (this.roundtrips > 0) void this.restore();
      });
      this.root.append(this.badge);
    }
    this.badge.textContent = `에이전트 변경 ${this.count}`;
    this.badge.title = this.roundtrips > 0 ? '눌러서 에이전트 변경 전으로 되돌리기' : '';
  }

  private showToast(event: AgentActivityEvent): void {
    this.hideToast();
    const doc = this.root.ownerDocument;
    const toast = doc.createElement('div');
    toast.className = 'hwply-agent-toast';
    toast.setAttribute('role', 'status');
    if (event.kind === 'roundtrip') {
      toast.append('에이전트가 문서를 바꿨습니다');
      const button = doc.createElement('button');
      button.type = 'button';
      button.textContent = '되돌리기';
      button.addEventListener('click', () => {
        button.disabled = true;
        this.hideToast();
        void this.restore();
      }, { once: true });
      toast.append(button);
    } else {
      const undoKey = this.platform === 'macos' ? '⌘Z' : 'Ctrl+Z';
      toast.textContent = `에이전트가 문단을 고쳤습니다 — ${undoKey} 로 되돌릴 수 있습니다`;
    }
    this.root.append(toast);
    this.toast = toast;
    this.toastTimer = setTimeout(() => this.hideToast(), AGENT_TOAST_MS);
  }

  private hideToast(): void {
    clearTimeout(this.toastTimer);
    this.toast?.remove();
    this.toast = null;
  }

  private async restore(): Promise<void> {
    await this.onRestoreLatest();
  }
}
