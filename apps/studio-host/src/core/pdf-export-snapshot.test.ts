import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initSync } from '@wasm/rhwp.js';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { WasmBridge } from './font-policy-wasm-bridge';
import {
  createPdfExportSnapshot,
  MAX_PDF_EXPORT_PAGES,
  MAX_PDF_PAGE_SVG_BYTES,
  MAX_PDF_SNAPSHOT_BYTES,
  type PdfSnapshotBridge,
} from './pdf-export-snapshot';

const SNAPSHOT_ID = '123e4567-e89b-42d3-a456-426614174000';

describe('PDF export snapshot', () => {
  afterEach(() => vi.useRealTimers());

  it('captures HWP once and renders only from an immutable isolated bridge', async () => {
    const source = fakeSource();
    const bridge = fakeBridge(2, page => `<svg viewBox="0 0 1 1">snapshot-${page}</svg>`);
    const livePageSvg = vi.fn(() => '<svg>live-start-page</svg>');
    const notifySaved = vi.fn();
    const sourceWithLiveHandlers = { ...source, getPageSvg: livePageSvg, notifySaved };

    const snapshot = await createPdfExportSnapshot({
      source: sourceWithLiveHandlers,
      format: 'hwp',
      createBridge: () => bridge,
      createId: () => SNAPSHOT_ID,
    });

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(snapshot).toMatchObject({ id: SNAPSHOT_ID, pageCount: 2 });
    expect(source.exportHwp).toHaveBeenCalledOnce();
    expect(source.exportHwpx).not.toHaveBeenCalled();
    expect(bridge.loadDocument).toHaveBeenCalledWith(source.hwpBytes, 'snapshot.hwp');
    livePageSvg.mockReturnValue('<svg>edited-live-page</svg>');
    expect(snapshot.renderPageSvg(0)).toContain('snapshot-0');
    expect(snapshot.renderPageSvg(1)).toContain('snapshot-1');
    expect(livePageSvg).not.toHaveBeenCalled();
    expect(notifySaved).not.toHaveBeenCalled();
    expect(() => snapshot.renderPageSvg(2)).toThrow('페이지 범위');

    snapshot.dispose();
    snapshot.dispose();
    expect(bridge.releaseDocument).toHaveBeenCalledOnce();
    expect(() => snapshot.renderPageSvg(0)).toThrow('해제된 PDF snapshot');
  });

  it('uses the current HWPX serializer and releases a failed isolated load', async () => {
    const source = fakeSource();
    const bridge = fakeBridge(1);
    bridge.loadDocument.mockImplementation(() => {
      throw new Error('round-trip load failed');
    });

    await expect(createPdfExportSnapshot({
      source,
      format: 'hwpx',
      createBridge: () => bridge,
      createId: () => SNAPSHOT_ID,
    })).rejects.toThrow('round-trip load failed');

    expect(source.exportHwpx).toHaveBeenCalledOnce();
    expect(source.exportHwp).not.toHaveBeenCalled();
    expect(bridge.loadDocument).toHaveBeenCalledWith(source.hwpxBytes, 'snapshot.hwpx');
    expect(bridge.releaseDocument).toHaveBeenCalledOnce();
  });

  it.each([0, MAX_PDF_EXPORT_PAGES + 1])(
    'rejects page count %s and releases the document',
    async pageCount => {
      const bridge = fakeBridge(pageCount);
      await expect(createPdfExportSnapshot({
        source: fakeSource(),
        format: 'hwp',
        createBridge: () => bridge,
        createId: () => SNAPSHOT_ID,
      })).rejects.toThrow('PDF snapshot');
      expect(bridge.releaseDocument).toHaveBeenCalledOnce();
    },
  );

  it('rejects empty and oversized serializer bytes before creating a bridge', async () => {
    const createBridge = vi.fn(() => fakeBridge(1));
    const oversized = new Uint8Array([1]);
    Object.defineProperty(oversized, 'byteLength', { value: MAX_PDF_SNAPSHOT_BYTES + 1 });

    for (const bytes of [new Uint8Array(), oversized]) {
      await expect(createPdfExportSnapshot({
        source: {
          exportHwp: vi.fn(async () => bytes),
          exportHwpx: vi.fn(async () => new Uint8Array([1])),
        },
        format: 'hwp',
        createBridge,
        createId: () => SNAPSHOT_ID,
      })).rejects.toThrow('PDF snapshot serializer');
    }
    expect(createBridge).not.toHaveBeenCalled();
  });

  it('rejects a non-UUID snapshot ID before serializing the source', async () => {
    const source = fakeSource();
    await expect(createPdfExportSnapshot({
      source,
      format: 'hwp',
      createId: () => 'stale-snapshot',
    })).rejects.toThrow('snapshot ID');
    expect(source.exportHwp).not.toHaveBeenCalled();
  });

  it('rejects empty and oversized page SVG output', async () => {
    const empty = await createPdfExportSnapshot({
      source: fakeSource(), format: 'hwp', createBridge: () => fakeBridge(1, () => ''),
      createId: () => SNAPSHOT_ID,
    });
    expect(() => empty.renderPageSvg(0)).toThrow('SVG가 비어');
    empty.dispose();

    const oversizedSvg = 'x'.repeat(MAX_PDF_PAGE_SVG_BYTES + 1);
    const oversized = await createPdfExportSnapshot({
      source: fakeSource(), format: 'hwp',
      createBridge: () => fakeBridge(1, () => oversizedSvg),
      createId: () => SNAPSHOT_ID,
    });
    expect(() => oversized.renderPageSvg(0)).toThrow('16 MiB 제한');
    oversized.dispose();
  });

  it('times out a serializer that does not settle without creating a bridge', async () => {
    vi.useFakeTimers();
    const createBridge = vi.fn(() => fakeBridge(1));
    const pending = createPdfExportSnapshot({
      source: {
        exportHwp: vi.fn(() => new Promise<Uint8Array>(() => undefined)),
        exportHwpx: vi.fn(async () => new Uint8Array([1])),
      },
      format: 'hwp',
      createBridge,
      createId: () => SNAPSHOT_ID,
      captureTimeoutMs: 50,
    });
    const rejection = expect(pending).rejects.toThrow('2분 제한');

    await vi.advanceTimersByTimeAsync(50);
    await rejection;
    expect(createBridge).not.toHaveBeenCalled();
  });
});

