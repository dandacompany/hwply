import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addRecentDoc,
  clearRecentDocs,
  listRecentDocs,
  removeRecentDoc,
  resetDesktopRecentPathsForTests,
  resolveDesktopRecentPath,
} from './recent-store';

const invokeMock = vi.hoisted(() => vi.fn());
const addUpstream = vi.hoisted(() => vi.fn());
const listUpstream = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@upstream/recent/recent-store', () => ({
  addRecentDoc: addUpstream,
  clearRecentDocs: vi.fn(),
  listRecentDocs: listUpstream,
  removeRecentDoc: vi.fn(),
}));

describe('desktop recent store adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDesktopRecentPathsForTests();
    delete (globalThis as { window?: unknown }).window;
  });

  it('keeps native paths out of menu records and resolves only opaque ids', async () => {
    (globalThis as { window?: unknown }).window = {
      __TAURI_INTERNALS__: {},
      location: { protocol: 'tauri:' },
    };
    invokeMock.mockResolvedValue([
      { path: 'C:\\private\\secret.hwpx', fileName: 'secret.hwpx' },
    ]);

    const recents = await listRecentDocs();

    expect(recents).toEqual([
      expect.objectContaining({ fileName: 'secret.hwpx', sourceFormat: 'hwpx' }),
    ]);
    expect(JSON.stringify(recents)).not.toContain('C:\\private');
    expect(resolveDesktopRecentPath(recents[0]!.id)).toBe('C:\\private\\secret.hwpx');
  });

  it('does not duplicate native recording from upstream load bookkeeping', async () => {
    (globalThis as { window?: unknown }).window = {
      __TAURI_INTERNALS__: {},
      location: { protocol: 'tauri:' },
    };

    await addRecentDoc({ fileName: 'opened.hwp', sourceFormat: 'hwp' });

    expect(addUpstream).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('removes the resolved path from the native store before dropping the opaque id', async () => {
    (globalThis as { window?: unknown }).window = {
      __TAURI_INTERNALS__: {},
      location: { protocol: 'tauri:' },
    };
    invokeMock
      .mockResolvedValueOnce([{ path: 'C:\\private\\old.hwp', fileName: 'old.hwp' }])
      .mockResolvedValueOnce(undefined);
    const [recent] = await listRecentDocs();

    await removeRecentDoc(recent!.id);

    expect(invokeMock).toHaveBeenLastCalledWith('remove_recent_document', {
      path: 'C:\\private\\old.hwp',
    });
    expect(resolveDesktopRecentPath(recent!.id)).toBeNull();
  });

  it('clears the native store and delegates to upstream outside Tauri', async () => {
    (globalThis as { window?: unknown }).window = {
      __TAURI_INTERNALS__: {},
      location: { protocol: 'tauri:' },
    };
    invokeMock.mockResolvedValue(undefined);
    await clearRecentDocs();
    expect(invokeMock).toHaveBeenCalledWith('clear_recent_documents');

    delete (globalThis as { window?: unknown }).window;
    listUpstream.mockResolvedValue([{ id: 'browser' }]);
    await expect(listRecentDocs()).resolves.toEqual([{ id: 'browser' }]);
  });
});
