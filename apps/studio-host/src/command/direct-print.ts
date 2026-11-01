import {
  appendSvgPage,
  createPrintPage,
  pdfPrintTitle,
  printProgressText,
  type PrintPage,
} from '@upstream/command/print-pages';
import {
  waitForPrintSurfaceReady,
  type PrintDocumentSurface,
} from '@upstream/command/print-surface';
import type { CommandServices } from '@upstream/command/types';
import {
  detectDesktopPlatform,
  type DesktopPlatform,
} from '../core/platform';
import {
  preparePrintUiReturnWaiter,
} from './print-ui-lifecycle';

let printJobActive = false;
const LINUX_PRINT_FRAGMENT_TOLERANCE_PX = 1;
const HOST_PRINT_SURFACE_ID = 'hwply-direct-print-surface';
const PRINT_ACTIVE_CLASS = 'hwply-print-active';
const PRODUCT_STYLE_SELECTOR = 'style[data-hwply-product-style="true"]';
const NATIVE_PRINT_COMMAND = 'print_current_webview';

interface HostPrintSurface extends PrintDocumentSurface {
  dispose(): void;
}

export async function printDirectlyFromPageSurface(
  services: CommandServices,
): Promise<void | null> {
  if (printJobActive) {
    setStatus('인쇄 문서를 준비하고 있습니다.');
    return null;
  }
  const platform = detectDesktopPlatform();
  printJobActive = true;

  const { wasm } = services;
  const originalStatus = readStatus();
  let surface: HostPrintSurface | null = null;
  let originalDocumentTitle: string | null = null;

  try {
    flushDeferredPagination(services);
    const pageCount = wasm.pageCount;
    if (pageCount === 0) return;

    setStatus(printProgressText('print', 0, pageCount));
    const printPages = await preparePrintPages(services, pageCount);
    surface = createHostPrintSurface(printPages, platform);
    await waitForPrintSurfaceReady(surface);

    originalDocumentTitle = document.title;
    document.title = pdfPrintTitle(wasm.fileName);
    setStatus('시스템 인쇄 처리 중...');
    await runLoggedSystemPrint(platform, pageCount);
  } finally {
    if (originalDocumentTitle !== null) {
      document.title = originalDocumentTitle;
    }
    if (originalStatus !== null) setStatus(originalStatus);
    surface?.dispose();
    printJobActive = false;
    if (surface && platform === 'linux') {
      // GTK print hides the editor canvases. Restoring CSS alone can leave their
      // backing pixels blank; request a view-only redraw after surface cleanup.
      services.eventBus.emit('document-view-changed', 'system-print-return');
    }
  }
}

async function runLoggedSystemPrint(platform: DesktopPlatform, pageCount: number): Promise<void> {
  console.info(
    `[file:print] 시스템 인쇄 호출 `
    + `(surface=top-level, pages=${pageCount}, profile=print, platform=${platform}, `
    + `driver=${platform === 'linux' ? 'native-command' : 'window.print'})`,
  );
  const returnReason = await runSystemPrint(platform);
  console.info(
    `[file:print] 시스템 인쇄 modal lifecycle 종료 `
    + `(reason=${returnReason}, title=${JSON.stringify(document.title)})`,
  );
}

async function runSystemPrint(platform: DesktopPlatform): Promise<string> {
  if (platform === 'linux') {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke(NATIVE_PRINT_COMMAND);
    return 'native-command';
  }

  const waiter = await preparePrintUiReturnWaiter(platform);
  try {
    window.print();
    return await waiter.waitForReturn();
  } finally {
    waiter.dispose();
  }
}

function flushDeferredPagination(services: CommandServices): void {
  const inputHandler = services.getInputHandler();
  if (!inputHandler) return;
  inputHandler.flushDeferredPaginationIfNeeded('print');
  if (inputHandler.hasDeferredPaginationPending()) {
    throw new Error('출력 전 페이지네이션을 완료하지 못했습니다 (print)');
  }
}

