import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FontPreferences } from './local-font-preferences';

const invoke = vi.hoisted(() => vi.fn());
const showSettings = vi.hoisted(() => vi.fn());
const closeSettings = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@upstream/ui/toast', () => ({ showToast: toast }));
vi.mock('../ui/desktop-local-font-settings', async (original) => ({
  ...await original<typeof import('../ui/desktop-local-font-settings')>(),
  showDesktopLocalFontSettings: showSettings,
  closeDesktopLocalFontSettings: closeSettings,
}));

const initial: FontPreferences = { choice: 'unset', persisted: false, revision: 0, promptDismissed: false, error: null };
const font = { family: 'Controller Test', postScriptName: 'ControllerTest', style: 'normal', sourceKind: 'system-installed' };
let native: FontPreferences;
const status = { textContent: '' };
const document = () => ({ fonts: [font.family], refreshView: vi.fn(async () => {}), onFontsChanged: vi.fn() });

describe('desktop local-font controller', () => {
  beforeEach(() => {
    vi.resetModules(); vi.clearAllMocks(); native = { ...initial }; status.textContent = '';
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    vi.stubGlobal('document', { getElementById: () => status });
    invoke.mockImplementation(async (command, args) => {
      if (command === 'get_local_font_preferences') return { ...native };
      if (command === 'list_local_fonts') return [font];
      if (command === 'set_local_font_preferences') {
        native = args.action === 'dismiss'
          ? { ...native, promptDismissed: true, revision: native.revision + 1 }
          : { ...native, choice: args.action, persisted: true, revision: native.revision + 1 };
        return { ...native };
      }
      throw new Error('unexpected IPC');
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('prompts once, persists the choice, and reuses it for different documents', async () => {
    showSettings.mockResolvedValue('enabled');
    const controller = await import('./local-font-controller');
    const first = document();
    await controller.prepareDesktopDocumentFonts(first);
    expect(invoke).not.toHaveBeenCalledWith('list_local_fonts');
    expect(await controller.promptDesktopLocalFonts()).toBe(true);
    expect(native.choice).toBe('enabled');
    expect(first.refreshView).toHaveBeenCalled();
    expect(first.onFontsChanged).toHaveBeenCalledWith([font.family]);
    await controller.prepareDesktopDocumentFonts({ ...document(), fonts: ['Other Font'] });
    await controller.promptDesktopLocalFonts();
    expect(showSettings).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls.filter(([cmd]) => cmd === 'list_local_fonts')).toHaveLength(1);
    expect(toast.mock.calls[0][0].message).toContain('사용 설정이 저장되었습니다');
    expect(toast.mock.calls[0][0].message).not.toContain('감지 결과를 재사용');
  });

  it.each(['disabled', 'dismiss'])('respects %s on subsequent documents', async (action) => {
    showSettings.mockResolvedValue(action);
    const controller = await import('./local-font-controller');
    await controller.prepareDesktopDocumentFonts(document());
    await controller.promptDesktopLocalFonts();
    await controller.prepareDesktopDocumentFonts(document());
    await controller.promptDesktopLocalFonts();
    expect(showSettings).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalledWith('list_local_fonts');
    expect(native.persisted).toBe(action === 'disabled');
  });

  it('restores saved enabled state in a fresh JS context without prompting', async () => {
    native = { ...initial, choice: 'enabled', persisted: true, revision: 1 };
    const controller = await import('./local-font-controller');
    await controller.prepareDesktopDocumentFonts(document());
    await controller.promptDesktopLocalFonts();
    expect(showSettings).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith('list_local_fonts');
  });

  it('reports save failure accurately while applying only a temporary choice', async () => {
    showSettings.mockResolvedValue('enabled');
    const implementation = invoke.getMockImplementation()!;
    invoke.mockImplementation((command, args) => command === 'set_local_font_preferences'
      ? Promise.reject(new Error('private disk path')) : implementation(command, args));
    const controller = await import('./local-font-controller');
    await controller.prepareDesktopDocumentFonts(document());
    await controller.promptDesktopLocalFonts();
    expect(toast.mock.calls.at(-1)![0].message).toContain('이번 창에서만');
    expect(toast.mock.calls.at(-1)![0].message).not.toContain('private disk');
    const { getLocalFontState } = await import('./local-fonts');
    expect(getLocalFontState()).toMatchObject({ stored: false, count: 1 });
  });

  it('ignores a stale modal response after document replacement', async () => {
    let finish!: (value: string) => void;
    showSettings.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const controller = await import('./local-font-controller');
    await controller.prepareDesktopDocumentFonts(document());
    const prompt = controller.promptDesktopLocalFonts();
    await vi.waitFor(() => expect(showSettings).toHaveBeenCalled());
    await controller.prepareDesktopDocumentFonts(document());
    finish('enabled');
    await prompt;
    expect(invoke.mock.calls.some(([cmd]) => cmd === 'set_local_font_preferences')).toBe(false);
  });

  it('keeps the upstream prompt in a non-native browser', async () => {
    vi.stubGlobal('window', {});
    const controller = await import('./local-font-controller');
    expect(await controller.promptDesktopLocalFonts()).toBe(false);
    await controller.prepareDesktopDocumentFonts(document());
    expect(invoke).not.toHaveBeenCalled();
  });

  it('refreshes fallback after catalog failure and reports view failure without leaking paths', async () => {
    showSettings.mockResolvedValue('enabled');
    const implementation = invoke.getMockImplementation()!;
    invoke.mockImplementation((command, args) => command === 'list_local_fonts'
      ? Promise.reject(new Error('private/catalog')) : implementation(command, args));
    const controller = await import('./local-font-controller');
    const current = document();
    current.refreshView.mockRejectedValueOnce(new Error('private/render'));
    await controller.prepareDesktopDocumentFonts(current);
    await controller.promptDesktopLocalFonts();
    expect(current.onFontsChanged).toHaveBeenCalledWith([]);
    expect(current.refreshView).toHaveBeenCalled();
    expect(toast.mock.calls.at(-1)![0].message).toContain('화면을 갱신하지 못했습니다');
    expect(status.textContent).not.toContain('private/');
    await controller.refreshDesktopLocalFontView();
    expect(status.textContent).toContain('목록을 읽지 못했습니다');
  });

  it('invalidates an in-flight view callback when a different document starts', async () => {
    const controller = await import('./local-font-controller');
    let isCurrent!: () => boolean;
    let finish!: () => void;
    const first = { ...document(), refreshView: (check: () => boolean) => {
      isCurrent = check;
      return new Promise<void>(resolve => { finish = resolve; });
    } };
    await controller.prepareDesktopDocumentFonts(first);
    const refreshing = controller.refreshDesktopLocalFontView();
    await vi.waitFor(() => expect(isCurrent).toBeTypeOf('function'));
    expect(isCurrent()).toBe(true);
    await controller.prepareDesktopDocumentFonts(document());
    expect(isCurrent()).toBe(false);
    finish();
    await refreshing;
  });

});
