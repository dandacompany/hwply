import type { DesktopDocumentFormat } from './desktop-session';
import { WasmBridge } from './font-policy-wasm-bridge';

export const MAX_PDF_SNAPSHOT_BYTES = 128 * 1024 * 1024;
export const MAX_PDF_EXPORT_PAGES = 4_096;
export const MAX_PDF_PAGE_SVG_BYTES = 16 * 1024 * 1024;
export const PDF_SNAPSHOT_CAPTURE_TIMEOUT_MS = 2 * 60 * 1_000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UTF8_ENCODER = new TextEncoder();

export interface PdfSnapshotSource {
  exportHwp(): Promise<Uint8Array>;
  exportHwpx(): Promise<Uint8Array>;
}

export interface PdfSnapshotBridge {
  initialize(): Promise<void>;
  loadDocument(bytes: Uint8Array, fileName?: string): unknown;
  readonly pageCount: number;
  renderPageSvg(pageIndex: number): string;
  releaseDocument(): void;
}

export interface PdfExportSnapshot {
  readonly id: string;
  readonly pageCount: number;
  renderPageSvg(pageIndex: number): string;
  dispose(): void;
}

interface CreatePdfExportSnapshotOptions {
  source: PdfSnapshotSource;
  format: DesktopDocumentFormat;
  createBridge?: () => PdfSnapshotBridge;
  createId?: () => string;
  captureTimeoutMs?: number;
  now?: () => number;
}

export async function createPdfExportSnapshot(
  options: CreatePdfExportSnapshotOptions,
): Promise<PdfExportSnapshot> {
  const timeoutMs = options.captureTimeoutMs ?? PDF_SNAPSHOT_CAPTURE_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('PDF snapshot 제한 시간이 올바르지 않습니다');
  }
  const now = options.now ?? (() => globalThis.performance.now());
  const deadline = now() + timeoutMs;
  const id = (options.createId ?? createSnapshotId)();
  if (!UUID_PATTERN.test(id)) throw new Error('PDF snapshot ID가 올바르지 않습니다');

  const serializer = options.format === 'hwpx'
    ? options.source.exportHwpx()
    : options.source.exportHwp();
  const bytes = await waitWithinDeadline(serializer, deadline, now);
  assertSnapshotBytes(bytes);

  const bridge = (options.createBridge ?? (() => new WasmBridge()))();
  try {
    await waitWithinDeadline(bridge.initialize(), deadline, now);
    bridge.loadDocument(bytes, `snapshot.${options.format}`);
    assertBeforeDeadline(deadline, now);
    assertPageCount(bridge.pageCount);
    return createSnapshotHandle(id, bridge.pageCount, bridge);
  } catch (error) {
    releaseAfterFailure(bridge);
    throw error;
  }
}

function createSnapshotHandle(
  id: string,
  pageCount: number,
  bridge: PdfSnapshotBridge,
): PdfExportSnapshot {
  let disposed = false;
  return Object.freeze({
    id,
    pageCount,
    renderPageSvg(pageIndex: number): string {
      if (disposed) throw new Error('해제된 PDF snapshot은 렌더할 수 없습니다');
      if (!Number.isSafeInteger(pageIndex) || pageIndex < 0 || pageIndex >= pageCount) {
        throw new Error(`PDF snapshot 페이지 범위가 올바르지 않습니다: ${pageIndex}`);
      }
      const svg = bridge.renderPageSvg(pageIndex);
      if (typeof svg !== 'string' || svg.length === 0) {
        throw new Error(`PDF snapshot ${pageIndex + 1}쪽 SVG가 비어 있습니다`);
      }
      const svgBytes = UTF8_ENCODER.encode(svg).byteLength;
      if (svgBytes > MAX_PDF_PAGE_SVG_BYTES) {
        throw new Error(`PDF snapshot ${pageIndex + 1}쪽 SVG가 16 MiB 제한을 초과했습니다`);
      }
      return svg;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      bridge.releaseDocument();
    },
  });
}

function assertSnapshotBytes(bytes: Uint8Array): void {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    throw new Error('PDF snapshot serializer 결과가 비어 있습니다');
  }
  if (bytes.byteLength > MAX_PDF_SNAPSHOT_BYTES) {
    throw new Error('PDF snapshot serializer 결과가 128 MiB 제한을 초과했습니다');
  }
}

function assertPageCount(pageCount: number): void {
  if (!Number.isSafeInteger(pageCount) || pageCount <= 0) {
    throw new Error('PDF snapshot에 저장할 페이지가 없습니다');
  }
  if (pageCount > MAX_PDF_EXPORT_PAGES) {
    throw new Error('PDF snapshot 페이지가 4,096쪽 제한을 초과했습니다');
  }
}

async function waitWithinDeadline<T>(
  operation: Promise<T>,
  deadline: number,
  now: () => number,
): Promise<T> {
  const remaining = deadline - now();
  if (remaining <= 0) throw captureTimeoutError();
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = globalThis.setTimeout(() => reject(captureTimeoutError()), remaining);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer !== undefined) globalThis.clearTimeout(timer);
  }
}

function assertBeforeDeadline(deadline: number, now: () => number): void {
  if (now() > deadline) throw captureTimeoutError();
}

function captureTimeoutError(): Error {
  return new Error('PDF snapshot 생성 시간이 2분 제한을 초과했습니다');
}

function createSnapshotId(): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID !== 'function') {
    throw new Error('PDF snapshot ID를 생성할 수 없습니다');
  }
  return randomUUID.call(globalThis.crypto);
}

function releaseAfterFailure(bridge: PdfSnapshotBridge): void {
  try {
    bridge.releaseDocument();
  } catch {
    // Snapshot 생성 실패 원인을 보존한다. 실제 WasmBridge release는 자체적으로 idempotent하다.
  }
}
