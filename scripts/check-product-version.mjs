import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRepositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
);
const productPackageName = 'hwply-desktop';
const strictSemverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const usage = 'Usage: node scripts/check-product-version.mjs [--root <repository-root>]';

export async function verifyProductVersion(options = {}) {
  const repositoryRoot = resolve(options.repositoryRoot ?? defaultRepositoryRoot);
  const rootSurface = await readJsonVersion(
    repositoryRoot,
    'package.json',
    'root package',
  );
  const rootVersion = rootSurface.version;
  assertStrictSemver(rootVersion);

  const surfaces = await Promise.all([
    readJsonVersion(
      repositoryRoot,
      'apps/desktop/package.json',
      'desktop package',
    ),
    readCargoManifestVersion(repositoryRoot),
    readJsonVersion(
      repositoryRoot,
      'apps/desktop/src-tauri/tauri.conf.json',
      'Tauri config',
    ),
    readCargoLockVersion(repositoryRoot),
    readCargoManifestVersion(repositoryRoot, 'apps/cli/Cargo.toml'),
  ]);

  for (const surface of surfaces) {
    if (surface.version !== rootVersion) {
      throw new Error(
        `${surface.path} 제품 version이 root package.json과 다릅니다: `
          + `${surface.version} (expected ${rootVersion})`,
      );
    }
  }

  return {
    version: rootVersion,
    surfaces: [
      rootSurface,
      ...surfaces,
    ],
  };
}

async function readJsonVersion(repositoryRoot, path, label) {
  const source = await readRepositoryFile(repositoryRoot, path);
  let value;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new Error(`${path} JSON parse 실패: ${error.message}`);
  }
  if (typeof value.version !== 'string' || value.version.length === 0) {
    throw new Error(`${path} ${label} version 문자열이 필요합니다.`);
  }
  return { path, version: value.version };
}

async function readCargoManifestVersion(
  repositoryRoot,
  path = 'apps/desktop/src-tauri/Cargo.toml',
) {
  const source = await readRepositoryFile(repositoryRoot, path);
  const packageTable = findSingleTable(source, '[package]', path);
  return {
    path,
    version: readRequiredTomlString(packageTable, 'version', path),
  };
}

async function readCargoLockVersion(repositoryRoot) {
  const path = 'apps/desktop/src-tauri/Cargo.lock';
  const source = await readRepositoryFile(repositoryRoot, path);
  const packages = findTableBlocks(source, '[[package]]');
  const matches = packages.filter(
    (block) => readOptionalTomlString(block, 'name', path) === productPackageName,
  );
  if (matches.length === 0) {
    throw new Error(`${path}에 ${productPackageName} package가 없습니다.`);
  }
  if (matches.length > 1) {
    throw new Error(`${path}에 ${productPackageName} package가 중복되었습니다.`);
  }
  return {
    path,
    version: readRequiredTomlString(matches[0], 'version', path),
  };
}

async function readRepositoryFile(repositoryRoot, path) {
  try {
    return await readFile(resolve(repositoryRoot, path), 'utf8');
  } catch (error) {
    throw new Error(`${path}을 읽을 수 없습니다: ${error.message}`);
  }
}

function findSingleTable(source, header, path) {
  const blocks = findTableBlocks(source, header);
  if (blocks.length === 0) throw new Error(`${path}에 ${header} table이 없습니다.`);
  if (blocks.length > 1) throw new Error(`${path}에 ${header} table이 중복되었습니다.`);
  return blocks[0];
}

function findTableBlocks(source, header) {
  const lines = source.split(/\r?\n/);
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() !== header) continue;
    const block = [];
    for (let next = index + 1; next < lines.length; next += 1) {
      if (/^\s*\[/.test(lines[next])) break;
      block.push(lines[next]);
    }
    blocks.push(block.join('\n'));
  }
  return blocks;
}

function readRequiredTomlString(source, key, path) {
  const value = readOptionalTomlString(source, key, path);
  if (value === undefined) {
    throw new Error(`${path} ${key} 문자열이 필요합니다.`);
  }
  return value;
}

function readOptionalTomlString(source, key, path) {
  const pattern = new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"\\s*(?:#.*)?$`, 'gm');
  const matches = [...source.matchAll(pattern)];
  if (matches.length > 1) {
    throw new Error(`${path} ${key} 필드가 중복되었습니다.`);
  }
  return matches[0]?.[1];
}

function assertStrictSemver(version) {
  const match = version.match(strictSemverPattern);
  if (!match || hasInvalidNumericPrerelease(match[4])) {
    throw new Error(`root package.json version은 strict SemVer여야 합니다: ${version}`);
  }
}

function hasInvalidNumericPrerelease(prerelease) {
  if (!prerelease) return false;
  return prerelease
    .split('.')
    .some((identifier) => /^\d+$/.test(identifier) && /^0\d+/.test(identifier));
}

function parseArguments(args) {
  if (args.length === 0) return { repositoryRoot: defaultRepositoryRoot };
  if (args.length === 1 && args[0] === '--help') return { help: true };
  if (args.length === 2 && args[0] === '--root' && args[1]) {
    return { repositoryRoot: resolve(args[1]) };
  }
  throw new Error(`지원하지 않는 인자입니다.\n${usage}`);
}

function isDirectExecution() {
  if (!process.argv[1]) return false;
  return resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
      console.log(usage);
    } else {
      const result = await verifyProductVersion(options);
      console.log(`Product version check passed: ${result.version}`);
      for (const surface of result.surfaces) {
        console.log(`- ${surface.path}: ${surface.version}`);
      }
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
