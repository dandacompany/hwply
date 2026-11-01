import { normalizePath, type Plugin } from 'vite';
import { resolve } from 'node:path';

const startupEntry = 'async function openBlankDocumentIfIdle(): Promise<void> {';

export function transformDesktopStartup(source: string, platformPath: string): string {
  if (source.includes('__hwplyNativeStartup') || source.split(startupEntry).length !== 2) {
    throw new Error('upstream desktop startup hook marker mismatch');
  }
  // Native documents require DesktopHost.beginNewDocument to allocate a Rust session.
  // Keep the existing desktop idle screen; File > New already owns that lifecycle.
  return `import { isTauriRuntime as __hwplyNativeStartup } from ${JSON.stringify(normalizePath(platformPath))};\n`
    + source.replace(startupEntry, `${startupEntry}\n  if (__hwplyNativeStartup()) return;`);
}

export function createDesktopStartupEntry(upstreamSrc: string, hwplySrc: string): Plugin {
  const main = normalizePath(resolve(upstreamSrc, 'main.ts'));
  return {
    name: 'hwply-desktop-startup-entry',
    enforce: 'pre',
    transform(source, id) {
      if (normalizePath(id.split(/[?#]/, 1)[0]) !== main) return null;
      return {
        code: transformDesktopStartup(source, resolve(hwplySrc, 'core/platform.ts')),
        map: null,
      };
    },
  };
}
