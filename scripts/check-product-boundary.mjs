// hwply 제품 경계 검사 — (1) 걷어낸 하위시스템이 다시 들어오지 않았는지, (2) 기반 제품의 이름이 남아 있지 않은지 본다.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** alhangeul-tauri 에서 가져오지 않기로 한 하위시스템 (설계 §6 "걷어낼 것"). */
export const removedSubsystems = [
  'apps/thumbnail-handler', 'apps/thumbnail-worker', 'apps/linux-thumbnailer', 'crates/document-preview',
  'apps/desktop/src-tauri/src/thumbnail_diagnostics', 'apps/desktop/src-tauri/linux', 'site', 'mydocs',
];

/** 기반 제품 이름. 출처를 밝히는 문서(PROVENANCE·README·THIRD_PARTY·LICENSE)와 docs/ 는 예외다. */
const legacyNamePattern = [['Al', 'hangeul'].join(''), ['알', '한글'].join(''), ['post', 'melee'].join('')].join('|');
export const legacyNameAllowlist = [
  'docs/**', 'third_party/**', 'pnpm-lock.yaml', 'PROVENANCE.md', 'README.md', 'NOTICE.md', 'THIRD_PARTY_LICENSES.md', 'LICENSE',
  'tests/product-boundary.test.mjs', 'tests/fonts-and-notices.test.mjs', 'scripts/check-product-boundary.mjs',
];

export function legacyNameFiles({ root = defaultRoot } = {}) {
  const pathspecs = ['--', '.', ...legacyNameAllowlist.map((p) => `:!${p}`)];
  const r = spawnSync('git', ['grep', '-I', '-i', '-l', '-E', '--untracked', legacyNamePattern, ...pathspecs], {
    cwd: root, encoding: 'utf8',
  });
  if (r.error) throw r.error;
  if (r.status === 1) return [];
  if (r.status !== 0) throw new Error(`git grep failed: ${r.stderr}`);
  return r.stdout.split('\n').filter(Boolean);
}

export function verifyProductBoundary({ root = defaultRoot, checkLegacyNames = true } = {}) {
  const violations = removedSubsystems
    .filter((path) => existsSync(resolve(root, path)))
    .map((path) => `${path}: 걷어낸 하위시스템이 다시 들어왔습니다`);
  if (checkLegacyNames) {
    for (const file of legacyNameFiles({ root })) violations.push(`${file}: 기반 제품의 이름이 남아 있습니다`);
  }
  return { violations };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { violations } = verifyProductBoundary();
  if (violations.length > 0) {
    for (const v of violations) console.error(v);
    process.exit(1);
  }
  console.log('product boundary verified');
}
