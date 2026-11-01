import { createProductDefines } from './product-defines';
import { defineConfig, normalizePath } from 'vite';
import { basename, dirname, relative, resolve } from 'node:path';
import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import type { Plugin } from 'vite';
import { createHwplyOverrides } from './hwply-overrides';
import { createHwplyLocalFontPlugin } from './local-font-overrides';
import { createLocalFontEntryHooks } from './local-font-entry-hooks';
import { createProductShellEntry } from './product-shell-entry';
import { createDesktopStartupEntry } from './desktop-startup-entry';
import { insertStudioMenuItem } from './studio-menu-hooks';

const desktopConfig = JSON.parse(
  readFileSync(resolve(__dirname, '../desktop/src-tauri/tauri.conf.json'), 'utf-8'),
);
const upstreamStudioDir = resolve(__dirname, '../../third_party/rhwp/rhwp-studio');
const upstreamSrc = resolve(__dirname, '../../third_party/rhwp/rhwp-studio/src');
const hwplySrc = resolve(__dirname, 'src');
const productStylePath = resolve(__dirname, 'src/style.css');
const productIconPath = resolve(__dirname, 'public/favicon.ico');
const rhwpWasmModule = normalizePath(resolve(__dirname, 'vendor/rhwp-core/rhwp.js'));
const rhwpWasmDir = dirname(rhwpWasmModule);
const rhwpWasmPackage = JSON.parse(readFileSync(resolve(rhwpWasmDir, 'package.json'), 'utf-8'));
const fontAssetsDir = resolve(__dirname, '../../assets/fonts');

function hwplyFontAssets(): Plugin {
  return {
    name: 'hwply-font-assets',
    configureServer(server) {
      server.middlewares.use('/fonts', (req, res, next) => {
        const fontName = basename(decodePath(req.url?.split('?')[0] ?? ''));
        if (!fontName.endsWith('.woff2')) {
          next();
          return;
        }

        const fontPath = resolve(fontAssetsDir, fontName);
        const relativeFontPath = relative(fontAssetsDir, fontPath);
        if (relativeFontPath.startsWith('..') || relativeFontPath === '' || !existsSync(fontPath)) {
          next();
          return;
        }

        res.setHeader('Content-Type', 'font/woff2');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        createReadStream(fontPath).pipe(res);
      });
    },
    closeBundle() {
      // 산출물이 없으면(실패한 빌드) 복사하지 않는다. 훅에서 던지면 진짜 빌드 오류를 가린다(2026-10-30 Windows CI 실측).
      if (!existsSync(resolve(__dirname, 'dist'))) {
        console.warn('[hwply-font-assets] dist 가 없어 글꼴 복사를 건너뜁니다');
        return;
      }
      const outDir = resolve(__dirname, 'dist/fonts');
      mkdirSync(outDir, { recursive: true });
      for (const fileName of readdirSync(fontAssetsDir)) {
        const source = resolve(fontAssetsDir, fileName);
        if (!fileName.endsWith('.woff2') || !statSync(source).isFile()) continue;
        copyFileSync(source, resolve(outDir, fileName));
      }
    },
  };
}

function hwplyDesktopShell(): Plugin {
  return {
    name: 'hwply-desktop-shell',
    configureServer(server) {
      server.middlewares.use('/favicon.ico', (_req, res) => {
        res.setHeader('Content-Type', 'image/x-icon');
        createReadStream(productIconPath).pipe(res);
      });
    },
    transformIndexHtml(html) {
      const withTitle = replaceRequired(
        html,
        '<title>rhwp-studio</title>',
        '<title>hwply</title>',
        'document title',
      );
      const withAccessibleName = replaceRequired(
        withTitle,
        'rhwp-studio 문서 편집기',
        'hwply 문서 편집기',
        'editor accessible name',
      );
      return {
        html: insertStudioMenuItem(
          withAccessibleName,
          'file:new-doc',
          '<div class="md-item" data-cmd="file:new-window"><span class="md-icon"></span><span class="md-label">새 창</span><span class="md-shortcut">Ctrl+Shift+N</span></div>',
        ),
        tags: [
          {
            tag: 'style',
            attrs: { 'data-hwply-product-style': 'true' },
            children: readFileSync(productStylePath, 'utf8'),
            injectTo: 'head',
          },
        ],
      };
    },
    closeBundle() {
      // 산출물이 없으면(실패한 빌드) 복사하지 않는다. 훅에서 던지면 진짜 빌드 오류를 가린다(2026-10-30 Windows CI 실측).
      if (!existsSync(resolve(__dirname, 'dist'))) {
        console.warn('[hwply-desktop-shell] dist 가 없어 favicon 복사를 건너뜁니다');
        return;
      }
      copyFileSync(productIconPath, resolve(__dirname, 'dist/favicon.ico'));
    },
  };
}

function replaceRequired(
  html: string,
  marker: string,
  replacement: string,
  label: string,
): string {
  const matches = html.split(marker).length - 1;
  if (matches !== 1) {
    throw new Error(`upstream HTML ${label} marker count must be 1, got ${matches}`);
  }
  return html.replace(marker, replacement);
}

function decodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return '';
  }
}

export default defineConfig({
  base: './',
  root: upstreamStudioDir,
  cacheDir: resolve(__dirname, 'node_modules/.vite'),
  plugins: [
    createHwplyLocalFontPlugin({ upstreamSrc, hwplySrc }),
    createLocalFontEntryHooks(upstreamSrc, hwplySrc),
    createProductShellEntry(upstreamSrc, hwplySrc),
    createDesktopStartupEntry(upstreamSrc, hwplySrc),
    hwplyDesktopShell(),
    hwplyFontAssets(),
  ],
  define: {
    // Use upstream's standalone Studio build; hwply does not host the OCX plugin.
    __RHWP_HWPCTRL__: 'false',
    __APP_VERSION__: JSON.stringify(rhwpWasmPackage.version),
    ...createProductDefines(__dirname),
  },
  resolve: {
    alias: [
      ...createHwplyOverrides(hwplySrc),
      { find: '@wasm/rhwp.js', replacement: rhwpWasmModule },
      {
        find: '@noble/hashes',
        replacement: resolve(__dirname, 'node_modules/@noble/hashes'),
      },
      {
        find: 'canvaskit-wasm',
        replacement: resolve(__dirname, 'node_modules/canvaskit-wasm'),
      },
      { find: '@upstream', replacement: upstreamSrc },
      { find: '@', replacement: upstreamSrc },
    ],
  },
  server: {
    host: '127.0.0.1',
    port: 7700,
    // Tauri devUrl 이 7700 에 고정이다. 다른 서버가 7700 을 쥐고 있으면 조용히 7701 로 비켜서는 대신 실패한다.
    strictPort: true,
    fs: {
      allow: [
        __dirname,
        rhwpWasmDir,
        fontAssetsDir,
        upstreamStudioDir,
      ],
    },
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
});