async function preparePrintPages(
  services: CommandServices,
  pageCount: number,
): Promise<PrintPage[]> {
  const pages: PrintPage[] = [];
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    setStatus(printProgressText('print', pageIndex + 1, pageCount));
    pages.push(createPrintPage(
      services.wasm.renderPageSvgWithProfile(pageIndex, 'print'),
      services.wasm.getPageInfo(pageIndex),
      pageIndex,
    ));
    if (pageIndex % 5 === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  return pages;
}

function createHostPrintSurface(
  pages: PrintPage[],
  platform: DesktopPlatform,
): HostPrintSurface {
  const style = document.head.querySelector<HTMLStyleElement>(PRODUCT_STYLE_SELECTOR);
  if (!style || !document.body || !document.defaultView) {
    throw new Error('top-level 인쇄 surface를 만들 수 없습니다.');
  }
  document.getElementById(HOST_PRINT_SURFACE_ID)?.remove();
  document.documentElement.classList.remove(PRINT_ACTIVE_CLASS);
  const originalStyle = style.textContent ?? '';
  const container = document.createElement('div');
  container.id = HOST_PRINT_SURFACE_ID;
  container.setAttribute('aria-hidden', 'true');
  const dispose = createHostPrintDisposer(container, style, originalStyle);
  try {
    style.textContent = originalStyle + buildHostPrintStyle(pages, platform);
    for (const page of pages) appendSvgPage(document, container, page);
    document.body.appendChild(container);
    document.documentElement.classList.add(PRINT_ACTIVE_CLASS);
    return { window: document.defaultView, document, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}

function createHostPrintDisposer(
  container: HTMLElement,
  style: HTMLStyleElement,
  originalStyle: string,
): () => void {
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    container.remove();
    style.textContent = originalStyle;
    document.documentElement.classList.remove(PRINT_ACTIVE_CLASS);
  };
}

function buildHostPrintStyle(
  pages: PrintPage[],
  platform: DesktopPlatform,
): string {
  const pageRules = pages.map((page) => (
    `@page ${page.pageName} { size: ${formatMm(page.widthMm)}mm `
    + `${formatMm(page.heightMm)}mm; margin: 0; }`
  )).join('\n');
  const sizeRules = pages.map((page) => (
    `#${HOST_PRINT_SURFACE_ID} .${page.className} { page: ${page.pageName}; `
    + `width: ${formatMm(page.widthMm)}mm; height: ${formatMm(page.heightMm)}mm; }`
  )).join('\n');
  const linuxFragmentOverride = buildLinuxPrintFragmentOverride(pages, platform);
  return `\n${pageRules}\n@media print {\n${sizeRules}\n}\n${linuxFragmentOverride}`;
}

function buildLinuxPrintFragmentOverride(
  pages: PrintPage[],
  platform: DesktopPlatform,
): string {
  if (platform !== 'linux') return '';
  const uniformPage = findUniformPageSize(pages);
  if (!uniformPage) return '';
  const fragmentRules = pages
    .map((page) => (
      `#${HOST_PRINT_SURFACE_ID} .${page.className} { `
      + 'page: auto; '
      + `height: calc(${page.heightMm}mm - ${LINUX_PRINT_FRAGMENT_TOLERANCE_PX}px); `
      + '}'
    ))
    .join('\n');
  const defaultPageRule =
    `@page { size: ${uniformPage.widthMm}mm ${uniformPage.heightMm}mm; margin: 0; }\n`;

  return `
${defaultPageRule}
@media print {
  /*
   * WebKitGTK Print to File double-breaks uniform pages when each page uses
   * both a unique named page and an explicit page break. Keep named pages for
   * mixed-size documents, but use the default page context for uniform jobs.
   */
  ${fragmentRules}
}
`;
}

function formatMm(mm: number): string {
  return Number.isInteger(mm)
    ? String(mm)
    : mm.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function findUniformPageSize(pages: PrintPage[]): PrintPage | null {
  const firstPage = pages[0];
  if (!firstPage) return null;
  return pages.every((page) => (
    page.widthMm === firstPage.widthMm && page.heightMm === firstPage.heightMm
  ))
    ? firstPage
    : null;
}

function setStatus(message: string): void {
  const status = typeof document === 'undefined' ? null : document.getElementById('sb-message');
  if (status) status.textContent = message;
}

function readStatus(): string | null {
  const status = typeof document === 'undefined' ? null : document.getElementById('sb-message');
  return status?.textContent ?? null;
}
