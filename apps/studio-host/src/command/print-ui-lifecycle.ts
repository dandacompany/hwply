import { getCurrentWindow, type Window as TauriWindow } from '@tauri-apps/api/window';
import type { DesktopPlatform } from '../core/platform';

const PRINT_UI_FOCUS_WATCHDOG_MS = 5 * 60 * 1000;
const NATIVE_FOCUS_STABILITY_MS = 1000;

export type PrintUiReturnReason =
  | 'native-focus-stable'
  | 'dom-focus'
  | 'dom-already-focused'
  | 'unsupported';

export interface PrintUiReturnWaiter {
  waitForReturn(): Promise<PrintUiReturnReason>;
  dispose(): void;
}

type NativeFocusWindow = Pick<TauriWindow, 'isFocused' | 'onFocusChanged'>;

export async function preparePrintUiReturnWaiter(
  platform: DesktopPlatform,
): Promise<PrintUiReturnWaiter> {
  if (platform === 'windows') {
    try {
      return await prepareNativeFocusWaiter(getCurrentWindow());
    } catch (error) {
      console.warn('[file:print] native window focus 감시를 시작하지 못했습니다.', error);
    }
  }
  return prepareDomFocusWaiter();
}

async function prepareNativeFocusWaiter(
  nativeWindow: NativeFocusWindow,
): Promise<PrintUiReturnWaiter> {
  let waitStarted = false;
  let focusEventGeneration = 0;
  const deferred = createDeferredResult();
  const stability = createNativeFocusStability(
    nativeWindow,
    deferred,
    () => focusEventGeneration,
  );
  const unlisten = await nativeWindow.onFocusChanged(({ payload: focused }) => {
    if (!waitStarted) return;
    focusEventGeneration += 1;
    stability.observe(focused, focusEventGeneration);
  });
  const observeCurrentFocus = async () => {
    const sampledGeneration = focusEventGeneration;
    try {
      const focused = await nativeWindow.isFocused();
      if (sampledGeneration === focusEventGeneration) {
        stability.observe(focused, sampledGeneration);
      }
    } catch (error) {
      console.warn('[file:print] native window focus 상태를 확인하지 못했습니다.', error);
    }
  };
  const watchdog = createNativeFocusWatchdog(observeCurrentFocus);

  return {
    waitForReturn() {
      waitStarted = true;
      watchdog.start();
      void observeCurrentFocus();
      return deferred.result;
    },
    dispose() {
      unlisten();
      watchdog.dispose();
      stability.dispose();
      deferred.dispose();
    },
  };
}

function createNativeFocusWatchdog(observeCurrentFocus: () => Promise<void>) {
  let disposed = false;
  let watchdogTimeoutId: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (disposed) return;
    watchdogTimeoutId = setTimeout(() => {
      watchdogTimeoutId = null;
      console.warn(
        '[file:print] system print UI가 5분 넘게 열려 있어 focus 상태를 다시 확인합니다.',
      );
      void observeCurrentFocus().finally(schedule);
    }, PRINT_UI_FOCUS_WATCHDOG_MS);
  };
  return {
    start: schedule,
    dispose() {
      disposed = true;
      if (watchdogTimeoutId !== null) clearTimeout(watchdogTimeoutId);
    },
  };
}

function createNativeFocusStability(
  nativeWindow: NativeFocusWindow,
  deferred: ReturnType<typeof createDeferredResult>,
  getFocusEventGeneration: () => number,
) {
  let disposed = false;
  let stabilityTimeoutId: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => {
    if (stabilityTimeoutId === null) return;
    clearTimeout(stabilityTimeoutId);
    stabilityTimeoutId = null;
  };
  const observe = (focused: boolean, observedGeneration: number) => {
    if (disposed) return;
    cancel();
    if (!focused) return;
    stabilityTimeoutId = setTimeout(async () => {
      stabilityTimeoutId = null;
      try {
        const focusedNow = await nativeWindow.isFocused();
        if (
          observedGeneration === getFocusEventGeneration()
          && focusedNow
        ) {
          deferred.finish('native-focus-stable');
        }
      } catch (error) {
        console.warn('[file:print] native window focus 안정성을 확인하지 못했습니다.', error);
      }
    }, NATIVE_FOCUS_STABILITY_MS);
  };
  return {
    observe,
    dispose() {
      disposed = true;
      cancel();
    },
  };
}

function prepareDomFocusWaiter(): PrintUiReturnWaiter {
  if (
    typeof window === 'undefined'
    || typeof document === 'undefined'
    || typeof document.hasFocus !== 'function'
  ) {
    return immediateWaiter('unsupported');
  }

  const deferred = createDeferredResult();
  const onFocus = () => deferred.finish('dom-focus');
  window.addEventListener('focus', onFocus);
  const watchdog = createDomFocusWatchdog(document, deferred);
  return {
    waitForReturn() {
      if (document.hasFocus()) deferred.finish('dom-already-focused');
      else watchdog.start();
      return deferred.result;
    },
    dispose() {
      window.removeEventListener('focus', onFocus);
      watchdog.dispose();
      deferred.dispose();
    },
  };
}

function createDomFocusWatchdog(
  hostDocument: Pick<Document, 'hasFocus'>,
  deferred: ReturnType<typeof createDeferredResult>,
) {
  let disposed = false;
  let watchdogTimeoutId: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (disposed) return;
    watchdogTimeoutId = setTimeout(() => {
      watchdogTimeoutId = null;
      console.warn(
        '[file:print] system print UI가 5분 넘게 열려 있어 DOM focus 상태를 다시 확인합니다.',
      );
      if (hostDocument.hasFocus()) deferred.finish('dom-focus');
      else schedule();
    }, PRINT_UI_FOCUS_WATCHDOG_MS);
  };
  return {
    start: schedule,
    dispose() {
      disposed = true;
      if (watchdogTimeoutId !== null) clearTimeout(watchdogTimeoutId);
    },
  };
}

function immediateWaiter(reason: PrintUiReturnReason): PrintUiReturnWaiter {
  return {
    waitForReturn: async () => reason,
    dispose() {},
  };
}

function createDeferredResult() {
  let settled = false;
  let resolveResult: (reason: PrintUiReturnReason) => void = () => {};
  const result = new Promise<PrintUiReturnReason>((resolve) => {
    resolveResult = resolve;
  });

  const finish = (reason: PrintUiReturnReason) => {
    if (settled) return;
    settled = true;
    resolveResult(reason);
  };

  return {
    result,
    finish,
    dispose() {},
  };
}
