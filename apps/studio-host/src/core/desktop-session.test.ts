import { describe, expect, it } from 'vitest';
import { DesktopSession, type NativeDocumentState } from './desktop-session';

describe('desktop session', () => {
  it('commits one active session and returns the replaced document id', () => {
    const session = new DesktopSession();

    expect(session.commitOpen(nativeState({ docId: 'first' }))).toBeNull();
    expect(session.commitOpen(nativeState({ docId: 'second', format: 'hwpx' }))).toBe('first');
    expect(session.active).toMatchObject({ docId: 'second', format: 'hwpx', dirty: false });
  });

  it('marks dirty once and rejects a mismatched save result', () => {
    const session = new DesktopSession();
    session.commitOpen(nativeState({ docId: 'active' }));

    expect(session.markDirty()).toBe('active');
    expect(session.markDirty()).toBeNull();
    expect(() => session.commitSave(nativeState({ docId: 'other' }))).toThrow(
      '현재 문서와 일치하지 않습니다',
    );
  });

  it('applies native save metadata and releases the active session', () => {
    const session = new DesktopSession();
    session.commitOpen(nativeState({ docId: 'active', dirty: true }));
    session.commitSave(nativeState({
      docId: 'active',
      fileName: 'saved.hwpx',
      sourcePath: '/documents/saved.hwpx',
      format: 'hwpx',
      revision: 4,
    }));

    expect(session.active).toMatchObject({
      fileName: 'saved.hwpx',
      sourcePath: '/documents/saved.hwpx',
      format: 'hwpx',
      revision: 4,
      dirty: false,
    });
    expect(session.release()).toBe('active');
    expect(session.active).toBeNull();
  });
});

function nativeState(overrides: Partial<NativeDocumentState> = {}): NativeDocumentState {
  return {
    docId: 'doc',
    fileName: 'document.hwp',
    sourcePath: null,
    format: 'hwp',
    revision: 1,
    dirty: false,
    warnings: [],
    ...overrides,
  };
}
