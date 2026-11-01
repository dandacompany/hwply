import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  assertSha256,
  extractCommand,
  parseRhwpCliEntries,
  sidecarFileName,
} from '../scripts/prepare-sidecars.mjs';

test('parses three rhwp_cli entries from lock', () => {
  const entries = parseRhwpCliEntries(readFileSync('rhwp-core.lock', 'utf8'));
  assert.deepEqual(entries.map((e) => e.target), [
    'aarch64-apple-darwin',
    'x86_64-apple-darwin',
    'x86_64-pc-windows-msvc',
  ]);
  assert.equal(entries[0].asset, 'rhwp-v0.8.7-macos-aarch64.tar.gz');
  assert.equal(entries[0].url, 'https://github.com/edwardkim/rhwp/releases/download/v0.8.7/rhwp-v0.8.7-macos-aarch64.tar.gz');
  assert.equal(entries[2].binary, 'rhwp/rhwp.exe');
});

test('sidecar names carry the target triple and exe suffix', () => {
  assert.equal(sidecarFileName('hwply-cli', 'aarch64-apple-darwin'), 'hwply-cli-aarch64-apple-darwin');
  assert.equal(sidecarFileName('rhwp', 'x86_64-pc-windows-msvc'), 'rhwp-x86_64-pc-windows-msvc.exe');
});

test('rejects an asset whose sha256 differs', () => {
  const bytes = Buffer.from('rhwp');
  const good = createHash('sha256').update(bytes).digest('hex');
  assertSha256(bytes, good, 'a.tar.gz');
  assert.throws(() => assertSha256(bytes, '0'.repeat(64), 'a.tar.gz'), /rhwp asset sha256 mismatch: a\.tar\.gz/);
});

test('bundle config lists hwply-cli and rhwp', () => {
  const conf = JSON.parse(readFileSync('apps/desktop/src-tauri/tauri.bundle.conf.json', 'utf8'));
  assert.deepEqual(conf.bundle.externalBin, ['binaries/hwply-cli', 'binaries/rhwp']);
  const main = JSON.parse(readFileSync('apps/desktop/src-tauri/tauri.conf.json', 'utf8'));
  assert.equal(main.bundle.externalBin, undefined, '기본 설정에 넣으면 cargo test 가 사이드카 파일을 요구한다');
});

test('windows extracts zip with system bsdtar, not git bash tar', () => {
  const win = extractCommand('win32', 'C:\\Users\\r\\rhwp.zip', 'C:\\T\\w', { SystemRoot: 'C:\\Windows' });
  assert.equal(win.cmd, 'C:\\Windows\\System32\\tar.exe');
  assert.deepEqual(win.args, ['-xf', 'C:\\Users\\r\\rhwp.zip', '-C', 'C:\\T\\w']);
  assert.equal(extractCommand('darwin', '/c/a.tar.gz', '/t', {}).cmd, 'tar');
});
