import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('tauri.conf 에 macOS 번들 설정과 .hwp/.hwpx 연결이 있다', () => {
  const c = JSON.parse(readFileSync('apps/desktop/src-tauri/tauri.conf.json', 'utf8'));
  assert.equal(c.identifier, 'com.dante-labs.hwply');
  assert.equal(c.bundle.macOS.minimumSystemVersion, '13.0');
  const exts = c.bundle.fileAssociations.flatMap((a) => a.ext);
  assert.ok(exts.includes('hwp') && exts.includes('hwpx'), exts.join(','));
  for (const a of c.bundle.fileAssociations) assert.equal(a.role, 'Editor', a.name);
});
