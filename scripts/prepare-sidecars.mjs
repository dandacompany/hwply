#!/usr/bin/env node
// 앱 번들에 넣을 사이드카를 apps/desktop/src-tauri/binaries/ 에 준비한다(Tauri externalBin 이름 규칙: <이름>-<triple>[.exe]).
//   hwply-cli : 이 저장소의 CLI(apps/cli)를 그 대상으로 빌드한 것
//   rhwp      : rhwp-core.lock 에 SHA 를 고정한 상류 릴리스 바이너리
// 사용: node scripts/prepare-sidecars.mjs --target <triple> [--profile debug|release]

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRhwpPin } from './verify-rhwp-pin.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BINARIES = join(repoRoot, 'apps/desktop/src-tauri/binaries');

export function parseRhwpCliEntries(lockText) {
  const pin = parseRhwpPin(lockText);
  return pin.rhwp_cli.map((entry) => ({
    ...entry,
    url: `https://github.com/edwardkim/rhwp/releases/download/${pin.rhwp_release_tag}/${entry.asset}`,
  }));
}

export function sidecarFileName(name, triple) {
  return `${name}-${triple}${triple.includes('windows') ? '.exe' : ''}`;
}

export function assertSha256(bytes, expected, label) {
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expected) throw new Error(`rhwp asset sha256 mismatch: ${label} (${actual})`);
}

/** Windows 의 bash 에서 `tar` 는 Git 의 GNU tar 라 `C:\…` 를 원격 호스트로 읽고 zip 도 못 푼다. 시스템 bsdtar 를 쓴다. */
export function extractCommand(platform, archive, dest, env = process.env) {
  const cmd = platform === 'win32' ? `${env.SystemRoot ?? 'C:\\Windows'}\\System32\\tar.exe` : 'tar';
  return { cmd, args: ['-xf', archive, '-C', dest] };
}

function run(cmd, args, options = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...options });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} 실패 (exit ${r.status})`);
}

async function fetchAsset(entry) {
  const cached = join(homedir(), '.cache/hwply/rhwp', entry.sha256, entry.asset);
  if (existsSync(cached)) {
    const bytes = readFileSync(cached);
    assertSha256(bytes, entry.sha256, entry.asset);
    return cached;
  }
  const response = await fetch(entry.url);
  if (!response.ok) throw new Error(`${entry.url} 다운로드 실패: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  assertSha256(bytes, entry.sha256, entry.asset);
  mkdirSync(dirname(cached), { recursive: true });
  writeFileSync(cached, bytes);
  return cached;
}

function buildCli(triple, profile) {
  const args = ['build', '--manifest-path', join(repoRoot, 'apps/cli/Cargo.toml'), '--locked', '--target', triple];
  if (profile === 'release') args.push('--release');
  run('cargo', args);
  const exe = triple.includes('windows') ? 'hwply.exe' : 'hwply';
  return join(repoRoot, 'apps/cli/target', triple, profile, exe);
}

function place(source, name, triple) {
  mkdirSync(BINARIES, { recursive: true });
  const dest = join(BINARIES, sidecarFileName(name, triple));
  copyFileSync(source, dest);
  chmodSync(dest, 0o755);
  console.log(`sidecar: ${dest}`);
}

function parseArgs(argv) {
  const opts = { target: '', profile: 'debug' };
  for (let i = 0; i < argv.length; i += 2) {
    const key = { '--target': 'target', '--profile': 'profile' }[argv[i]];
    if (!key || !argv[i + 1]) throw new Error(`사용법: --target <triple> [--profile debug|release] (받은 인자: ${argv[i]})`);
    opts[key] = argv[i + 1];
  }
  if (!opts.target) throw new Error('--target 이 필요합니다');
  if (!['debug', 'release'].includes(opts.profile)) throw new Error(`--profile 은 debug|release: ${opts.profile}`);
  return opts;
}

async function main() {
  const { target, profile } = parseArgs(process.argv.slice(2));
  const entry = parseRhwpCliEntries(readFileSync(join(repoRoot, 'rhwp-core.lock'), 'utf8')).find((e) => e.target === target);
  if (!entry) throw new Error(`rhwp-core.lock 에 ${target} 용 rhwp CLI 가 없습니다`);

  place(buildCli(target, profile), 'hwply-cli', target);

  const archive = await fetchAsset(entry);
  const work = mkdtempSync(join(tmpdir(), 'hwply-rhwp-'));
  try {
    const { cmd, args } = extractCommand(process.platform, archive, work);
    run(cmd, args);
    place(join(work, entry.binary), 'rhwp', target);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`prepare-sidecars: ${error.message}`);
    process.exitCode = 1;
  });
}
