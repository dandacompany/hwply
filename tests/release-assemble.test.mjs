import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assembleRelease, writeRelease } from '../scripts/release/assemble.mjs';

const V = '0.1.0';
const NOW = new Date('2026-11-01T00:00:00Z');

function fixture(version = V, { skip = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'hwply-release-'));
  const files = {
    [`hwply_${version}_aarch64.dmg`]: 'dmg-arm',
    [`hwply_${version}_x64.dmg`]: 'dmg-x64',
    [`hwply_${version}_aarch64.app.tar.gz`]: 'tar-arm',
    [`hwply_${version}_aarch64.app.tar.gz.sig`]: 'sig-arm',
    [`hwply_${version}_x64.app.tar.gz`]: 'tar-x64',
    [`hwply_${version}_x64.app.tar.gz.sig`]: 'sig-x64',
    [`hwply_${version}_x64-setup.exe`]: 'exe',
    [`hwply_${version}_x64-setup.exe.sig`]: 'sig-exe',
  };
  for (const [name, body] of Object.entries(files)) {
    if (!skip.some((s) => name.endsWith(s))) writeFileSync(join(dir, name), body);
  }
  return dir;
}

test('builds latest.json for three platforms', () => {
  const dir = fixture();
  try {
    const { latest } = assembleRelease({ version: V, dir, notes: '첫 공개', now: NOW });
    assert.equal(latest.version, V);
    assert.equal(latest.notes, '첫 공개');
    assert.equal(latest.pub_date, '2026-11-01T00:00:00.000Z');
    assert.deepEqual(Object.keys(latest.platforms).sort(), ['darwin-aarch64', 'darwin-x86_64', 'windows-x86_64-nsis']);
    assert.deepEqual(latest.platforms['darwin-aarch64'], {
      signature: 'sig-arm',
      url: `https://github.com/dandacompany/hwply/releases/download/v${V}/hwply_${V}_aarch64.app.tar.gz`,
    });
    assert.equal(latest.platforms['windows-x86_64-nsis'].url.endsWith(`hwply_${V}_x64-setup.exe`), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('assemble fails on missing platform', () => {
  const dir = fixture(V, { skip: ['x64-setup.exe', 'x64-setup.exe.sig'] });
  try {
    assert.throws(() => assembleRelease({ version: V, dir, now: NOW }), /windows-x86_64-nsis.*hwply_0\.1\.0_x64-setup\.exe/);
    assert.throws(() => writeRelease({ version: V, dir, now: NOW }));
    assert.equal(existsSync(join(dir, 'latest.json')), false, '실패했는데 latest.json 을 썼다');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('assemble fails on missing signature', () => {
  const dir = fixture(V, { skip: ['x64.app.tar.gz.sig'] });
  try {
    assert.throws(() => assembleRelease({ version: V, dir, now: NOW }), /\.sig/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('assemble fails on version mismatch', () => {
  const dir = fixture();
  writeFileSync(join(dir, 'hwply_0.0.9_x64.dmg'), 'old');
  try {
    assert.throws(() => assembleRelease({ version: V, dir, now: NOW }), /버전이 다른 파일.*hwply_0\.0\.9_x64\.dmg/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writes SHA256SUMS for every asset', () => {
  const dir = fixture();
  try {
    writeRelease({ version: V, dir, now: NOW });
    const sums = readFileSync(join(dir, 'SHA256SUMS'), 'utf8').trim().split('\n');
    const names = sums.map((l) => l.split(/\s+/)[1]).sort();
    assert.deepEqual(names, [
      `hwply_${V}_aarch64.app.tar.gz`, `hwply_${V}_aarch64.dmg`,
      `hwply_${V}_x64-setup.exe`, `hwply_${V}_x64.app.tar.gz`, `hwply_${V}_x64.dmg`,
    ]);
    const exe = sums.find((l) => l.endsWith('setup.exe'));
    assert.equal(exe.split(/\s+/)[0], createHash('sha256').update('exe').digest('hex'));
    assert.equal(JSON.parse(readFileSync(join(dir, 'latest.json'), 'utf8')).version, V);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const MACOS_SH = 'scripts/release/macos.sh';
test('macos release script keeps the bws token out of the build environment', () => {
  const text = readFileSync(MACOS_SH, 'utf8');
  assert.doesNotMatch(text, /set -a;\s*source/, 'bws 토큰 파일을 통째로 export 하지 않는다');
  const build = text.indexOf('tauri build');
  const unset = text.search(/unset [^\n]*BWS_ACCESS_TOKEN/);
  assert.ok(unset > 0 && unset < build, '빌드 전에 BWS_ACCESS_TOKEN 을 환경에서 지운다');
  assert.doesNotMatch(text, /^\s*set -x/m);
  assert.doesNotMatch(text, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/, 'bws 비밀 ID 는 macos.local.env 에만 둔다');
});
