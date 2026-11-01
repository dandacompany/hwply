import { vi } from 'vitest';
import type { CommandServices } from '@upstream/command/types';

export function createServices(inputHandler: unknown = null) {
  return {
    wasm: {
      fileName: 'document.hwp',
      pageCount: 2,
      renderPageSvgWithProfile: vi.fn((index: number) => `<svg id="p${index}"/>`),
      getPageInfo: vi.fn(() => ({ width: 794, height: 1123 })),
    },
    eventBus: { emit: vi.fn() },
    documentState: { markDirty: vi.fn(), markClean: vi.fn() },
    getInputHandler: () => inputHandler,
  } as unknown as CommandServices & {
    wasm: {
      renderPageSvgWithProfile: ReturnType<typeof vi.fn>;
      getPageInfo: ReturnType<typeof vi.fn>;
    };
    eventBus: { emit: ReturnType<typeof vi.fn> };
  };
}

export function installHostDocument(options: {
  hasFocus?: () => boolean;
  hasProductStyle?: boolean;
  hasStalePrintState?: boolean;
} = {}) {
  const status = { textContent: '' };
  const productStyle = { textContent: 'product css' };
  const classNames = new Set<string>();
  if (options.hasStalePrintState) classNames.add('hwply-print-active');
  const staleContainer = { remove: vi.fn() };
  const container = {
    id: '',
    setAttribute: vi.fn(),
    remove: vi.fn(),
  };
  const windowLike = {
    print: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  const documentLike = {
    title: 'hwply',
    hasFocus: options.hasFocus ?? (() => true),
    defaultView: windowLike,
    head: {
      querySelector: vi.fn(() => options.hasProductStyle === false ? null : productStyle),
    },
    body: { appendChild: vi.fn() },
    documentElement: {
      classList: {
        contains: (name: string) => classNames.has(name),
        add: (name: string) => classNames.add(name),
        remove: (name: string) => classNames.delete(name),
      },
    },
    createElement: vi.fn(() => container),
    getElementById: vi.fn((id: string) => {
      if (id === 'sb-message') return status;
      if (id === 'hwply-direct-print-surface' && options.hasStalePrintState) {
        return staleContainer;
      }
      return null;
    }),
  };
  (globalThis as { document?: unknown }).document = documentLike;
  (globalThis as { window?: unknown }).window = windowLike;
  return {
    status,
    productStyle,
    classNames,
    staleContainer,
    container,
    window: windowLike,
    document: documentLike,
  };
}
