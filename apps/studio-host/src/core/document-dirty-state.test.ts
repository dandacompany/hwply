import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentDirtyState } from './document-dirty-state';

const host = vi.hoisted(() => ({
  markDocumentDirty: vi.fn(),
  completePendingDocumentInitialization: vi.fn(),
  syncDocumentTitle: vi.fn(),
}));

vi.mock('@upstream/core/document-dirty-state', () => ({
  DocumentDirtyState: class {
    dirty = false;
    markDirty() { this.dirty = true; }
    markClean() { this.dirty = false; }
  },
}));
vi.mock('./desktop-host', () => ({ getDesktopHost: () => host }));

describe('desktop dirty state adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete (globalThis as { window?: unknown }).window;
  });

  it('preserves upstream-only state outside Tauri', () => {
    const state = new DocumentDirtyState({} as never);
    state.markDirty('edit');

    expect(host.markDocumentDirty).not.toHaveBeenCalled();
  });

  it('mirrors dirty transitions and completes a pending native blank document', () => {
    (globalThis as { window?: unknown }).window = {
      __TAURI_INTERNALS__: {},
      location: { protocol: 'tauri:' },
    };
    const state = new DocumentDirtyState({} as never);

    state.markDirty('edit');
    state.markClean('document-initialized');

    expect(host.markDocumentDirty).toHaveBeenCalledOnce();
    expect(host.completePendingDocumentInitialization).toHaveBeenCalledOnce();
    expect(host.syncDocumentTitle).toHaveBeenCalledOnce();
  });
});
