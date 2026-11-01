import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function run(root) {
  return spawnSync(process.execPath, ['scripts/upstream/check.mjs'], {
    env: { ...process.env, HWPLY_ROOT: root },
    encoding: 'utf8',
  });
}

test('상류 Studio 진입점이 없으면 init.sh 안내와 함께 exit 1', () => {
  const root = mkdtempSync(join(tmpdir(), 'hwply-'));
  const r = run(root);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /scripts\/upstream\/init\.sh/);
});

test('상류 Studio 진입점이 있으면 exit 0', () => {
  const root = mkdtempSync(join(tmpdir(), 'hwply-'));
  mkdirSync(join(root, 'third_party/rhwp/rhwp-studio/src'), { recursive: true });
  writeFileSync(join(root, 'third_party/rhwp/rhwp-studio/index.html'), '');
  writeFileSync(join(root, 'third_party/rhwp/rhwp-studio/src/main.ts'), '');
  assert.equal(run(root).status, 0);
});
