import { resolve } from 'node:path';
import { normalizePath, type Plugin } from 'vite';

interface LocalFontPaths {
  upstreamSrc: string;
  hwplySrc: string;
}

const relativeConsumers = ['core/document-font-status.ts', 'core/font-substitution.ts',
  'core/host-font-requests.ts', 'core/host-canvas-fonts.ts', 'core/wasm-bridge.ts'];

export function resolvehwplyLocalFontImport(
  source: string,
  importer: string | undefined,
  { upstreamSrc, hwplySrc }: LocalFontPaths,
): string | null {
  if (!['./local-fonts.ts', './local-fonts'].includes(source) || !importer) return null;
  const importerPath = importer.split(/[?#]/, 1)[0].replaceAll('\\', '/');
  const allowed = relativeConsumers.some((path) =>
    normalizePath(resolve(upstreamSrc, path)) === importerPath);
  return allowed ? normalizePath(resolve(hwplySrc, 'core/local-fonts.ts')) : null;
}

/** Relative imports bypass the existing @/ leaf alias; keep all font consumers on it. */
export function createHwplyLocalFontPlugin(paths: LocalFontPaths): Plugin {
  return {
    name: 'hwply-local-font-consumers',
    enforce: 'pre',
    resolveId(source, importer) {
      return resolvehwplyLocalFontImport(source, importer, paths);
    },
  };
}
