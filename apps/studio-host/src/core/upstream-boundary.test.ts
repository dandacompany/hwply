import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  hwplyOverrideSpecs,
  createHwplyOverrides,
  finalForbiddenOverrideIds,
  finalForbiddenStudioEntryPaths,
  type HwplyOverrideSpec,
} from '../../hwply-overrides';
import { DESKTOP_CSP_INLINE_HIDDEN_SELECTORS } from './desktop-toolbar-mode-sync';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const expectedUpstreamCommit = '1a76570e833917d15817415a53c09ad61ab3203f';
const expectedIdsByOwner = {
  'font-policy': [
    'core/font-loader',
    'core/local-fonts',
    'core/wasm-bridge',
  ],
  'native-host': [
    'core/document-files',
    'core/document-dirty-state',
    'core/desktop-events',
    'core/platform',
    'command/dispatcher',
    'command/commands/file',
    'embed/runtime',
    'recent/recent-store',
  ],
  'product-ux': [
    'ui/about-dialog',
  ],
  'legacy-upstream-copy': [],
} as const;

const expectedFinalLeafAdapters = [
  'core/font-loader',
  'core/local-fonts',
  'core/wasm-bridge',
  'core/document-files',
  'core/document-dirty-state',
  'core/desktop-events',
  'core/platform',
  'command/dispatcher',
  'command/commands/file',
  'embed/runtime',
  'ui/about-dialog',
  'recent/recent-store',
] as const;

const removedStageThreePaths = [
  'src/core/bridge-factory.ts',
  'src/core/tauri-bridge.ts',
  'src/core/font-application.ts',
  'src/command/shortcut-map.ts',
  'src/command/commands/edit.ts',
  'src/command/commands/format.ts',
] as const;

const removedStageTwoPaths = [
  'index.html',
  'src/main.ts',
  'src/core/desktop-chrome.ts',
  'src/ui/custom-select.ts',
  'src/ui/dialog.ts',
  'src/ui/home-screen.ts',
  'src/ui/preview-svg.ts',
  'src/ui/print-dialog.ts',
  'src/ui/recent-documents-dialog.ts',
  'src/ui/style-edit-dialog.ts',
  'src/ui/toolbar.ts',
  'src/ui/validation-modal.ts',
  'src/view/hwply-page-renderer.ts',
  'src/view/canvas-layout.ts',
  'src/view/canvas-view.ts',
  'src/view/page-left.ts',
  'src/view/page-overlays.ts',
  'src/view/ruler.ts',
  'src/styles/about-dialog.css',
  'src/styles/custom-select.css',
  'src/styles/font-set-dialog.css',
  'src/styles/home-screen.css',
  'src/styles/recent-documents-dialog.css',
] as const;

