import { isTauriRuntime } from '../core/platform';

export const PRODUCT_NAME = 'hwply';

/** 창 제목: `<문서명> — hwply`, 미저장이면 앞에 `● `. 파일명은 NFC 로 정규화한다(macOS Finder 는 NFD 를 준다). */
export function formatWindowTitle(fileName: string | null, dirty: boolean): string {
  const name = fileName && fileName.length > 0 ? fileName.normalize('NFC') : '새 문서';
  return `${dirty ? '● ' : ''}${name} — ${PRODUCT_NAME}`;
}

interface TitleBridge {
  readonly fileName: string;
  hasLoadedDocument(): boolean;
  onFileNameChanged?: (fileName: string) => void;
}

export function installDocumentTitle(bridge: TitleBridge): void {
  // DesktopHost owns native session titles, including the dirty marker.
  if (isTauriRuntime()) return;
  const appModes = window.matchMedia(
    '(display-mode: standalone), (display-mode: minimal-ui), (display-mode: window-controls-overlay)',
  );
  const update = () => {
    document.title = bridge.hasLoadedDocument()
      ? (appModes.matches ? bridge.fileName : formatWindowTitle(bridge.fileName, false))
      : PRODUCT_NAME;
  };
  bridge.onFileNameChanged = update;
  appModes.addEventListener('change', update);
  update();
}

export function applyProductAccessibleName(locale: 'ko' | 'en', root: ParentNode = document): void {
  const labels = root.querySelectorAll<HTMLElement>('[data-i18n="ui.studioHeader.srLabel"]');
  if (labels.length !== 1) throw new Error('upstream product accessible label must exist exactly once');
  labels[0].textContent = locale === 'en' ? 'hwply document editor' : 'hwply 문서 편집기';
}
