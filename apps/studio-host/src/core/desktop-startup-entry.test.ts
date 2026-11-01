import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { transformDesktopStartup } from '../../desktop-startup-entry';

const source = `async function openBlankDocumentIfIdle(): Promise<void> {
  await createNewDocument();
}`;

describe('desktop startup document ownership', () => {
  it('keeps browser automatic creation but prevents a native document without its Rust session', async () => {
    const transformed = transformDesktopStartup(source, '/product/platform.ts');
    const body = transformed.slice(transformed.indexOf('async function'));
    const code = ts.transpileModule(body, { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    } }).outputText;
    const create = vi.fn();
    const factory = new Function('__hwplyNativeStartup', 'createNewDocument',
      `${code}; return openBlankDocumentIfIdle;`);
    await factory(() => true, create)();
    expect(create).not.toHaveBeenCalled();
    await factory(() => false, create)();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('refuses missing, duplicate, or already transformed startup entry points', () => {
    expect(() => transformDesktopStartup('', '/platform.ts')).toThrow('marker mismatch');
    expect(() => transformDesktopStartup(source + source, '/platform.ts')).toThrow('marker mismatch');
    expect(() => transformDesktopStartup(transformDesktopStartup(source, '/platform.ts'), '/platform.ts'))
      .toThrow('marker mismatch');
  });
});
