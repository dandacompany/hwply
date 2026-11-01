import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { transformProductShellEntry } from '../../product-shell-entry';

const main = readFileSync(resolve(__dirname, '../../../../third_party/rhwp/rhwp-studio/src/main.ts'), 'utf8');
const titleImport = "import { installDocumentTitle } from '@/ui/document-title';";
const localeEntry = 'initI18n();';

describe('exact upstream product shell entry', () => {
  it('connects title and locale while preserving the rest of the pinned entry', () => {
    const transformed = transformProductShellEntry(main, '/product/ui/product-shell.ts');
    expect(transformed).toContain('installDocumentTitle(wasm);');
    expect(transformed).toContain('__hwplyApplyAccessibleName(initI18n());');
    const restored = transformed.replace(
      'import { installDocumentTitle, applyProductAccessibleName as __hwplyApplyAccessibleName } from "/product/ui/product-shell.ts";',
      titleImport,
    ).replace('__hwplyApplyAccessibleName(initI18n());', localeEntry);
    expect(restored).toBe(main);
    expect(ts.transpileModule(transformed, { reportDiagnostics: true }).diagnostics).toEqual([]);
  });

  it('applies the product label after the upstream initializer result', () => {
    const transformed = transformProductShellEntry(`${titleImport}\n${localeEntry}`, '/product/shell.ts');
    const init = vi.fn(() => 'en');
    const apply = vi.fn();
    new Function('initI18n', '__hwplyApplyAccessibleName', transformed.split('\n').slice(1).join('\n'))(init, apply);
    expect(apply).toHaveBeenCalledWith('en');
    expect(init.mock.invocationCallOrder[0]).toBeLessThan(apply.mock.invocationCallOrder[0]);
  });

  it.each([titleImport, localeEntry])('refuses missing or repeated %s markers', (marker) => {
    expect(() => transformProductShellEntry(main.replace(marker, ''), '/shell.ts')).toThrow('marker mismatch');
    expect(() => transformProductShellEntry(`${main}\n${marker}`, '/shell.ts')).toThrow('marker mismatch');
  });

  it('refuses applying the hook twice', () => {
    const transformed = transformProductShellEntry(main, '/shell.ts');
    expect(() => transformProductShellEntry(transformed, '/shell.ts')).toThrow('marker mismatch');
  });
});
