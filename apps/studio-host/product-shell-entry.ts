import { resolve } from 'node:path';
import { normalizePath, type Plugin } from 'vite';

const titleImport = "import { installDocumentTitle } from '@/ui/document-title';";
const localeEntry = 'initI18n();';
const accessibleHook = '__hwplyApplyAccessibleName';

export function transformProductShellEntry(source: string, productShellPath: string): string {
  if (source.includes(accessibleHook)
    || source.split(titleImport).length !== 2 || source.split(localeEntry).length !== 2) {
    throw new Error('upstream product shell hook marker mismatch');
  }
  return source.replace(titleImport,
    `import { installDocumentTitle, applyProductAccessibleName as ${accessibleHook} } from ${JSON.stringify(normalizePath(productShellPath))};`)
    .replace(localeEntry, `${accessibleHook}(initI18n());`);
}

export function createProductShellEntry(upstreamSrc: string, hwplySrc: string): Plugin {
  const main = normalizePath(resolve(upstreamSrc, 'main.ts'));
  return {
    name: 'hwply-product-shell-entry',
    enforce: 'pre',
    transform(source, id) {
      if (normalizePath(id.split(/[?#]/, 1)[0]) !== main) return null;
      return { code: transformProductShellEntry(source, resolve(hwplySrc, 'ui/product-shell.ts')), map: null };
    },
  };
}
