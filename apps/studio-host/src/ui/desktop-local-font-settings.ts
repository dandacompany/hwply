import { ModalDialog } from '@upstream/ui/dialog';
import type { FontAction, FontPreferences } from '../core/local-font-preferences';

export type FontSettingsAction = FontAction | 'refresh';
let activeDialog: ModalDialog | null = null;

export function fontSettingsMessage(
  preferences: FontPreferences, count: number, catalogError: string | null,
): string {
  if (preferences.error === 'save-failed') {
    return '설정을 저장하지 못했습니다. 이번 창에서만 선택을 적용합니다. 설정에서 다시 시도하세요.';
  }
  if (preferences.error) return '글꼴 사용 설정을 읽지 못했습니다. 대체 글꼴로 표시하며 설정에서 다시 선택할 수 있습니다.';
  if (catalogError) return '로컬 글꼴 목록을 읽지 못했습니다. 대체 글꼴로 표시하며 다시 감지할 수 있습니다.';
  if (preferences.choice === 'disabled') return '로컬 글꼴 감지·직접 공급을 사용하지 않습니다. 시스템의 글꼴 해석은 유지됩니다.';
  if (preferences.choice === 'enabled') {
    return `로컬 글꼴 사용 설정${preferences.persisted ? '이 저장되었습니다' : '을 이번 창에 적용했습니다'}. 감지 목록 ${count}개이며 실제 적용 범위는 글꼴과 표시 방식에 따라 다릅니다.`;
  }
  return '지원된 로컬 글꼴을 감지해 사용할 수 있습니다. 사용 여부만 이 기기에 저장하며 글꼴 파일은 저장하거나 전송하지 않습니다.';
}

class DesktopFontSettings extends ModalDialog {
  private enabled: HTMLInputElement | null = null;
  private result: FontSettingsAction = 'dismiss';

  constructor(
    private readonly preferences: FontPreferences,
    private readonly message: string,
    complete: (result: FontSettingsAction) => void,
  ) {
    super('로컬 글꼴 설정', 520);
    this.afterClose = () => complete(this.result);
  }

  protected createBody(): HTMLElement {
    const body = document.createElement('div');
    const description = document.createElement('p');
    description.textContent = this.message;
    body.appendChild(description);
    for (const [value, text] of [['enabled', '사용 (감지 허용)'], ['disabled', '사용 안 함 (대체 글꼴로 보기)']]) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'hwply-local-font-choice';
      input.value = value;
      input.checked = value === (this.preferences.choice === 'disabled' ? 'disabled' : 'enabled');
      label.appendChild(input);
      label.appendChild(document.createTextNode(text));
      body.appendChild(label);
      if (value === 'enabled') this.enabled = input;
    }
    if (this.preferences.choice === 'enabled') {
      const refresh = document.createElement('button');
      refresh.type = 'button';
      refresh.className = 'dialog-btn';
      refresh.textContent = '다시 감지';
      refresh.addEventListener('click', () => { this.result = 'refresh'; this.hide(); });
      body.appendChild(refresh);
    }
    return body;
  }

  protected onConfirm(): void {
    this.result = this.enabled?.checked ? 'enabled' : 'disabled';
  }
}

export function closeDesktopLocalFontSettings(): void {
  activeDialog?.hide();
  activeDialog = null;
}

export function showDesktopLocalFontSettings(
  preferences: FontPreferences, message: string,
): Promise<FontSettingsAction> {
  closeDesktopLocalFontSettings();
  return new Promise((resolve) => {
    const dialog = new DesktopFontSettings(preferences, message, (result) => {
      if (activeDialog === dialog) activeDialog = null;
      resolve(result);
    });
    activeDialog = dialog;
    dialog.show();
  });
}
