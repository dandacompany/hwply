import { AboutDialog as UpstreamAboutDialog } from '@upstream/ui/about-dialog';
import { isTauriRuntime } from '../core/platform';
import { showAgentSetupDialog } from './agent-setup-dialog';
import { showUpdateDialog } from './update-dialog';

/** 한컴 상표 고지. README·앱 정보 화면에 원문 그대로 들어간다 (설계 §4). */
export const HANCOM_NOTICES = [
  '본 제품은 한글과컴퓨터의 한글 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.',
  '"한글", "한컴", "HWP", "HWPX"는 주식회사 한글과컴퓨터의 등록 상표이며, 본 프로젝트는 한글과컴퓨터와 제휴·후원·승인 관계가 없습니다.',
] as const;

export interface AboutDialogContent {
  productName: 'hwply';
  version: string;
  rhwpVersion: string;
  rhwpCommit: string;
  notices: readonly string[];
}

export function aboutDialogContent(): AboutDialogContent {
  return {
    productName: 'hwply',
    version: __HWPLY_VERSION__,
    rhwpVersion: __HWPLY_RHWP_TAG__.replace(/^v/, ''),
    rhwpCommit: __HWPLY_RHWP_COMMIT__,
    notices: HANCOM_NOTICES,
  };
}

export class AboutDialog extends UpstreamAboutDialog {
  protected override createBody(): HTMLElement {
    const body = super.createBody();
    const version = body.querySelector('.about-version');
    const content = aboutDialogContent();

    const hwplyVersion = document.createElement('div');
    hwplyVersion.className = 'about-hwply-version';
    hwplyVersion.textContent = `${content.productName} ${content.version}`;

    const engine = document.createElement('div');
    engine.className = 'about-hwply-engine';
    engine.textContent = `rhwp v${content.rhwpVersion} (${content.rhwpCommit.slice(0, 8)})`;

    const notices = document.createElement('div');
    notices.className = 'about-hwply-notices';
    for (const text of content.notices) {
      const p = document.createElement('p');
      p.textContent = text;
      notices.appendChild(p);
    }

    if (version?.parentNode) {
      version.parentNode.insertBefore(hwplyVersion, version.nextSibling);
    } else {
      body.appendChild(hwplyVersion);
    }
    hwplyVersion.insertAdjacentElement('afterend', engine);
    body.appendChild(notices);

    if (isTauriRuntime()) {
      const updateButton = document.createElement('button');
      updateButton.className = 'dialog-btn about-update-button';
      updateButton.textContent = '업데이트 확인…';
      updateButton.addEventListener('click', () => {
        void showUpdateDialog().catch((error) => {
          console.error('[desktop-updater] dialog failed:', error);
        });
      });
      engine.insertAdjacentElement('afterend', updateButton);

      const setupButton = document.createElement('button');
      setupButton.className = 'dialog-btn about-agent-setup-button';
      setupButton.textContent = '에이전트 연결 설정…';
      setupButton.addEventListener('click', () => {
        void showAgentSetupDialog().catch((error) => {
          console.error('[agent-setup] dialog failed:', error);
        });
      });
      updateButton.insertAdjacentElement('afterend', setupButton);
    }
    return body;
  }
}
