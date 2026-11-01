import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import { createHwplyOverrides } from './hwply-overrides';
import { createHwplyLocalFontPlugin } from './local-font-overrides';
import { createLocalFontEntryHooks } from './local-font-entry-hooks';
import { createProductShellEntry } from './product-shell-entry';
import { createProductDefines } from './product-defines';

const upstreamSrc = resolve(__dirname, '../../third_party/rhwp/rhwp-studio/src');
const hwplySrc = resolve(__dirname, 'src');
const rhwpWasmModule = resolve(__dirname, 'vendor/rhwp-core/rhwp.js');

export default defineConfig({
  define: createProductDefines(__dirname),
  plugins: [
    createHwplyLocalFontPlugin({ upstreamSrc, hwplySrc }),
    createLocalFontEntryHooks(upstreamSrc, hwplySrc),
    createProductShellEntry(upstreamSrc, hwplySrc),
  ],
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
    clearMocks: true,
    restoreMocks: true,
  },
  resolve: {
    alias: [
      ...createHwplyOverrides(hwplySrc),
      { find: '@wasm/rhwp.js', replacement: rhwpWasmModule },
      { find: '@upstream', replacement: upstreamSrc },
      { find: '@', replacement: upstreamSrc },
    ],
  },
});
