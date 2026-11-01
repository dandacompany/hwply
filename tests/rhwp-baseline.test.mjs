import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { readRhwpPin } from '../scripts/verify-rhwp-pin.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const rhwpPin = await readRhwpPin({ repoRoot });
const expectedRhwpVersion = rhwpPin.rhwp_release_tag.slice(1);
const expectedRhwpCommit = rhwpPin.rhwp_commit;

test('hwply keeps the rhwp renderer baseline aligned across submodule, vendored WASM, and native lockfile', async () => {
  const wasmPackage = JSON.parse(
    await readFile(join(repoRoot, 'apps/studio-host/vendor/rhwp-core/package.json'), 'utf8'),
  );
  assert.equal(wasmPackage.version, expectedRhwpVersion);
  const wasmBytes = await readFile(join(repoRoot, 'apps/studio-host/vendor/rhwp-core/rhwp_bg.wasm'));
  assert.ok(wasmBytes.length > 0, 'vendored rhwp WASM should be present');

  const pnpmLock = await readFile(join(repoRoot, 'pnpm-lock.yaml'), 'utf8');
  assert.doesNotMatch(pnpmLock, /@rhwp\/core@/);

  const cargoLock = await readFile(join(repoRoot, 'apps/desktop/src-tauri/Cargo.lock'), 'utf8');
  assert.match(
    cargoLock,
    new RegExp(`name = "rhwp"\\r?\\nversion = "${escapeRegExp(expectedRhwpVersion)}"`),
  );

  const submoduleStatus = git(['submodule', 'status', 'third_party/rhwp']).stdout.trim();
  assert.match(submoduleStatus, new RegExp(`^[ +-]?${expectedRhwpCommit} third_party/rhwp\\b`));
});

