import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
const saved = { choice: 'enabled' as const, persisted: true, revision: 1, promptDismissed: false, error: null };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('native local-font preference bridge', () => {
  beforeEach(() => { vi.resetModules(); invoke.mockReset(); });

  it('restores a native setting and combines concurrent reads', async () => {
    invoke.mockResolvedValue(saved);
    const prefs = await import('./local-font-preferences');
    const result = await Promise.all([prefs.ensureFontPreferences(), prefs.ensureFontPreferences()]);
    expect(result).toEqual([saved, saved]);
    await prefs.ensureFontPreferences();
    expect(invoke).toHaveBeenCalledExactlyOnceWith('get_local_font_preferences');
  });

  it('keeps a failed choice temporary across same-revision native reads', async () => {
    const prefs = await import('./local-font-preferences');
    prefs.acceptFontPreferences(saved);
    invoke.mockRejectedValueOnce(new Error('/private/native/path'));
    expect(await prefs.saveFontPreference('disabled')).toMatchObject({
      choice: 'disabled', persisted: false, error: 'save-failed',
    });
    invoke.mockResolvedValue(saved);
    expect(await prefs.refreshFontPreferences()).toMatchObject({
      choice: 'disabled', persisted: false, error: 'save-failed',
    });
    prefs.acceptFontPreferences({ ...saved, revision: 2 });
    expect(prefs.getFontPreferences()).toEqual({ ...saved, revision: 2 });
  });

  it('does not let an old failed read revoke a newer event snapshot', async () => {
    const read = deferred<unknown>();
    invoke.mockReturnValue(read.promise);
    const prefs = await import('./local-font-preferences');
    const pending = prefs.refreshFontPreferences();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalled());
    prefs.acceptFontPreferences({ ...saved, revision: 3 });
    read.reject(new Error('late read failure'));
    await pending;
    expect(prefs.getFontPreferences()).toEqual({ ...saved, revision: 3 });
    expect(prefs.acceptFontPreferences({ ...saved, revision: 2 })).toBe(false);
  });

  it('does not let an older successful write replace the latest choice', async () => {
    const old = deferred<unknown>();
    invoke.mockReturnValueOnce(old.promise).mockResolvedValueOnce({
      ...saved, revision: 3, choice: 'disabled',
    });
    const prefs = await import('./local-font-preferences');
    const first = prefs.saveFontPreference('enabled');
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    await prefs.saveFontPreference('disabled');
    old.resolve({ ...saved, revision: 2 });
    await first;
    expect(prefs.getFontPreferences()).toMatchObject({ choice: 'disabled', revision: 3 });
  });

  it('fails closed on invalid or unreadable snapshots without exposing raw errors', async () => {
    const prefs = await import('./local-font-preferences');
    invoke.mockResolvedValueOnce({ ...saved, choice: 'anything' });
    expect(await prefs.refreshFontPreferences()).toMatchObject({
      choice: 'unset', persisted: false, error: 'restore-failed',
    });
    invoke.mockRejectedValueOnce(new Error('C:/Private/Fonts'));
    expect(JSON.stringify(await prefs.refreshFontPreferences())).not.toContain('Private');
    invoke.mockResolvedValueOnce(saved);
    expect(await prefs.refreshFontPreferences()).toEqual(saved);
  });

  it('keeps a failed dismiss local without persisting a rejection', async () => {
    const prefs = await import('./local-font-preferences');
    invoke.mockRejectedValueOnce(new Error('IPC unavailable'));
    expect(await prefs.saveFontPreference('dismiss')).toMatchObject({
      choice: 'unset', persisted: false, promptDismissed: true,
    });
    expect(invoke).toHaveBeenCalledWith('set_local_font_preferences', { action: 'dismiss' });
  });
});
