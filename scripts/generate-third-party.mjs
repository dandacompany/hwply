#!/usr/bin/env node
// THIRD_PARTY_LICENSES.md 의 4절(Rust)·5절(npm) 표를 다시 만든다. 다른 절은 손대지 않는다.
//   node scripts/generate-third-party.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'THIRD_PARTY_LICENSES.md';
const RUST_MANIFESTS = ['apps/desktop/src-tauri/Cargo.toml', 'apps/cli/Cargo.toml'];

function rustRows() {
  const seen = new Map();
  for (const manifest of RUST_MANIFESTS) {
    const metadata = JSON.parse(execFileSync(
      'cargo',
      ['metadata', '--format-version', '1', '--locked', '--manifest-path', manifest],
      { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
    ));
    // 경로 의존성(hwply 자신과 상류 rhwp 서브모듈)은 1절에서 따로 적는다.
    for (const pkg of metadata.packages.filter((p) => p.source !== null)) {
      seen.set(`${pkg.name}@${pkg.version}`, {
        name: pkg.name,
        version: pkg.version,
        license: pkg.license ?? `파일: ${pkg.license_file ?? '확인 필요'}`,
      });
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

function npmRows() {
  const listing = JSON.parse(execFileSync('pnpm', ['licenses', 'list', '--json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }));
  const rows = [];
  for (const [license, packages] of Object.entries(listing)) {
    for (const pkg of packages) rows.push({ name: pkg.name, version: pkg.versions.join(', '), license });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

function distribution(rows) {
  const counts = new Map();
  for (const row of rows) counts.set(row.license, (counts.get(row.license) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([license, count]) => `${license} ${count}`)
    .join(', ');
}

function table(header, rows) {
  return [
    `| ${header} | 버전 | 라이선스 |`,
    '| --- | --- | --- |',
    ...rows.map((r) => `| ${r.name} | ${r.version} | ${r.license} |`),
  ].join('\n');
}

function replaceSection(text, headingPrefix, body) {
  const start = text.indexOf(headingPrefix);
  if (start < 0) throw new Error(`${headingPrefix} 절을 찾을 수 없습니다`);
  const next = text.indexOf('\n## ', start + 1);
  const end = next < 0 ? text.length : next + 1;
  return `${text.slice(0, start)}${body}\n${next < 0 ? '' : '\n'}${text.slice(end)}`;
}

const rust = rustRows();
const npm = npmRows();
let text = readFileSync(FILE, 'utf8');
text = replaceSection(text, '## 4. Rust 의존성', [
  `## 4. Rust 의존성 (desktop·cli 크레이트, \`cargo metadata\` 기준, ${rust.length}개)`,
  '',
  `라이선스 분포: ${distribution(rust)}`,
  '',
  table('크레이트', rust),
].join('\n'));
text = replaceSection(text, '## 5. npm 의존성', [
  `## 5. npm 의존성 (\`pnpm licenses list\` 기준, ${npm.length}개)`,
  '',
  table('패키지', npm),
].join('\n'));
writeFileSync(FILE, text.endsWith('\n') ? text : `${text}\n`);
console.log(`Rust ${rust.length}개, npm ${npm.length}개`);
