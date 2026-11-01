import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findLatestSupportedDocumentPath,
  hasSupportedDocumentPath,
  isSupportedDocumentPath,
  readStableDocumentFile,
} from './document-files';

const fsOpenMock = vi.hoisted(() => vi.fn());
const statMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/plugin-fs', () => ({
  open: fsOpenMock,
  stat: statMock,
}));

describe('document-files', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('matches supported document paths case-insensitively', () => {
    expect(isSupportedDocumentPath('report.hwp')).toBe(true);
    expect(isSupportedDocumentPath('report.HWPX')).toBe(true);
    expect(isSupportedDocumentPath('report.pdf')).toBe(false);
  });

  it('detects whether a path list contains a supported document', () => {
    expect(hasSupportedDocumentPath(['notes.txt', 'report.hwpx'])).toBe(true);
    expect(hasSupportedDocumentPath(['notes.txt', 'report.pdf'])).toBe(false);
  });

  it('returns the most recent supported document path', () => {
    expect(
      findLatestSupportedDocumentPath(['older.hwp', 'notes.txt', 'newer.hwpx']),
    ).toBe('newer.hwpx');
    expect(findLatestSupportedDocumentPath(['notes.txt', 'report.pdf'])).toBeNull();
  });

  it('reads stable bytes with a native source fingerprint', async () => {
    const modified = new Date('2026-08-04T00:00:00.000Z');
    statMock.mockResolvedValue({ size: 3, mtime: modified });
    fsOpenMock.mockResolvedValue(readHandle([1, 2, 3]));

    const result = await readStableDocumentFile('/documents/stable.hwp');

    expect(result.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(result.sourceFingerprint).toMatchObject({
      len: 3,
      modifiedMillis: modified.getTime(),
    });
  });

  it('rejects a document that changes during chunked reading', async () => {
    statMock
      .mockResolvedValueOnce({ size: 3, mtime: new Date(0) })
      .mockResolvedValueOnce({ size: 4, mtime: new Date(1) });
    fsOpenMock.mockResolvedValue(readHandle([1, 2, 3]));

    await expect(readStableDocumentFile('/documents/changing.hwp')).rejects.toThrow(
      '파일을 읽는 중 변경되었습니다',
    );
  });
});

function readHandle(values: number[]) {
  const bytes = Uint8Array.from(values);
  let offset = 0;
  return {
    read: vi.fn(async (target: Uint8Array) => {
      if (offset >= bytes.length) return null;
      const count = Math.min(target.byteLength, bytes.length - offset);
      target.set(bytes.subarray(offset, offset + count));
      offset += count;
      return count;
    }),
    close: vi.fn(async () => undefined),
  };
}
