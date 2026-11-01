import { invoke } from '@tauri-apps/api/core';
import { ModalDialog } from '@upstream/ui/dialog';

/** `hwply setup --json` 의 결과 모양(apps/cli/src/setup). */
export interface SetupAction {
  kind: string;
  dest: string;
  status: 'planned' | 'done' | 'skipped' | 'failed';
  target?: string;
  reason?: string;
}

export interface SetupHarness {
  id: string;
  label: string;
  root: string;
  dest: string;
  exists: boolean;
  installedVersion?: string;
}

export interface SetupPlan {
  actions: SetupAction[];
  harnesses: SetupHarness[];
  pathHint?: string;
}

/** Rust `setup_commands::SetupStatus`. */
export interface SetupStatus {
  cliAvailable: boolean;
  firstRun: boolean;
  suggestRefresh: boolean;
  plan: SetupPlan | null;
}

const PATH_KINDS = new Set(['link', 'copy', 'user-path']);

export function shouldAutoShow(status: SetupStatus): boolean {
  return status.cliAvailable && (status.firstRun || status.suggestRefresh);
}

/** 앱 시작 때 main 창에서만 한 번 확인한다(창마다 뜨지 않게). */
export async function maybeShowAgentSetupOnStartup(windowLabel: string): Promise<void> {
  if (windowLabel !== 'main') return;
  const status = await invoke<SetupStatus>('setup_status');
  if (shouldAutoShow(status)) await showAgentSetupDialog(status);
}

/** 앱 시작 때 부른다. 실패해도 편집기는 계속 쓴다. */
export async function installAgentSetupPrompt(): Promise<void> {
  try {
    const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    await maybeShowAgentSetupOnStartup(getCurrentWebviewWindow().label);
  } catch (error) {
    console.error('[agent-setup] 설정 확인 실패:', error);
  }
}

let active: AgentSetupDialog | null = null;

export async function showAgentSetupDialog(status?: SetupStatus): Promise<void> {
  const current = status ?? await invoke<SetupStatus>('setup_status');
  active?.hide();
  active = new AgentSetupDialog(current);
  active.afterClose = () => {
    active = null;
  };
  active.show();
}

const STATUS_MARK: Record<SetupAction['status'], string> = {
  planned: '·',
  done: '완료',
  skipped: '건너뜀',
  failed: '실패',
};

class AgentSetupDialog extends ModalDialog {
  private content!: HTMLDivElement;

  constructor(private readonly status: SetupStatus) {
    super('에이전트 연결 설정', 520);
  }

  protected createBody(): HTMLElement {
    this.content = document.createElement('div');
    this.content.className = 'agent-setup-content';
    this.renderForm();
    return this.content;
  }

  protected onConfirm(): void {}

  override show(): void {
    super.show();
    this.dialog.classList.add('agent-setup-dialog');
    this.setFooter([
      this.button('설정', true, () => void this.apply()),
      this.button('나중에', false, () => void this.later()),
    ]);
  }

  private home(): string {
    const root = this.status.plan?.harnesses[0]?.root ?? '';
    return root.replace(/[\\/][^\\/]+$/, '');
  }

  private tilde(path: string): string {
    const home = this.home();
    return home && path.startsWith(home) ? `~${path.slice(home.length)}` : path;
  }

  private renderForm(): void {
    const plan = this.status.plan;
    this.content.replaceChildren();
    const intro = document.createElement('p');
    intro.textContent = '터미널의 AI 에이전트가 hwply 에 열린 문서를 다룰 수 있게 준비합니다.';
    this.content.appendChild(intro);

    const pathDest = plan?.actions.find((a) => PATH_KINDS.has(a.kind))?.dest ?? '';
    const pathDir = pathDest.replace(/[\\/](hwply|rhwp)(\.exe)?$/, '');
    this.content.appendChild(
      this.option('path', true, '터미널에서 hwply·rhwp 명령 쓰기', pathDir ? `${this.tilde(pathDir)} 에 연결` : ''),
    );
    for (const h of plan?.harnesses ?? []) {
      const installed = h.installedVersion ? ` — 설치됨 ${h.installedVersion}` : '';
      this.content.appendChild(
        this.option(`skill-${h.id}`, h.exists, `${h.label} skill`, `${this.tilde(h.dest)}${installed}`),
      );
    }
    this.content.appendChild(this.note());
  }

  private option(name: string, checked: boolean, label: string, detail: string): HTMLElement {
    const row = document.createElement('label');
    row.className = 'agent-setup-option';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = name;
    input.checked = checked;
    const text = document.createElement('span');
    text.textContent = label;
    row.append(input, text);
    if (detail) {
      const small = document.createElement('small');
      small.textContent = detail;
      row.appendChild(small);
    }
    return row;
  }

  private note(): HTMLElement {
    const note = document.createElement('p');
    note.className = 'agent-setup-note';
    note.textContent = '언제든 터미널에서 hwply setup 으로 다시 할 수 있습니다.';
    return note;
  }

  private selection(): { path: boolean; skills: string[] } {
    const checked = (name: string) =>
      this.content.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.checked ?? false;
    return {
      path: checked('path'),
      skills: (this.status.plan?.harnesses ?? []).filter((h) => checked(`skill-${h.id}`)).map((h) => h.id),
    };
  }

  private async apply(): Promise<void> {
    try {
      const result = await invoke<SetupPlan>('setup_apply', this.selection());
      this.renderResult(result);
    } catch (error) {
      this.renderResult(null, String(error));
    }
  }

  private async later(): Promise<void> {
    try {
      await invoke('setup_dismiss');
    } finally {
      this.hide();
    }
  }

  private renderResult(result: SetupPlan | null, error?: string): void {
    this.content.replaceChildren();
    const list = document.createElement('ul');
    list.className = 'agent-setup-result';
    for (const a of result?.actions ?? []) {
      const item = document.createElement('li');
      item.dataset.status = a.status;
      item.textContent = `${STATUS_MARK[a.status]}  ${this.tilde(a.dest)}${a.reason ? ` — ${a.reason}` : ''}`;
      list.appendChild(item);
    }
    if (result && result.actions.length === 0) {
      const item = document.createElement('li');
      item.textContent = '바꾼 것이 없습니다.';
      list.appendChild(item);
    }
    this.content.appendChild(list);
    if (error) {
      const p = document.createElement('p');
      p.className = 'agent-setup-error';
      p.textContent = `설정하지 못했습니다: ${error}`;
      this.content.appendChild(p);
    }
    if (result?.pathHint) {
      const hint = document.createElement('pre');
      hint.className = 'agent-setup-hint';
      hint.textContent = result.pathHint;
      this.content.appendChild(hint);
      const copy = this.button('안내 복사', false, () => void navigator.clipboard?.writeText(result.pathHint ?? ''));
      this.content.appendChild(copy);
    }
    this.content.appendChild(this.note());
    this.setFooter([this.button('닫기', true, () => this.hide())]);
  }

  private button(text: string, primary: boolean, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = primary ? 'dialog-btn dialog-btn-primary' : 'dialog-btn';
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }

  private setFooter(buttons: HTMLButtonElement[]): void {
    this.dialog.querySelector('.dialog-footer')?.replaceChildren(...buttons);
  }
}
