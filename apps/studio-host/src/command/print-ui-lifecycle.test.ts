import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { preparePrintUiReturnWaiter } from './print-ui-lifecycle';

type NativeFocusListener = (event: { payload: boolean }) => void;

const nativeWindow = vi.hoisted(() => ({
  isFocused: vi.fn<() => Promise<boolean>>(() => Promise.resolve(true)),
  onFocusChanged: vi.fn<(
    listener: NativeFocusListener,
  ) => Promise<() => void>>(() => Promise.resolve(vi.fn())),
}));

vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => nativeWindow }));

describe('Windows system print focus lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { document?: unknown }).document;
  });

  it('ignores pre-return focus and waits through the print-to-save transition', async () => {
    let focused = true;
    const listeners = new Set<NativeFocusListener>();
    nativeWindow.isFocused.mockImplementation(() => Promise.resolve(focused));
    nativeWindow.onFocusChanged.mockImplementation((listener) => {
      listeners.add(listener);
      return Promise.resolve(() => listeners.delete(listener));
    });
    const waiter = await preparePrintUiReturnWaiter('windows');

    emitFocus(listeners, false);
    emitFocus(listeners, true);
    const result = waiter.waitForReturn();
    let settled = false;
    void result.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(500);

    focused = false;
    emitFocus(listeners, false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(settled).toBe(false);

    focused = true;
    emitFocus(listeners, true);
    await vi.advanceTimersByTimeAsync(999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toBe('native-focus-stable');
    waiter.dispose();
  });

  it('returns after one second of stable focus when no driver modal follows', async () => {
    nativeWindow.isFocused.mockResolvedValue(true);
    nativeWindow.onFocusChanged.mockResolvedValue(vi.fn());
    const waiter = await preparePrintUiReturnWaiter('windows');
    const result = waiter.waitForReturn();

    await vi.advanceTimersByTimeAsync(999);
    let settled = false;
    void result.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe('native-focus-stable');
    waiter.dispose();
  });

  it('ignores a stale initial poll after a newer focus event', async () => {
    let resolveInitialFocus: (focused: boolean) => void = () => {};
    const initialFocus = new Promise<boolean>((resolve) => {
      resolveInitialFocus = resolve;
    });
    const listeners = new Set<NativeFocusListener>();
    nativeWindow.isFocused
      .mockImplementationOnce(() => initialFocus)
      .mockResolvedValue(true);
    nativeWindow.onFocusChanged.mockImplementation((listener) => {
      listeners.add(listener);
      return Promise.resolve(() => listeners.delete(listener));
    });
    const waiter = await preparePrintUiReturnWaiter('windows');
    const result = waiter.waitForReturn();

    emitFocus(listeners, true);
    resolveInitialFocus(false);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);

    await expect(result).resolves.toBe('native-focus-stable');
    waiter.dispose();
  });

  it('uses the five-minute watchdog without completing the modal lifecycle', async () => {
    let focused = false;
    const listeners = new Set<NativeFocusListener>();
    nativeWindow.isFocused.mockImplementation(() => Promise.resolve(focused));
    nativeWindow.onFocusChanged.mockImplementation((listener) => {
      listeners.add(listener);
      return Promise.resolve(() => listeners.delete(listener));
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const waiter = await preparePrintUiReturnWaiter('windows');
    const result = waiter.waitForReturn();
    let settled = false;
    void result.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(settled).toBe(false);
    expect(nativeWindow.isFocused).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      '[file:print] system print UI가 5분 넘게 열려 있어 focus 상태를 다시 확인합니다.',
    );

    focused = true;
    emitFocus(listeners, true);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(result).resolves.toBe('native-focus-stable');
    waiter.dispose();
    warn.mockRestore();
  });

  it('keeps the DOM fallback pending after five minutes', async () => {
    let domFocused = false;
    const focusListeners = new Set<() => void>();
    (globalThis as { window?: unknown }).window = {
      addEventListener: (type: string, listener: () => void) => {
        if (type === 'focus') focusListeners.add(listener);
      },
      removeEventListener: (type: string, listener: () => void) => {
        if (type === 'focus') focusListeners.delete(listener);
      },
    };
    (globalThis as { document?: unknown }).document = {
      hasFocus: () => domFocused,
    };
    nativeWindow.onFocusChanged.mockRejectedValue(new Error('native focus unavailable'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const waiter = await preparePrintUiReturnWaiter('windows');
    const result = waiter.waitForReturn();
    let settled = false;
    void result.then(() => { settled = true; });

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(settled).toBe(false);

    domFocused = true;
    for (const listener of [...focusListeners]) listener();
    await expect(result).resolves.toBe('dom-focus');
    waiter.dispose();
    warn.mockRestore();
  });

  it('does not create a stability timer from a late poll after disposal', async () => {
    let resolveFocus: (focused: boolean) => void = () => {};
    nativeWindow.isFocused.mockImplementation(() => new Promise<boolean>((resolve) => {
      resolveFocus = resolve;
    }));
    nativeWindow.onFocusChanged.mockResolvedValue(vi.fn());
    const waiter = await preparePrintUiReturnWaiter('windows');
    void waiter.waitForReturn();

    waiter.dispose();
    resolveFocus(true);
    await Promise.resolve();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('falls back to DOM focus when native listener setup fails', async () => {
    let domFocused = false;
    const focusListeners = new Set<() => void>();
    const fakeWindow = {
      addEventListener: vi.fn((type: string, listener: () => void) => {
        if (type === 'focus') focusListeners.add(listener);
      }),
      removeEventListener: vi.fn((type: string, listener: () => void) => {
        if (type === 'focus') focusListeners.delete(listener);
      }),
    };
    (globalThis as { window?: unknown }).window = fakeWindow;
    (globalThis as { document?: unknown }).document = {
      hasFocus: () => domFocused,
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    nativeWindow.onFocusChanged.mockRejectedValue(new Error('native focus unavailable'));
    const waiter = await preparePrintUiReturnWaiter('windows');
    const result = waiter.waitForReturn();

    domFocused = true;
    for (const listener of [...focusListeners]) listener();

    await expect(result).resolves.toBe('dom-focus');
    waiter.dispose();
    expect(fakeWindow.removeEventListener).toHaveBeenCalledWith('focus', expect.any(Function));
    expect(warn).toHaveBeenCalledWith(
      '[file:print] native window focus 감시를 시작하지 못했습니다.',
      expect.any(Error),
    );
    warn.mockRestore();
  });
});

function emitFocus(listeners: Set<NativeFocusListener>, focused: boolean): void {
  for (const listener of [...listeners]) listener({ payload: focused });
}
