import { analyzeDocumentFonts } from '@upstream/core/document-font-status';
import { showToast } from '@upstream/ui/toast';
import {
  detectLocalFonts, ensureLocalFontsAvailable, getLocalFonts, getLocalFontState, loadStoredLocalFonts,
} from './local-fonts';
import {
  getFontPreferences, refreshFontPreferences, saveFontPreference,
} from './local-font-preferences';
import { resetDesktopFontProvider, desktopFontSupplyState } from './local-font-provider';
import { isTauriRuntime } from './platform';
import {
  closeDesktopLocalFontSettings, fontSettingsMessage, showDesktopLocalFontSettings,
} from '../ui/desktop-local-font-settings';

interface FontDocument {
  fonts: readonly string[];
  refreshView(isCurrent: () => boolean): Promise<void>;
  onFontsChanged(fonts: string[]): void;
}

let activeDocument: FontDocument | null = null;
let generation = 0;
let showing: Promise<void> | null = null;
let refreshQueue: Promise<void> = Promise.resolve();
let lastWarning: string | null = null;
let viewError: string | null = null;

function setMessage(toast = false): void {
  const state = getLocalFontState();
  const supply = desktopFontSupplyState();
  const message = viewError ?? (fontSettingsMessage(getFontPreferences(), state.count, state.lastError)
    + (supply.failed ? ` 직접 공급 실패 ${supply.failed}개는 대체 글꼴로 표시합니다.` : ''));
  const target = document.getElementById('sb-message');
  if (target) target.textContent = message;
  if (toast) showToast({ message, durationMs: 8000 });
}

export async function prepareDesktopDocumentFonts(document: FontDocument): Promise<void> {
  if (!isTauriRuntime()) return;
  const started = ++generation;
  activeDocument = null;
  viewError = null;
  closeDesktopLocalFontSettings();
  resetDesktopFontProvider();
  await refreshFontPreferences();
  await loadStoredLocalFonts();
  if (started !== generation) return;
  try { await ensureLocalFontsAvailable(document.fonts); } catch { /* Catalog state carries retry guidance. */ }
  if (started === generation) activeDocument = document;
}

export function refreshDesktopLocalFontView(force = false): Promise<void> {
  const started = generation;
  const document = activeDocument;
  const refresh = async () => {
    if (started !== generation) return;
    try {
      if (force) await detectLocalFonts({ force: true });
      else await loadStoredLocalFonts();
    } catch { /* Continue with the empty catalog so the view can fall back. */ }
    try {
      if (started !== generation || document !== activeDocument) return;
      try { await ensureLocalFontsAvailable(document?.fonts ?? []); } catch { /* Continue to fallback view. */ }
      if (started !== generation || document !== activeDocument) return;
      document?.onFontsChanged(getLocalFonts());
      await document?.refreshView(() => started === generation && document === activeDocument);
      if (started === generation) viewError = null;
    } catch {
      if (started === generation) viewError = '글꼴 설정은 처리했지만 화면을 갱신하지 못했습니다. 설정 메뉴에서 다시 감지하세요.';
    }
    if (started === generation) setMessage();
  };
  refreshQueue = refreshQueue.then(refresh, refresh);
  return refreshQueue;
}

async function showSettings(manual: boolean): Promise<void> {
  const started = generation;
  await refreshFontPreferences();
  if (started !== generation) return;
  const preferences = getFontPreferences();
  if (!manual) {
    const warning = getLocalFontState().lastError
      ?? (desktopFontSupplyState().failed ? 'font-supply-failed' : null);
    if (warning && warning !== lastWarning) setMessage(true);
    lastWarning = warning;
    if (preferences.choice !== 'unset' || preferences.promptDismissed || preferences.error) return;
    const report = analyzeDocumentFonts(activeDocument?.fonts);
    if (!report.shouldPromptLocalAccess) return;
  }
  const state = getLocalFontState();
  const action = await showDesktopLocalFontSettings(
    preferences, fontSettingsMessage(preferences, state.count, state.lastError),
  );
  if (started !== generation) return;
  if (action !== 'refresh') await saveFontPreference(action);
  await refreshDesktopLocalFontView(action === 'refresh' || action === 'enabled');
  if (action !== 'dismiss' || getFontPreferences().error) setMessage(true);
}

export function openDesktopLocalFontSettings(manual = true): Promise<void> {
  if (!isTauriRuntime()) return Promise.resolve();
  if (showing) return showing;
  const request = showSettings(manual).catch(() => {
    const target = document.getElementById('sb-message');
    if (target) target.textContent = '로컬 글꼴 설정을 처리하지 못했습니다. 설정 메뉴에서 다시 시도하세요.';
  });
  showing = request;
  void request.finally(() => { if (showing === request) showing = null; });
  return request;
}

export async function promptDesktopLocalFonts(): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  await openDesktopLocalFontSettings(false);
  return true;
}

export function disposeDesktopLocalFonts(): void {
  generation += 1;
  activeDocument = null;
  resetDesktopFontProvider();
  closeDesktopLocalFontSettings();
}
