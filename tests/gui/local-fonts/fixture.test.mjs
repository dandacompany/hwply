import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HwpDocument, initSync } from '../../../apps/studio-host/vendor/rhwp-core/rhwp.js';
import { sampleText } from './generate.mjs';
import { verifyFixtures, installFixtureFont, recordObservation, supportedFontRoot } from './fixture.mjs';

initSync({ module: await readFile(new URL('../../../apps/studio-host/vendor/rhwp-core/rhwp_bg.wasm', import.meta.url)) });

test('pinned public fixtures retain Abel through both document exporters', async () => {
  await verifyFixtures();
  for (const extension of ['hwp', 'hwpx']) {
    const doc = new HwpDocument(await readFile(new URL(`abel.${extension}`, import.meta.url)));
    try {
      assert.ok(JSON.parse(doc.getDocumentInfo()).fontsUsed.includes('Abel'));
      for (const bytes of [doc.exportHwp(), doc.exportHwpx()]) {
        const reopened = new HwpDocument(bytes);
        try {
          assert.ok(JSON.parse(reopened.getDocumentInfo()).fontsUsed.includes('Abel'));
          assert.ok(reopened.getTextFileText().includes(sampleText));
        }
        finally { reopened.free(); }
      }
    } finally { doc.free(); }
  }
});

test('installation helper owns only its unique directory and preserves existing files', async () => {
  const home = await mkdtemp(join(tmpdir(), 'task74-font-contract-'));
  try {
    const first = await installFixtureFont({ platform: 'linux', home });
    const marker = join(supportedFontRoot({ platform: 'linux', home }), 'existing.ttf');
    await writeFile(marker, 'existing');
    const second = await installFixtureFont({ platform: 'linux', home });
    assert.notEqual(first.path, second.path);
    await first.cleanup(); await second.cleanup();
    assert.equal(await readFile(marker, 'utf8'), 'existing');
    assert.throws(() => supportedFontRoot({ platform: 'unsupported', home }));
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('supply evidence alone never claims actual screen acceptance', async () => {
  const observation = await recordObservation({
    os: 'linux', renderer: 'canvaskit', sourceSha: 'a'.repeat(40), format: 'hwp',
    scenario: 'first-enable', detected: true, supplied: true, registered: true,
  });
  assert.equal(observation.acceptance, 'unverified');
  assert.equal(observation.localWidth, null);
  assert.equal(observation.originalFontPreserved, false);
});
