import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CommandRegistry } from '@upstream/command/registry';
const refreshView = vi.hoisted(() => vi.fn());
const disposeFonts = vi.hoisted(() => vi.fn());
const openSettings = vi.hoisted(() => vi.fn());
const listen = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());
vi.mock('./local-font-controller', () => ({
  refreshDesktopLocalFontView: refreshView, disposeDesktopLocalFonts: disposeFonts,
  openDesktopLocalFontSettings: openSettings,
}));
vi.mock('./local-font-preferences', () => ({
  listenFontPreferences: listen, refreshFontPreferences: refresh,
  getFontPreferences: () => ({ revision: 1 }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('window', new EventTarget());
  refresh.mockResolvedValue({ revision: 1 });
});
afterEach(() => vi.unstubAllGlobals());

it('registers before snapshot read, ignores unchanged focus and disposes all owned hooks', async () => {
  const cleanup = vi.fn();
  listen.mockResolvedValue(cleanup);
  const { installDesktopLocalFonts } = await import('./local-font-lifecycle');
  const registry = new CommandRegistry();
  const dispose = installDesktopLocalFonts(registry);
  await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(listen.mock.invocationCallOrder[0]).toBeLessThan(refresh.mock.invocationCallOrder[0]);
  expect(registry.has('tool:local-font-settings')).toBe(true);
  window.dispatchEvent(new Event('focus'));
  await Promise.resolve();
  expect(refreshView).not.toHaveBeenCalled();
  listen.mock.calls[0][0]();
  expect(refreshView).toHaveBeenCalledTimes(1);
  dispose(); dispose();
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(disposeFonts).toHaveBeenCalledTimes(1);
  expect(registry.has('tool:local-font-settings')).toBe(false);
});

it('cleans up a listener that resolves after the window was disposed', async () => {
  let finish!: (cleanup: () => void) => void;
  listen.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const { installDesktopLocalFonts } = await import('./local-font-lifecycle');
  const dispose = installDesktopLocalFonts(new CommandRegistry());
  dispose();
  const cleanup = vi.fn();
  finish(cleanup);
  await vi.waitFor(() => expect(cleanup).toHaveBeenCalledTimes(1));
  expect(refresh).not.toHaveBeenCalled();
});
