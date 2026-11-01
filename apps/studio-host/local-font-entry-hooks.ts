import { resolve } from 'node:path';
import { normalizePath, type Plugin } from 'vite';
import { insertStudioMenuItem } from './studio-menu-hooks';

const documentEntry = `async function initializeDocument(
  docInfo: DocumentInfo,
  displayName: string,
  options: { suppressDialogs?: boolean } = {},
): Promise<void> {`;
const promptEntry = 'async function promptLocalFontsIfNeeded(docInfo: DocumentInfo, displayName: string): Promise<void> {';

function replaceOnce(source: string, marker: string, replacement: string): string {
  if (source.split(marker).length !== 2) throw new Error('upstream local-font hook marker mismatch');
  return source.replace(marker, replacement);
}

export function transformLocalFontEntry(source: string, controllerPath: string): string {
  if (source.includes('__hwplyPrepareFonts')) throw new Error('duplicate local-font entry hook');
  const withDocument = replaceOnce(source, documentEntry, `${documentEntry}
  await __hwplyPrepareFonts({
    fonts: docInfo.fontsUsed ?? [],
    refreshView: async (isCurrent) => {
      const session = rendererSession;
      const view = canvasView;
      await view?.refreshFontResources();
      if (!isCurrent() || view !== canvasView || session !== rendererSession
        || view?.getRenderBackend() !== 'canvaskit') return;
      const renderer = session?.getCanvasKitRenderer();
      if (!renderer) return;
      const decisionKey = session?.diagnostics()?.decisionKey;
      await renderer.prepareLocalFonts(docInfo.fontsUsed ?? []);
      if (isCurrent() && view === canvasView && session === rendererSession
        && renderer === session?.getCanvasKitRenderer()
        && decisionKey === session?.diagnostics()?.decisionKey
        && view?.getRenderBackend() === 'canvaskit') {
        eventBus.emit('document-view-changed');
      }
    },
    onFontsChanged: (fonts) => eventBus.emit('local-fonts-changed', {
      fonts, report: analyzeDocumentFonts(docInfo.fontsUsed),
    }),
  });`);
  const withPrompt = replaceOnce(withDocument, promptEntry, `${promptEntry}
  if (await __hwplyPromptFonts()) return;`);
  return `import { prepareDesktopDocumentFonts as __hwplyPrepareFonts,
    promptDesktopLocalFonts as __hwplyPromptFonts } from ${JSON.stringify(normalizePath(controllerPath))};\n${withPrompt}`;
}

export function createLocalFontEntryHooks(upstreamSrc: string, hwplySrc: string): Plugin {
  const main = normalizePath(resolve(upstreamSrc, 'main.ts'));
  const controller = resolve(hwplySrc, 'core/local-font-controller.ts');
  return {
    name: 'hwply-local-font-entry-hooks',
    enforce: 'pre',
    transform(source, id) {
      if (normalizePath(id.split(/[?#]/, 1)[0]) !== main) return null;
      return { code: transformLocalFontEntry(source, controller), map: null };
    },
    transformIndexHtml(html) {
      return insertStudioMenuItem(html, 'tool:options',
        '<div class="md-item" data-cmd="tool:local-font-settings"><span class="md-icon"></span><span class="md-label">로컬 글꼴 설정…</span></div>');
    },
  };
}
