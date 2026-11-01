import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { transformLocalFontEntry } from '../../local-font-entry-hooks';

const main = readFileSync(resolve(__dirname, '../../../../third_party/rhwp/rhwp-studio/src/main.ts'), 'utf8');

describe('pinned local-font entry hooks', () => {
  it('adds only the two hooks and keeps the original browser function bodies', () => {
    const result = transformLocalFontEntry(main, '/product/core/local-font-controller.ts');
    expect(result).toContain('if (await __hwplyPromptFonts()) return;');
    expect(result.indexOf('await __hwplyPrepareFonts({')).toBeLessThan(
      result.indexOf("console.log('[initDoc] 1. 폰트 로딩 시작')"),
    );
    expect(result).toContain('await view?.refreshFontResources();');
    expect(result).not.toContain('session?.invalidateDocument();');
    expect(result).not.toContain('await view?.loadDocument();');
    const code = ts.transpileModule(result, { reportDiagnostics: true, compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    } });
    expect(code.diagnostics).toEqual([]);
    const originalAst = ts.createSourceFile('upstream.ts', main, ts.ScriptTarget.Latest, true);
    const originalPrompt = originalAst.statements.find((node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === 'promptLocalFontsIfNeeded');
    expect(result).toContain(originalPrompt!.body!.getText(originalAst).slice(1, -1));
    const hook = result.slice(result.indexOf('await __hwplyPrepareFonts({'), result.indexOf("console.log('[initDoc] 1. 폰트 로딩 시작')"));
    expect(hook).not.toContain('documentState');
  });

  it('returns from the real upstream prompt before browser font logic in Tauri', async () => {
    const result = transformLocalFontEntry(main, '/controller.ts');
    const ast = ts.createSourceFile('main.ts', result, ts.ScriptTarget.Latest, true);
    const prompt = ast.statements.find((node) => ts.isFunctionDeclaration(node)
      && node.name?.text === 'promptLocalFontsIfNeeded')!;
    const code = ts.transpileModule(prompt.getText(ast), { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    } }).outputText;
    const run = new Function('__hwplyPromptFonts', `${code}; return promptLocalFontsIfNeeded;`);
    await expect(run(async () => true)({ fontsUsed: ['Local Test'] }, 'test.hwp')).resolves.toBeUndefined();
    await expect(run(async () => false)({ fontsUsed: [] }, 'test.hwp')).resolves.toBeUndefined();
  });

  it('rejects missing, duplicate and already transformed entry markers', () => {
    expect(() => transformLocalFontEntry(main.replace('async function initializeDocument(', 'async function changed('), '/controller.ts')).toThrow('marker mismatch');
    expect(() => transformLocalFontEntry(`${main}\n${main}`, '/controller.ts')).toThrow('marker mismatch');
    expect(() => transformLocalFontEntry(transformLocalFontEntry(main, '/controller.ts'), '/controller.ts')).toThrow('duplicate');
  });
  it('refreshes font resources without reloading the document and paints after font preparation', async () => {
    const calls: string[] = [];
    let key = 'before';
    const renderer = { prepareLocalFonts: async () => { calls.push('prepare-fonts'); } };
    const view = { refreshFontResources: async () => { calls.push('refresh-fonts'); key = 'after'; },
      loadDocument: async () => { calls.push('reload-document'); }, getRenderBackend: () => 'canvaskit' };
    const session = { invalidateDocument: () => { calls.push('invalidate-document'); },
      getCanvasKitRenderer: () => renderer, diagnostics: () => ({ decisionKey: key }) };
    const binding = fontBinding({ docInfo: { fontsUsed: ['Abel'] }, rendererSession: session,
      canvasView: view, eventBus: { emit: (name: string) => { calls.push(name); } }, analyzeDocumentFonts: () => ({}) });
    await binding.refreshView(() => true);
    expect(calls).toEqual(['refresh-fonts', 'prepare-fonts', 'document-view-changed']);
  });

  it('does not paint a replaced document after awaiting local fonts', async () => {
    const calls: string[] = [];
    let current = true;
    const renderer = { prepareLocalFonts: async () => { current = false; } };
    const view = { refreshFontResources: async () => {}, getRenderBackend: () => 'canvaskit' };
    const session = { getCanvasKitRenderer: () => renderer, diagnostics: () => ({ decisionKey: 'current' }) };
    const binding = fontBinding({ docInfo: { fontsUsed: ['Abel'] }, rendererSession: session,
      canvasView: view, eventBus: { emit: (name: string) => { calls.push(name); } }, analyzeDocumentFonts: () => ({}) });
    await binding.refreshView(() => current);
    expect(calls).toEqual([]);
  });

});

function fontBinding(scope: Record<string, unknown>): { refreshView(isCurrent: () => boolean): Promise<void> } {
  const source = transformLocalFontEntry(main, '/controller.ts');
  const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  let binding: ts.Expression | undefined;
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === '__hwplyPrepareFonts') {
      binding = node.arguments[0];
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (!binding) throw new Error('missing native font binding');
  const code = ts.transpileModule(`const binding = ${binding.getText(ast)};`, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
  } }).outputText;
  return new Function('scope', `const {docInfo,rendererSession,canvasView,eventBus,analyzeDocumentFonts}=scope;
    ${code}; return binding;`)(scope);
}
