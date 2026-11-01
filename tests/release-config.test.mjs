import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const tauri = JSON.parse(readFileSync('apps/desktop/src-tauri/tauri.conf.json', 'utf8'));
const updater = JSON.parse(readFileSync('apps/desktop/src-tauri/tauri.updater.conf.json', 'utf8'));
const read = (p) => readFileSync(p, 'utf8');

test('기반 제품 사이트 경로(/updates/, /feedback/)를 가리키는 URL 이 없다', () => {
  const r = spawnSync('git', ['grep', '-I', '-n', '-E', 'github\\.com/dandacompany/hwply/(updates|feedback)/', '--', '.', ':!docs/**'], { encoding: 'utf8' });
  assert.equal(r.status, 1, r.stdout);
});

test('수동 다운로드 URL 은 GitHub Releases 다', () => {
  for (const p of ['apps/desktop/src-tauri/src/updater/commands.rs', 'apps/desktop/src-tauri/src/updater/target.rs']) {
    assert.match(read(p), /MANUAL_DOWNLOADS_URL: &str = "https:\/\/github\.com\/dandacompany\/hwply\/releases"/, p);
  }
});

test('updater pubkey is set', () => {
  // tauri signer 공개키: minisign 공개키 파일을 base64 로 감싼 것. 비밀키는 bws 에만 있다.
  const decoded = Buffer.from(updater.plugins.updater.pubkey, 'base64').toString('utf8');
  assert.match(decoded, /^untrusted comment: minisign public key: [0-9A-F]{16}\nRW[A-Za-z0-9+/=]{54}\n?$/);
});

test('updater endpoint is the public latest.json', () => {
  assert.deepEqual(updater.plugins.updater.endpoints, [
    'https://github.com/dandacompany/hwply/releases/latest/download/latest.json',
  ]);
});

test('publisher 는 Dante Labs 이고 Windows 레지스트리 키·제거 항목 비교와 일치한다', () => {
  assert.equal(tauri.bundle.publisher, 'Dante Labs');
  assert.equal(tauri.bundle.copyright, '© 2026 Dante Labs');
  assert.match(read('apps/desktop/src-tauri/src/updater/target.rs'), /eq_ignore_ascii_case\("Dante Labs"\)/);
  assert.match(read('apps/desktop/src-tauri/src/updater/target/native.rs'), /PRODUCT_KEY: &str = r"Software\\Dante Labs\\hwply"/);
});