test('hwply inherits the upstream lineseg validation policy without a local modal shadow', async () => {
  const mainSource = await readFile(join(repoRoot, 'third_party/rhwp/rhwp-studio/src/main.ts'), 'utf8');
  const overrides = await readFile(join(repoRoot, 'apps/studio-host/hwply-overrides.ts'), 'utf8');

  assert.match(mainSource, /wasm\.getSourceFormat\(\) === ['"]hwpx['"]/);
  assert.match(mainSource, /const report = wasm\.getValidationWarnings\(\)/);
  assert.match(mainSource, /warnings — 그대로 보기/);
  assert.doesNotMatch(mainSource, /wasm\.reflowLinesegs\(\)/);
  assert.doesNotMatch(mainSource, /showValidationModalIfNeeded/);
  assert.doesNotMatch(overrides, /['"]ui\/validation-modal['"]/);
  await assert.rejects(
    access(join(repoRoot, 'apps/studio-host/src/ui/validation-modal.ts')),
    { code: 'ENOENT' },
  );
});

test('hwply keeps unsaved-document guards on local file and new-document replacement paths', async () => {
  const mainSource = await readFile(join(repoRoot, 'third_party/rhwp/rhwp-studio/src/main.ts'), 'utf8');
  const fileAdapter = await readFile(
    join(repoRoot, 'apps/studio-host/src/command/commands/file.ts'),
    'utf8',
  );

  assert.match(mainSource, /import \{ confirmSaveBeforeReplacingDocument, fileCommands \} from ['"]@\/command\/commands\/file['"]/);
  assert.match(fileAdapter, /confirmSaveBeforeReplacingDocument/);
  assert.match(fileAdapter, /from ['"]@upstream\/command\/commands\/file['"]/);
  assert.match(mainSource, /async function canReplaceCurrentDocument\([\s\S]*confirmSaveBeforeReplacingDocument\(commandServices(?:\)|,\s*\{)/);
  assert.match(mainSource, /const skipUnsavedGuard = input\.dataset\.skipUnsavedGuard === ['"]true['"]/);
  assert.match(mainSource, /await loadFile\(file, \{ skipUnsavedGuard \}\)/);
  assert.match(mainSource, /if \(!await canReplaceCurrentDocument\(options\?\.skipUnsavedGuard\)\) return/);
  assert.match(mainSource, /if \(!await canReplaceCurrentDocument\(data\.skipUnsavedGuard\)\)/);
  assert.match(mainSource, /if \(!await canReplaceCurrentDocument\(skipUnsavedGuard\)\)/);
});

test('hwply defers editor engine and table command behavior to upstream rhwp', async () => {
  const overrides = await readFile(join(repoRoot, 'apps/studio-host/hwply-overrides.ts'), 'utf8');

  assert.doesNotMatch(overrides, /['"]engine\//);
  assert.doesNotMatch(overrides, /['"]command\/commands\/table['"]/);

  for (const path of [
    'apps/studio-host/src/engine/input-handler.ts',
    'apps/studio-host/src/engine/table-object-renderer.ts',
    'apps/studio-host/src/engine/table-resize-renderer.ts',
    'apps/studio-host/src/command/commands/table.ts',
  ]) {
    await assert.rejects(access(join(repoRoot, path)), { code: 'ENOENT' });
  }
});

test('hwply native split adapter keeps the normal Enter metadata path', async () => {
  const stateSource = await readFile(
    join(repoRoot, 'apps/desktop/src-tauri/src/state.rs'),
    'utf8',
  );
  const splitStart = stateSource.indexOf('"splitParagraph" =>');
  const splitEnd = stateSource.indexOf('"mergeParagraph" =>', splitStart);
  assert.notEqual(splitStart, -1, 'splitParagraph mutation adapter should exist');
  assert.ok(splitEnd > splitStart, 'splitParagraph adapter should precede mergeParagraph');

  const splitBlock = stateSource.slice(splitStart, splitEnd);
  assert.match(
    splitBlock,
    /\.split_paragraph_native\(\s*sec as usize,\s*para as usize,\s*char_offset as usize,\s*None,\s*\)/,
  );
});

test('hwply product info keeps the upstream rhwp version and adds hwply version separately', async () => {
  const viteConfig = await readFile(join(repoRoot, 'apps/studio-host/vite.config.ts'), 'utf8');
  const aboutDialog = await readFile(join(repoRoot, 'apps/studio-host/src/ui/about-dialog.ts'), 'utf8');

  assert.match(viteConfig, /__APP_VERSION__:\s*JSON\.stringify\(rhwpWasmPackage\.version\)/);
  assert.match(viteConfig, /\.\.\.createProductDefines\(__dirname\)/);
  assert.match(aboutDialog, /extends UpstreamAboutDialog/);
  assert.match(aboutDialog, /super\.createBody\(\)/);
  assert.match(aboutDialog, /aboutDialogContent\(\)/);
  assert.match(aboutDialog, /\$\{content\.productName\} \$\{content\.version\}/);
});

test('hwply builds the exact upstream Studio entry with only minimal product shell additions', async () => {
  const viteConfig = await readFile(join(repoRoot, 'apps/studio-host/vite.config.ts'), 'utf8');
  const overrides = await readFile(join(repoRoot, 'apps/studio-host/hwply-overrides.ts'), 'utf8');
  const indexHtml = await readFile(join(repoRoot, 'third_party/rhwp/rhwp-studio/index.html'), 'utf8');

  assert.match(viteConfig, /root:\s*upstreamStudioDir/);
  assert.match(viteConfig, /outDir:\s*resolve\(__dirname, ['"]dist['"]\)/);
  assert.match(viteConfig, /transformIndexHtml/);
  assert.match(viteConfig, /hwply 문서 편집기/);
  assert.match(viteConfig, /data-cmd="file:new-window"/);
  assert.match(viteConfig, /marker count must be 1/);
  for (const marker of [
    '<title>rhwp-studio</title>',
    'rhwp-studio 문서 편집기',
    'data-cmd="file:new-doc"',
    'data-cmd="tool:options"',
  ]) {
    assert.equal(indexHtml.split(marker).length - 1, 1, `upstream HTML marker drift: ${marker}`);
  }
  assert.doesNotMatch(overrides, /['"]ui\/toolbar['"]/);
  assert.doesNotMatch(overrides, /['"]view\/canvas-view['"]/);
  assert.doesNotMatch(overrides, /['"]view\/ruler['"]/);
  await assert.rejects(access(join(repoRoot, 'apps/studio-host/index.html')), { code: 'ENOENT' });
  await assert.rejects(access(join(repoRoot, 'apps/studio-host/src/main.ts')), { code: 'ENOENT' });
});

test('hwply keeps upstream PDF and HWPX menu metadata with native execute leaf overrides', async () => {
  const fileCommands = await readFile(join(repoRoot, 'apps/studio-host/src/command/commands/file.ts'), 'utf8');
  const indexHtml = await readFile(join(repoRoot, 'third_party/rhwp/rhwp-studio/index.html'), 'utf8');
  const pdfMenuItem = indexHtml.match(/<div class="md-item disabled" data-cmd="file:print-to-pdf".*?<\/div>/);

  assert.match(fileCommands, /from ['"]@upstream\/command\/commands\/file['"]/);
  assert.doesNotMatch(fileCommands, /file:export-pdf/);
  assert.match(fileCommands, /\['file:print-to-pdf'/);
  assert.match(fileCommands, /\['file:save-as-hwpx'/);
  assert.ok(pdfMenuItem, 'PDF export menu item should exist');
  assert.doesNotMatch(pdfMenuItem[0], /md-shortcut|Ctrl\+E|Cmd\+E/);
  assert.match(indexHtml, /data-cmd="file:save-as-hwpx"/);
});

test('hwply source save and PDF export keep format and snapshot boundaries explicit', async () => {
  const persistence = await readFile(
    join(repoRoot, 'apps/studio-host/src/core/desktop-persistence.ts'),
    'utf8',
  );
  const sourceExport = await readFile(
    join(repoRoot, 'apps/studio-host/src/core/desktop-source-export.ts'),
    'utf8',
  );
  const commands = await readFile(join(repoRoot, 'apps/desktop/src-tauri/src/commands.rs'), 'utf8');
  const state = await readFile(join(repoRoot, 'apps/desktop/src-tauri/src/state.rs'), 'utf8');
  const pdfExport = await readFile(join(repoRoot, 'apps/desktop/src-tauri/src/pdf_export.rs'), 'utf8');

  assert.match(persistence, /createPdfExportSnapshot\(\{ source: handlers, format \}\)/);
  assert.match(persistence, /snapshot\.renderPageSvg\(pageIndex\)/);
  assert.match(persistence, /snapshotId: snapshot\.id/);
  assert.doesNotMatch(persistence, /handlers\.getPageSvg\(pageIndex\)/);
  assert.match(persistence, /exportSource\(requestedFormat\)/);
  assert.match(sourceExport, /exportDocumentWithReportForFormat/);
  assert.match(sourceExport, /exportPasswordProtectedDocumentWithReportForFormat/);
  assert.match(sourceExport, /flushDeferredPaginationIfNeeded\('native-save'\)/);
  assert.match(persistence, /append_pdf_page/);
  assert.doesNotMatch(persistence, /notifySaved/);
  assert.match(commands, /prepare_staged_document_save/);
  assert.match(commands, /begin_pdf_export/);
  assert.doesNotMatch(commands, /prepare_staged_hwp_pdf_export/);
  assert.doesNotMatch(commands, /export_pdf_from_hwp_path/);
  assert.match(state, /DocumentFormat::from_bytes\(&bytes\)/);
  assert.match(pdfExport, /let pages = prepare_pdf_pages\(svg_paths\)\?/);
  assert.match(pdfExport, /render_pdf\(&pages, true\)/);
  assert.match(pdfExport, /pdf_has_to_unicode\(&bytes\)/);
  assert.match(pdfExport, /PdfTextMode::OutlinedFallback/);
});

test('hwply reconnects native lifecycle through leaf adapters without a native WasmBridge fork', async () => {
  const host = await readFile(join(repoRoot, 'apps/studio-host/src/core/desktop-host.ts'), 'utf8');
  const dispatcher = await readFile(join(repoRoot, 'apps/studio-host/src/command/dispatcher.ts'), 'utf8');
  const dirtyState = await readFile(join(repoRoot, 'apps/studio-host/src/core/document-dirty-state.ts'), 'utf8');
  const recentStore = await readFile(join(repoRoot, 'apps/studio-host/src/recent/recent-store.ts'), 'utf8');
  const fontBridge = await readFile(join(repoRoot, 'apps/studio-host/src/core/font-policy-wasm-bridge.ts'), 'utf8');

  assert.match(host, /handlers\.loadFile\(bytes, result\.fileName, false, false\)/);
  assert.match(host, /this\.session\.commitOpen\(result\)/);
  assert.match(dispatcher, /extends UpstreamCommandDispatcher/);
  assert.match(dirtyState, /extends UpstreamDocumentDirtyState/);
  assert.match(recentStore, /const id = `desktop-recent-\$\{nativeListGeneration\}-\$\{index\}`/);
  assert.doesNotMatch(recentStore, /sourcePath:/);
  assert.match(fontBridge, /extends UpstreamWasmBridge/);
  assert.match(fontBridge, /sanitizeAuthoringFontFamily/);

  for (const path of [
    'apps/studio-host/src/core/bridge-factory.ts',
    'apps/studio-host/src/core/tauri-bridge.ts',
    'apps/studio-host/src/command/commands/edit.ts',
    'apps/studio-host/src/command/commands/format.ts',
    'apps/studio-host/src/command/shortcut-map.ts',
  ]) {
    await assert.rejects(access(join(repoRoot, path)), { code: 'ENOENT' });
  }
});

test('hwply keeps handler acquisition async and platform detection in Studio', async () => {
  const embedRuntime = await readFile(
    join(repoRoot, 'apps/studio-host/src/embed/desktop-runtime.ts'),
    'utf8',
  );
  const platformAdapter = await readFile(
    join(repoRoot, 'apps/studio-host/src/core/platform.ts'),
    'utf8',
  );
  const nativeCommands = await readFile(
    join(repoRoot, 'apps/desktop/src-tauri/src/commands.rs'),
    'utf8',
  );
  const nativeEntry = await readFile(
    join(repoRoot, 'apps/desktop/src-tauri/src/lib.rs'),
    'utf8',
  );

  assert.match(embedRuntime, /waitForDesktopStudioHandlers/);
  assert.doesNotMatch(embedRuntime, /getDesktopStudioHandlers/);
  assert.match(platformAdapter, /detectDesktopPlatform/);
  assert.doesNotMatch(platformAdapter, /hydrateDesktopPlatform/);
  assert.doesNotMatch(nativeCommands, /desktop_platform/);
  assert.doesNotMatch(nativeEntry, /desktop_platform/);
});

function git(args) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
    },
  });
  assert.equal(
    result.status,
    0,
    `git ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
