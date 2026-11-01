#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  lstat,
  mkdir,
  readdir,
  writeFile,
} from 'node:fs/promises';
import {
  basename,
  dirname,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';

const INVENTORY_FILENAME = 'hwply-artifact-inventory.json';
const CHECKSUM_FILENAME = 'SHA256SUMS';
const SUPPORTED_OPTIONS = new Set(['--root', '--output']);

export async function createReleaseChecksums({ root, outputPath }) {
  if (typeof root !== 'string' || root === '') {
    throw new Error('artifact root 경로가 필요합니다.');
  }
  if (typeof outputPath !== 'string' || outputPath === '') {
    throw new Error('checksum output 경로가 필요합니다.');
  }

  const rootPath = resolve(root);
  const resolvedOutputPath = resolve(outputPath);
  if (basename(resolvedOutputPath) !== CHECKSUM_FILENAME) {
    throw new Error(`checksum output 파일명은 ${CHECKSUM_FILENAME}이어야 합니다.`);
  }

  let rootStat;
  try {
    rootStat = await lstat(rootPath);
  } catch (error) {
    throw new Error(`artifact root를 읽을 수 없습니다: ${rootPath}: ${error.message}`);
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`artifact root는 실제 디렉터리여야 합니다: ${rootPath}`);
  }

  const files = [];
  await walk(rootPath, rootPath, resolvedOutputPath, files);
  if (files.length === 0) {
    throw new Error('checksum을 생성할 지원 installer가 없습니다.');
  }

  assertUniqueAssetNames(files);
  files.sort((left, right) => compareText(left.path, right.path));
  const entries = [];
  for (const file of files) {
    if (file.size === 0) {
      throw new Error(`빈 installer는 공개 checksum에 포함할 수 없습니다: ${file.path}`);
    }
    entries.push({
      ...file,
      sha256: await sha256File(file.absolutePath),
    });
  }

  const content = entries
    .map((entry) => `${entry.sha256}  ${entry.path}`)
    .join('\n')
    .concat('\n');
  await mkdir(dirname(resolvedOutputPath), { recursive: true });
  await writeFile(resolvedOutputPath, content, 'utf8');

  return {
    outputPath: resolvedOutputPath,
    entries: entries.map(({ absolutePath, ...entry }) => entry),
    content,
  };
}

async function walk(rootPath, directory, outputPath, files) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => compareText(left.name, right.name));

  for (const entry of entries) {
    const absolutePath = resolve(directory, entry.name);
    const path = toRelativePath(rootPath, absolutePath);
    if (absolutePath === outputPath || entry.name === INVENTORY_FILENAME) {
      continue;
    }
    if (entry.isSymbolicLink()) {
      throw new Error(`artifact root에 symbolic link를 허용하지 않습니다: ${path}`);
    }
    if (entry.isDirectory()) {
      if (isAppDir(path)) continue;
      await walk(rootPath, absolutePath, outputPath, files);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`지원하지 않는 artifact 파일 유형입니다: ${path}`);
    }

    const kind = classifyInstaller(path);
    if (!kind) {
      if (entry.name.endsWith('.sig') || entry.name === 'hwply-updater-release-inventory.json') {
        throw new Error(
          `installer 전용 checksum 도구에 updater 게시 파일을 넣을 수 없습니다: ${path}. `
          + 'docs/operations/PUBLIC_RELEASE_RUNBOOK.md Gate 4의 shasum 명시 파일 목록을 사용하세요.',
        );
      }
      throw new Error(`공개 checksum에 지원하지 않는 파일입니다: ${path}`);
    }
    const fileStat = await lstat(absolutePath);
    files.push({
      absolutePath,
      path,
      assetName: basename(path),
      kind,
      size: fileStat.size,
    });
  }
}

function classifyInstaller(path) {
  const normalized = path.toLowerCase();
  const segments = normalized.split('/');
  if (normalized.endsWith('.msi')) return 'msi';
  if (
    normalized.endsWith('.exe')
    && (segments.includes('nsis') || normalized.endsWith('-setup.exe'))
  ) {
    return 'nsis';
  }
  if (normalized.endsWith('.appimage')) return 'appimage';
  if (normalized.endsWith('.deb')) return 'deb';
  if (normalized.endsWith('.rpm')) return 'rpm';
  return null;
}

function isAppDir(path) {
  return path
    .split('/')
    .some((segment) => segment.toLowerCase().endsWith('.appdir'));
}

function assertUniqueAssetNames(files) {
  const seen = new Map();
  for (const file of files) {
    const normalizedName = file.assetName.toLowerCase();
    const previous = seen.get(normalizedName);
    if (previous) {
      throw new Error(
        `공개 asset 파일명이 중복됩니다: ${previous.path}, ${file.path}`,
      );
    }
    seen.set(normalizedName, file);
  }
}

function toRelativePath(rootPath, absolutePath) {
  const path = relative(rootPath, absolutePath);
  if (path === '' || path === '..' || path.startsWith(`..${sep}`)) {
    throw new Error(`artifact 경로가 root를 벗어났습니다: ${absolutePath}`);
  }
  return path.split(sep).join('/');
}

async function sha256File(path) {
  const hash = createHash('sha256');
  const input = createReadStream(path);
  for await (const chunk of input) hash.update(chunk);
  return hash.digest('hex');
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function parseArguments(argv) {
  const args = argv[0] === '--' ? argv.slice(1) : argv;
  if (args.includes('--help')) return { help: true };

  const values = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (!SUPPORTED_OPTIONS.has(option)) {
      throw new Error(`지원하지 않는 option입니다: ${option}`);
    }
    if (values.has(option)) {
      throw new Error(`option을 중복 지정할 수 없습니다: ${option}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${option} 값이 필요합니다.`);
    }
    values.set(option, value);
    index += 1;
  }
  return {
    root: values.get('--root'),
    outputPath: values.get('--output'),
  };
}

function usage() {
  return [
    'Usage:',
    '  node scripts/create-release-checksums.mjs \\',
    '    --root <artifact-root> \\',
    '    --output <artifact-root>/SHA256SUMS',
  ].join('\n');
}

const isMain = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
    } else {
      const result = await createReleaseChecksums(options);
      console.log(
        `Release checksums created: ${result.entries.length} files -> ${result.outputPath}`,
      );
    }
  } catch (error) {
    console.error(`release checksum creation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