describe('PDF export snapshot fixture round-trip', () => {
  const measureKey = 'measureTextWidth';
  let previousMeasureTextWidth: unknown;

  beforeAll(() => {
    const globals = globalThis as unknown as Record<string, unknown>;
    previousMeasureTextWidth = globals[measureKey];
    globals[measureKey] = (_font: string, text: string) => text.length * 7;
    initSync({
      module: readFileSync(new URL('../../vendor/rhwp-core/rhwp_bg.wasm', import.meta.url)),
    });
  });

  afterAll(() => {
    const globals = globalThis as unknown as Record<string, unknown>;
    if (previousMeasureTextWidth === undefined) delete globals[measureKey];
    else globals[measureKey] = previousMeasureTextWidth;
  });

  it.each([
    { format: 'hwp' as const, expectedPages: 6, url: new URL('../../../../third_party/rhwp/rhwp-studio/public/samples/biz_plan.hwp', import.meta.url) },
    { format: 'hwpx' as const, expectedPages: 10, url: new URL('../../../../third_party/rhwp/rhwp-studio/public/samples/form-002.hwpx', import.meta.url) },
  ])('preserves every $format page SVG', async ({ format, expectedPages, url }) => {
    const live = new WasmBridge();
    await live.initialize();
    const path = fileURLToPath(url);
    live.loadDocument(readFileSync(path), basename(path));
    const source = {
      exportHwp: vi.fn(async () => live.exportHwp()),
      exportHwpx: vi.fn(async () => live.exportHwpx()),
    };
    const snapshot = await createPdfExportSnapshot({ source, format });

    try {
      expect(live.pageCount).toBe(expectedPages);
      expect(snapshot.pageCount).toBe(expectedPages);
      const liveSvg = Array.from({ length: expectedPages }, (_, page) => live.renderPageSvg(page));
      const snapshotSvg = Array.from(
        { length: expectedPages },
        (_, page) => snapshot.renderPageSvg(page),
      );
      expect(snapshotSvg).toEqual(liveSvg);
      expect(snapshotSvg.every(svg => svg.includes('<svg') && svg.includes('viewBox='))).toBe(true);
      expect(snapshotSvg.join('')).toMatch(/[가-힣]/);
      expect(format === 'hwp' ? source.exportHwp : source.exportHwpx).toHaveBeenCalledOnce();
      expect(format === 'hwp' ? source.exportHwpx : source.exportHwp).not.toHaveBeenCalled();
    } finally {
      snapshot.dispose();
      live.releaseDocument();
    }
  });
});

function fakeSource() {
  const hwpBytes = new Uint8Array([1, 2, 3]);
  const hwpxBytes = new Uint8Array([4, 5, 6]);
  return {
    hwpBytes,
    hwpxBytes,
    exportHwp: vi.fn(async () => hwpBytes),
    exportHwpx: vi.fn(async () => hwpxBytes),
  };
}

function fakeBridge(pageCount: number, render = (page: number) => `<svg>${page}</svg>`) {
  return {
    initialize: vi.fn(async () => undefined),
    loadDocument: vi.fn(),
    pageCount,
    renderPageSvg: vi.fn(render),
    releaseDocument: vi.fn(),
  } satisfies PdfSnapshotBridge;
}
