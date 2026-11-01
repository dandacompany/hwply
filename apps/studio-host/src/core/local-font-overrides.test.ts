import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, createServer, normalizePath } from 'vite';
import { describe, expect, it } from 'vitest';
import { createHwplyOverrides } from '../../hwply-overrides';
import {
  createHwplyLocalFontPlugin,
  resolvehwplyLocalFontImport,
} from '../../local-font-overrides';

const hostRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const upstreamSrc = resolve(hostRoot, '../../third_party/rhwp/rhwp-studio/src');
const hwplySrc = resolve(hostRoot, 'src');
const paths = { upstreamSrc, hwplySrc };
const adapter = normalizePath(resolve(hwplySrc, 'core/local-fonts.ts'));
const consumers = ['document-font-status', 'font-substitution',
  'host-font-requests', 'host-canvas-fonts', 'wasm-bridge'];
const existingConsumers = ['document-font-status', 'font-substitution'];

function config() {
  return {
    configFile: false as const,
    root: hostRoot,
    logLevel: 'silent' as const,
    plugins: [createHwplyLocalFontPlugin(paths)],
    resolve: { alias: createHwplyOverrides(hwplySrc) },
  };
}

describe('local-font import boundary', () => {
  it.each(consumers)('redirects only the exact %s consumer', (name) => {
    const importer = resolve(upstreamSrc, `core/${name}.ts`);
    expect(resolvehwplyLocalFontImport('./local-fonts.ts', importer, paths)).toBe(adapter);
    expect(resolvehwplyLocalFontImport('./local-fonts', importer, paths)).toBe(adapter);
    expect(resolvehwplyLocalFontImport('./local-fonts.ts', `${importer}?v=1`, paths))
      .toBe(adapter);
    expect(resolvehwplyLocalFontImport('./local-fonts.ts', importer.replaceAll('/', '\\'), paths))
      .toBe(adapter);
  });

  it.each([
    [undefined, './local-fonts.ts'],
    [resolve(hwplySrc, 'core/document-font-status.ts'), './local-fonts.ts'],
    [resolve(upstreamSrc, 'core/other.ts'), './local-fonts.ts'],
    [resolve(upstreamSrc, '../other/core/document-font-status.ts'), './local-fonts.ts'],
    [resolve(upstreamSrc, 'core/document-font-status.ts'), './local-fonts.ts?raw'],
    [resolve(upstreamSrc, 'core/document-font-status.ts'), './font-loader.ts'],
  ])('leaves unrelated imports unchanged (%s, %s)', (importer, source) => {
    expect(resolvehwplyLocalFontImport(source, importer, paths)).toBeNull();
  });

  it('resolves relative and alias imports to one module in the Vite dev container', async () => {
    const server = await createServer({
      ...config(),
      server: { middlewareMode: true, watch: null, ws: false },
      optimizeDeps: { noDiscovery: true, include: [] },
    });
    try {
      const container = server.environments.client.pluginContainer;
      const alias = await container.resolveId('@/core/local-fonts', resolve(upstreamSrc, 'main.ts'));
      expect(alias?.id).toBe(adapter);
      for (const name of consumers) {
        const relative = await container.resolveId(
          './local-fonts.ts', resolve(upstreamSrc, `core/${name}.ts`),
        );
        expect(relative?.id).toBe(alias?.id);
      }
    } finally {
      await server.close();
    }
  });

  it('builds real consumers without bundling a second upstream font state', async () => {
    const entry = '\0hwply-font-consumer-test';
    const result = await build({
      ...config(),
      plugins: [
        ...config().plugins,
        {
          name: 'font-consumer-test-entry',
          resolveId: (id) => id === entry ? entry : null,
          load: (id) => id === entry ? [
            "export { detectLocalFonts } from '@/core/local-fonts';",
            `export { analyzeDocumentFonts } from ${JSON.stringify(normalizePath(resolve(upstreamSrc, 'core/document-font-status.ts')))};`,
            `export { fontFamilyChainForDisplay } from ${JSON.stringify(normalizePath(resolve(upstreamSrc, 'core/font-substitution.ts')))};`,
          ].join('\n') : null,
        },
      ],
      build: {
        write: false,
        minify: false,
        rollupOptions: {
          input: entry,
          external: ['@tauri-apps/api/core'],
          preserveEntrySignatures: 'strict',
        },
      },
    });
    if ('on' in result) throw new Error('unexpected watch build');
    const outputs = Array.isArray(result) ? result : [result];
    const modules = outputs.flatMap(({ output }) => output.flatMap((item) =>
      item.type === 'chunk' ? Object.keys(item.modules) : []));
    expect(modules.filter((id) => id.endsWith('/core/local-fonts.ts'))).toEqual([adapter]);
    for (const name of existingConsumers) {
      expect(modules).toContain(normalizePath(resolve(upstreamSrc, `core/${name}.ts`)));
    }
  });
});