describe('upstream Studio override boundary', () => {
  it('connects the relative local-font consumers in both production and test configs', () => {
    for (const config of ['vite.config.ts', 'vitest.config.ts']) {
      const source = readFileSync(resolve(repositoryRoot, 'apps/studio-host', config), 'utf8');
      expect(source).toContain("from './local-font-overrides'");
      expect(source).toContain('createHwplyLocalFontPlugin({ upstreamSrc, hwplySrc })');
      expect(source).toContain("from './product-shell-entry'");
      expect(source).toContain('createProductShellEntry(upstreamSrc, hwplySrc)');
    }
  });

  it('classifies the 12 remaining leaf aliases', () => {
    const ids = hwplyOverrideSpecs.map((spec) => spec.id);
    expect(ids).toHaveLength(12);
    expect(new Set(ids).size).toBe(12);
    for (const [owner, expectedIds] of Object.entries(expectedIdsByOwner)) {
      expect(
        hwplyOverrideSpecs
          .filter((spec) => spec.owner === owner)
          .map((spec) => spec.id),
      ).toEqual(expectedIds);
    }

    const replacements = createHwplyOverrides('/product/studio-src');
    expect(replacements.map(({ find }) => find)).toEqual(ids.map((id) => `@/${id}`));
    expect(replacements).toHaveLength(12);
    expect(replacements.find(({ find }) => find === '@/embed/runtime')?.replacement)
      .toBe(resolve('/product/studio-src', 'embed/desktop-runtime'));
    expect(replacements.find(({ find }) => find === '@/core/wasm-bridge')?.replacement)
      .toBe(resolve('/product/studio-src', 'core/font-policy-wasm-bridge'));
  });

  it('keeps removal stages and final leaf adapters explicit', () => {
    const specs = hwplyOverrideSpecs as readonly HwplyOverrideSpec[];
    for (const spec of specs) {
      if (spec.targetDisposition === 'remove-shadow') {
        expect(spec.removalStage).toBe(spec.transitionStage);
      } else {
        expect(spec.removalStage).toBeNull();
      }
    }

    const legacyCopies = specs
      .filter((spec) => spec.owner === 'legacy-upstream-copy');
    expect(legacyCopies).toEqual([]);

    const finalLeafAdapters = specs
      .filter((spec) => spec.targetDisposition !== 'remove-shadow')
      .map((spec) => spec.id);
    expect(finalLeafAdapters).toEqual(expectedFinalLeafAdapters);
    expect(finalForbiddenOverrideIds).toEqual(
      hwplyOverrideSpecs
        .filter((spec) => !expectedFinalLeafAdapters.includes(
          spec.id as (typeof expectedFinalLeafAdapters)[number],
        ))
        .map((spec) => spec.id),
    );
    expect(finalForbiddenStudioEntryPaths).toEqual(['index.html', 'src/main.ts']);
  });

  it('keeps every remaining override within the leaf adapter size boundary', () => {
    const replacements = createHwplyOverrides(resolve(repositoryRoot, 'apps/studio-host/src'));
    for (const { find, replacement } of replacements) {
      const source = readFileSync(`${replacement}.ts`, 'utf8');
      const lineCount = source.trimEnd().split(/\r?\n/).length;
      expect(lineCount, `${find} leaf adapter exceeds 300 LOC`).toBeLessThanOrEqual(300);
    }
  });

  it('keeps retired handler and platform bridges out of production boundaries', () => {
    const embedRuntime = readFileSync(resolve(
      repositoryRoot,
      'apps/studio-host/src/embed/desktop-runtime.ts',
    ), 'utf8');
    const platformAdapter = readFileSync(resolve(
      repositoryRoot,
      'apps/studio-host/src/core/platform.ts',
    ), 'utf8');
    const nativeCommands = readFileSync(resolve(
      repositoryRoot,
      'apps/desktop/src-tauri/src/commands.rs',
    ), 'utf8');
    const nativeEntry = readFileSync(resolve(
      repositoryRoot,
      'apps/desktop/src-tauri/src/lib.rs',
    ), 'utf8');
    expect(embedRuntime).toContain('waitForDesktopStudioHandlers');
    expect(embedRuntime).not.toContain('getDesktopStudioHandlers');
    expect(platformAdapter).toContain('detectDesktopPlatform');
    expect(platformAdapter).not.toContain('hydrateDesktopPlatform');
    expect(nativeCommands).not.toContain('desktop_platform');
    expect(nativeEntry).not.toContain('desktop_platform');
  });

  it('keeps the Stage 2 Studio entry and renderer shadows physically absent', () => {
    const studioHostRoot = resolve(repositoryRoot, 'apps/studio-host');
    for (const path of removedStageTwoPaths) {
      expect(existsSync(resolve(studioHostRoot, path)), path).toBe(false);
    }
  });

  it('maps every upstream inline-hidden entry element to a CSP-safe product owner', () => {
    const upstreamIndex = readFileSync(resolve(
      repositoryRoot,
      'third_party/rhwp/rhwp-studio/index.html',
    ), 'utf8');
    const productStyle = readFileSync(resolve(
      repositoryRoot,
      'apps/studio-host/src/style.css',
    ), 'utf8');

    // Upstream can migrate an inline style to native hidden without requiring a
    // product owner. Every remaining CSP-sensitive inline style must be owned.
    for (const selector of inlineHiddenSelectors(upstreamIndex)) {
      expect(DESKTOP_CSP_INLINE_HIDDEN_SELECTORS).toContain(selector);
    }
    for (const selector of ['#file-input', '#sb-field:empty']) {
      expect(productStyle).toContain(selector);
    }
    for (const selector of DESKTOP_CSP_INLINE_HIDDEN_SELECTORS.slice(0, 3)) {
      expect(productStyle).toContain(`html:not(.hwply-toolbar-ready) ${selector}`);
    }
    expect(productStyle).toContain('.hwply-toolbar-hidden');
  });

  it('pins redistributable PDF fonts and keeps the UI fallback in the web bundle', () => {
    const fontAssets = [
      {
        path: 'assets/fonts/pdf/NotoSansKR-Regular.otf',
        sha256: '69975a0ac8472717870aefeab0a4d52739308d90856b9955313b2ad5e0148d68',
        license: 'assets/fonts/licenses/NotoSansKR-OFL-1.1.txt',
      },
      {
        path: 'assets/fonts/pdf/NotoSerifKR-Regular.otf',
        sha256: '5ea012e15cb7eacc1f680aee1703f3b164791b1443ea3e52b65080cca5d179cf',
        license: 'assets/fonts/licenses/NotoSerifKR-OFL-1.1.txt',
      },
    ] as const;
    const manifest = readFileSync(resolve(repositoryRoot, 'assets/fonts/FONTS.md'), 'utf8');
    const desktopConfig = JSON.parse(readFileSync(resolve(
      repositoryRoot,
      'apps/desktop/src-tauri/tauri.conf.json',
    ), 'utf8')) as { bundle: { resources: Record<string, string> } };
    const productStyle = readFileSync(resolve(
      repositoryRoot,
      'apps/studio-host/src/style.css',
    ), 'utf8');

    for (const asset of fontAssets) {
      const bytes = readFileSync(resolve(repositoryRoot, asset.path));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
      expect(readFileSync(resolve(repositoryRoot, asset.license), 'utf8'))
        .toContain('SIL OPEN FONT LICENSE Version 1.1');
      expect(manifest).toContain(`\`${asset.path.replace('assets/fonts/', '')}\``);
      expect(manifest).toContain(`\`${asset.sha256}\``);
      expect(desktopConfig.bundle.resources[`../../../${asset.license}`])
        .toBe(`licenses/fonts/${asset.license.slice(asset.license.lastIndexOf('/') + 1)}`);
    }
    expect(desktopConfig.bundle.resources['../../../assets/fonts/FONTS.md'])
      .toBe('licenses/fonts/FONTS.md');
    expect(productStyle).toContain("font-family: 'hwply UI Fallback'");
    expect(productStyle).toContain("url('./fonts/NotoSansKR-Regular.woff2')");
    expect(productStyle).toMatch(
      /'Malgun Gothic', 'Segoe UI',\s*'hwply UI Fallback'/,
    );
  });

  it('keeps the Stage 3 native WasmBridge fork and command shadows physically absent', () => {
    const studioHostRoot = resolve(repositoryRoot, 'apps/studio-host');
    for (const path of removedStageThreePaths) {
      expect(existsSync(resolve(studioHostRoot, path)), path).toBe(false);
    }
    expect(finalForbiddenOverrideIds).toEqual([]);
  });

  it('pins upstream printing to the dedicated page SVG preview surface', () => {
    const upstreamCommand = readFileSync(resolve(
      repositoryRoot,
      'third_party/rhwp/rhwp-studio/src/command/commands/file.ts',
    ), 'utf8');
    const upstreamSurface = readFileSync(resolve(
      repositoryRoot,
      'third_party/rhwp/rhwp-studio/src/command/print-surface.ts',
    ), 'utf8');

    expect(upstreamCommand).toContain("id: 'file:print'");
    expect(upstreamCommand).toContain('await runPrintPreview(services)');
    expect(upstreamCommand).toContain("renderPageSvgWithProfile(i, 'print')");
    expect(upstreamCommand).toContain('const surfacePromise = createPrintPreviewSurface()');
    expect(upstreamCommand).toContain(
      'setupPrintDocument(surface.document, wasm.fileName, printPages, surface.window)',
    );
    expect(upstreamCommand).toContain(
      "printButton.addEventListener('click', () => printWindow.print())",
    );
    expect(upstreamSurface).toContain("hostWindow.open(surfaceUrl, '_blank')");
  });

  it('uses the top-level product page surface only for Tauri direct printing', () => {
    const desktopConfig = JSON.parse(readFileSync(resolve(
      repositoryRoot,
      'apps/desktop/src-tauri/tauri.conf.json',
    ), 'utf8')) as {
      app: {
        windows: Array<{ label: string; create?: boolean }>;
        security: { csp: string; devCsp: string };
      };
    };
    const windowsConfig = JSON.parse(readFileSync(resolve(
      repositoryRoot,
      'apps/desktop/src-tauri/tauri.windows.conf.json',
    ), 'utf8')) as { app: { windows: Array<{ label: string; create?: boolean }> } };
    const nativeWindows = readFileSync(resolve(
      repositoryRoot,
      'apps/desktop/src-tauri/src/windows.rs',
    ), 'utf8');
    const nativeCommands = readFileSync(resolve(
      repositoryRoot,
      'apps/desktop/src-tauri/src/commands.rs',
    ), 'utf8');
    const nativeEntry = readFileSync(resolve(
      repositoryRoot,
      'apps/desktop/src-tauri/src/lib.rs',
    ), 'utf8');
    const localFileCommand = readFileSync(resolve(
      repositoryRoot,
      'apps/studio-host/src/command/commands/file.ts',
    ), 'utf8');
    const directPrint = readFileSync(resolve(
      repositoryRoot,
      'apps/studio-host/src/command/direct-print.ts',
    ), 'utf8');
    const upstreamPrintSurface = readFileSync(resolve(
      repositoryRoot,
      'third_party/rhwp/rhwp-studio/src/command/print-surface.ts',
    ), 'utf8');
    const productStyle = readFileSync(resolve(
      repositoryRoot,
      'apps/studio-host/src/style.css',
    ), 'utf8');

    expect(desktopConfig.app.windows[0]).toMatchObject({ label: 'main' });
    expect(desktopConfig.app.windows[0].create).toBeUndefined();
    expect(desktopConfig.app.security.csp).toContain("frame-ancestors 'self'");
    expect(desktopConfig.app.security.devCsp).toContain("frame-ancestors 'self'");
    expect(windowsConfig.app.windows[0]).toMatchObject({ label: 'main' });
    expect(windowsConfig.app.windows[0].create).toBeUndefined();
    expect(nativeEntry).toContain('app.get_webview_window("main")');
    expect(nativeEntry).not.toContain('create_initial_editor_window');
    expect(nativeWindows).not.toContain('.on_new_window(');
    expect(existsSync(resolve(
      repositoryRoot,
      'apps/desktop/src-tauri/src/print_preview.rs',
    ))).toBe(false);

    expect(localFileCommand).toContain("['file:print', async (services) => {");
    expect(localFileCommand).toContain('printDirectlyFromPageSurface(services)');
    expect(directPrint).toContain('createHostPrintSurface(printPages, platform)');
    expect(directPrint).toContain("renderPageSvgWithProfile(pageIndex, 'print')");
    expect(directPrint).toContain('createPrintPage(');
    expect(directPrint).toContain('appendSvgPage(document, container, page)');
    expect(directPrint).toContain('await waitForPrintSurfaceReady(surface)');
    expect(directPrint).toContain("const NATIVE_PRINT_COMMAND = 'print_current_webview'");
    expect(directPrint).toContain("if (platform === 'linux')");
    expect(directPrint).toContain('await invoke(NATIVE_PRINT_COMMAND)');
    expect(directPrint).toContain('window.print()');
    expect(directPrint).toContain("const HOST_PRINT_SURFACE_ID = 'hwply-direct-print-surface'");
    expect(directPrint).toContain(
      "const PRODUCT_STYLE_SELECTOR = 'style[data-hwply-product-style=\"true\"]'",
    );
    expect(directPrint).not.toContain('createPrintSurface()');
    expect(nativeCommands).toContain('pub async fn print_current_webview(window: WebviewWindow)');
    expect(nativeCommands).toContain('crate::system_print::print_current_webview(window).await');
    const systemPrint = readFileSync(resolve(
      repositoryRoot,
      'apps/desktop/src-tauri/src/system_print.rs',
    ), 'utf8');
    expect(systemPrint).toContain('.with_webview(move |platform_webview|');
    expect(systemPrint).toContain('operation.connect_failed');
    expect(systemPrint).toContain('operation.connect_finished');
    expect(systemPrint).toContain('PrintOperationResponse::Cancel');
    expect(systemPrint).toContain('state.keepalive.take()');
    expect(systemPrint).toContain('timeout_add_local_once(PRINT_COMPLETION_TIMEOUT');
    expect(systemPrint).toContain('operation.run_dialog(Some(&parent))');
    expect(nativeEntry).toContain('print_current_webview,');
    expect(upstreamPrintSurface).toContain("const PRINT_FRAME_ID = 'rhwp-print-surface';");
    expect(productStyle).toContain('#rhwp-print-surface');
    expect(productStyle).toContain('#hwply-direct-print-surface');
    expect(productStyle).toContain('html.hwply-print-active');
    expect(productStyle).toMatch(
      /#hwply-direct-print-surface\s*\{[^}]*z-index: -1 !important;[^}]*\}/,
    );
    expect(productStyle).not.toMatch(
      /#hwply-direct-print-surface\s*\{[^}]*opacity: 0 !important;[^}]*\}/,
    );
    expect(productStyle).toContain('opacity: 0 !important');
    expect(productStyle).toContain('opacity: 1 !important');
  });

  it('pins the source lock and read-only submodule worktree to the resolved release commit', () => {
    const lock = readFileSync(resolve(repositoryRoot, 'rhwp-core.lock'), 'utf8');
    const lockCommit = lock.match(/^rhwp_commit = "([0-9a-f]{40})"$/m)?.[1];
    const releaseTag = lock.match(/^rhwp_release_tag = "([^"]+)"$/m)?.[1];
    expect(lockCommit).toBe(expectedUpstreamCommit);
    expect(releaseTag).toBe('v0.8.7');

    const submoduleRoot = resolve(repositoryRoot, 'third_party/rhwp');
    expect(git(['rev-parse', 'HEAD'], submoduleRoot)).toBe(expectedUpstreamCommit);
    expect(git(['rev-parse', '--verify', `refs/tags/${releaseTag}^{commit}`], submoduleRoot))
      .toBe(expectedUpstreamCommit);
    expect(git(['status', '--porcelain', '--untracked-files=all'], submoduleRoot)).toBe('');
  });
});

function inlineHiddenSelectors(indexHtml: string): string[] {
  return Array.from(indexHtml.matchAll(/<[^>]+style="display:none"[^>]*>/g), ([markup]) => {
    const id = markup.match(/\sid="([^"]+)"/)?.[1];
    if (id) return `#${id}`;

    const classNames = markup.match(/\sclass="([^"]+)"/)?.[1].split(/\s+/) ?? [];
    const stateClass = [...classNames]
      .reverse()
      .find((name) => name !== 'tb-group' && name.endsWith('-group'));
    if (stateClass) return `.${stateClass}`;
    throw new Error(`inline-hidden element has no managed selector: ${markup}`);
  });
}

function git(args: string[], cwd = repositoryRoot): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}
