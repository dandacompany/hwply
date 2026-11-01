#!/usr/bin/env node
// 릴리스 폴더의 산출물로 Tauri 업데이터 매니페스트(latest.json)와 SHA256SUMS 를 만든다.
// 세 플랫폼 중 하나라도 자산·서명이 없거나 버전이 섞여 있으면 아무것도 쓰지 않는다
// (업데이터가 없는 파일을 가리키면 모든 설치본의 업데이트가 깨진다).
//   node scripts/release/assemble.mjs --version 0.1.0 --dir dist/release/0.1.0 [--notes <파일>]

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'dandacompany/hwply';

/** 업데이터 대상 이름(앱의 ArtifactKind::target 과 같아야 한다) → 자산 파일 이름. */
export const PLATFORMS = Object.freeze([
  { key: 'darwin-aarch64', asset: (v) => `hwply_${v}_aarch64.app.tar.gz` },
  { key: 'darwin-x86_64', asset: (v) => `hwply_${v}_x64.app.tar.gz` },
  { key: 'windows-x86_64-nsis', asset: (v) => `hwply_${v}_x64-setup.exe` },
]);

/** 내려받는 사람용 설치 파일(업데이터는 쓰지 않음). */
const INSTALLERS = Object.freeze([(v) => `hwply_${v}_aarch64.dmg`, (v) => `hwply_${v}_x64.dmg`]);

const OUTPUTS = new Set(['latest.json', 'SHA256SUMS']);

export function assembleRelease({ version, dir, notes = '', now = new Date() }) {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error(`버전 형식이 올바르지 않습니다: ${version}`);
  const files = readdirSync(dir).filter((name) => !name.startsWith('.'));

  const stray = files.filter((name) => name.startsWith('hwply_') && !name.startsWith(`hwply_${version}_`));
  if (stray.length > 0) throw new Error(`버전이 다른 파일이 섞여 있습니다: ${stray.join(', ')}`);

  const missing = [];
  const platforms = {};
  for (const { key, asset } of PLATFORMS) {
    const name = asset(version);
    if (!files.includes(name)) {
      missing.push(`${key}: ${name}`);
      continue;
    }
    if (!files.includes(`${name}.sig`)) {
      missing.push(`${key}: ${name}.sig`);
      continue;
    }
    platforms[key] = {
      signature: readFileSync(join(dir, `${name}.sig`), 'utf8').trim(),
      url: `https://github.com/${REPO}/releases/download/v${version}/${name}`,
    };
  }
  for (const installer of INSTALLERS) {
    if (!files.includes(installer(version))) missing.push(`installer: ${installer(version)}`);
  }
  if (missing.length > 0) throw new Error(`릴리스 자산이 빠졌습니다 — ${missing.join('; ')}`);

  const assets = files.filter((name) => !name.endsWith('.sig') && !OUTPUTS.has(name)).sort();
  const sums = assets
    .map((name) => `${createHash('sha256').update(readFileSync(join(dir, name))).digest('hex')}  ${name}`)
    .join('\n');

  return {
    latest: { version, notes, pub_date: now.toISOString(), platforms },
    sums: `${sums}\n`,
  };
}

function writeAtomic(path, text) {
  writeFileSync(`${path}.tmp`, text);
  renameSync(`${path}.tmp`, path);
}

/** 검사를 모두 통과한 뒤에만 두 파일을 쓴다. */
export function writeRelease(options) {
  const { latest, sums } = assembleRelease(options);
  writeAtomic(join(options.dir, 'SHA256SUMS'), sums);
  writeAtomic(join(options.dir, 'latest.json'), `${JSON.stringify(latest, null, 2)}\n`);
  return latest;
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = { '--version': 'version', '--dir': 'dir', '--notes': 'notesFile' }[argv[i]];
    if (!key || argv[i + 1] === undefined) throw new Error(`사용법: --version <x.y.z> --dir <폴더> [--notes <파일>] (받은 인자: ${argv[i]})`);
    opts[key] = argv[i + 1];
  }
  if (!opts.version || !opts.dir) throw new Error('--version 과 --dir 이 필요합니다');
  return opts;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { version, dir, notesFile } = parseArgs(process.argv.slice(2));
    const notes = notesFile && existsSync(notesFile) ? readFileSync(notesFile, 'utf8').trim() : '';
    const latest = writeRelease({ version, dir, notes });
    console.log(`latest.json: ${Object.keys(latest.platforms).join(', ')} / SHA256SUMS 작성 (${dir})`);
  } catch (error) {
    console.error(`assemble: ${error.message}`);
    process.exitCode = 1;
  }
}
