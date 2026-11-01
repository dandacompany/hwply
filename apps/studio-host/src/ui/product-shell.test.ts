import { afterEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@upstream/i18n/index.ts';
import { setLocale } from '@upstream/i18n/core.ts';
import { applyProductAccessibleName, formatWindowTitle, installDocumentTitle } from './product-shell';

afterEach(() => { vi.unstubAllGlobals(); setLocale('ko'); });

function titleFixture() {
  let onModeChange = () => {};
  const modes = { matches: false, addEventListener: vi.fn((_name: string, listener: () => void) => {
    onModeChange = listener;
  }) };
  const matchMedia = vi.fn(() => modes);
  vi.stubGlobal('window', { location: { protocol: 'http:' }, matchMedia });
  vi.stubGlobal('document', { title: 'hwply' });
  const bridge = { fileName: '문서.hwp', loaded: false, hasLoadedDocument() { return this.loaded; },
    onFileNameChanged: undefined as ((fileName: string) => void) | undefined };
  return { bridge, modes, matchMedia, changeMode: () => onModeChange() };
}

function labelFixture(count = 1) {
  const node = { nodeType: 3, nodeValue: 'hwply 문서 편집기' };
  const label = { childNodes: [node], getAttribute: (key: string) =>
    key === 'data-i18n' ? 'ui.studioHeader.srLabel' : null,
  get textContent() { return node.nodeValue; }, set textContent(value: string) { node.nodeValue = value; } };
  const doc = { documentElement: { lang: '' }, querySelectorAll: () => Array(count).fill(label) };
  vi.stubGlobal('document', doc);
  return { label, root: doc as unknown as Document };
}

describe('product title ownership', () => {
  it('updates branded browser titles for idle, open, rename, and reset', () => {
    const { bridge } = titleFixture();
    installDocumentTitle(bridge);
    expect(document.title).toBe('hwply');
    bridge.loaded = true;
    bridge.onFileNameChanged?.(bridge.fileName);
    expect(document.title).toBe('문서.hwp — hwply');
    bridge.fileName = '바뀐 이름.hwpx';
    bridge.onFileNameChanged?.(bridge.fileName);
    expect(document.title).toBe('바뀐 이름.hwpx — hwply');
    bridge.loaded = false;
    bridge.onFileNameChanged?.('');
    expect(document.title).toBe('hwply');
  });

  it('preserves installed browser mode and mode-change events', () => {
    const { bridge, modes, changeMode } = titleFixture();
    bridge.loaded = true;
    installDocumentTitle(bridge);
    modes.matches = true;
    changeMode();
    expect(document.title).toBe('문서.hwp');
    modes.matches = false;
    changeMode();
    expect(document.title).toBe('문서.hwp — hwply');
    expect(modes.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it.each(['tauri:', 'http:'])('leaves native session and dirty title under %s to DesktopHost', (protocol) => {
    const { bridge, matchMedia } = titleFixture();
    vi.stubGlobal('window', { location: { protocol }, ...(protocol === 'http:' ? { __TAURI_INTERNALS__: {} } : {}), matchMedia });
    document.title = '● 문서.hwp — hwply';
    const nativeCallback = vi.fn();
    bridge.onFileNameChanged = nativeCallback;
    installDocumentTitle(bridge);
    expect(document.title).toBe('● 문서.hwp — hwply');
    expect(bridge.onFileNameChanged).toBe(nativeCallback);
    expect(matchMedia).not.toHaveBeenCalled();
  });
});

describe('product accessibility locale', () => {
  it.each([['ko', 'hwply 문서 편집기'], ['en', 'hwply document editor']] as const)
    ('follows actual upstream %s initialization and retains product text on repeated initialization', (locale, expected) => {
      const { label, root } = labelFixture();
      setLocale(locale);
      applyProductAccessibleName(initI18n(), root);
      expect(document.documentElement.lang).toBe(locale);
      expect(label.textContent).toBe(expected);
      initI18n();
      expect(label.textContent).toBe(expected);
      expect(label.getAttribute('data-i18n')).toBe('ui.studioHeader.srLabel');
    });

  it.each([0, 2])('refuses ambiguous or missing product label (%s) without writing', (count) => {
    const { label, root } = labelFixture(count);
    expect(() => applyProductAccessibleName('en', root)).toThrow('exactly once');
    expect(label.textContent).toBe('hwply 문서 편집기');
  });
});

describe('formatWindowTitle', () => {
  it('파일명 뒤에 — hwply', () => expect(formatWindowTitle('보고서.hwp', false)).toBe('보고서.hwp — hwply'));
  it('NFD 한글을 NFC 로', () => expect(formatWindowTitle('보고서.hwp'.normalize('NFD'), false)).toBe('보고서.hwp — hwply'));
  it('dirty 표시', () => expect(formatWindowTitle('보고서.hwp', true)).toBe('● 보고서.hwp — hwply'));
  it('새 문서', () => expect(formatWindowTitle(null, false)).toBe('새 문서 — hwply'));
});
