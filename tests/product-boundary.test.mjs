import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { legacyNameFiles, verifyProductBoundary } from '../scripts/check-product-boundary.mjs';

const removedSubsystems = [
  'apps/thumbnail-handler', 'apps/thumbnail-worker', 'apps/linux-thumbnailer', 'crates/document-preview',
  'apps/desktop/src-tauri/src/thumbnail_diagnostics', 'apps/desktop/src-tauri/linux', 'site', 'mydocs',
];

test('썸네일·Linux·사이트 하위시스템이 저장소에 없다', () => {
  for (const p of removedSubsystems) {
    assert.equal(existsSync(p), false, p);
  }
});

test('verifyProductBoundary 는 걷어낸 하위시스템이 다시 들어오면 위반으로 보고한다', () => {
  const root = mkdtempSync(join(tmpdir(), 'hwply-boundary-'));
  assert.deepEqual(verifyProductBoundary({ root, checkLegacyNames: false }).violations, []);
  mkdirSync(join(root, 'apps/thumbnail-worker'), { recursive: true });
  const { violations } = verifyProductBoundary({ root, checkLegacyNames: false });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /apps\/thumbnail-worker/);
});

test('verifyProductBoundary 는 이 저장소에서 위반이 없다', () => {
  assert.deepEqual(verifyProductBoundary().violations, []);
});

test('기반 제품의 이름이 코드·설정·문서에 남아 있지 않다 (출처 문서만 예외)', () => {
  assert.deepEqual(legacyNameFiles(), []);
});
