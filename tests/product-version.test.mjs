import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { verifyProductVersion } from '../scripts/check-product-version.mjs';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const scriptPath = join(repositoryRoot, 'scripts/check-product-version.mjs');
const fixtureVersion = '1.2.3';

test('일치하는 제품 version surface를 승인하고 파일을 수정하지 않는다', async () => {
  const fixture = await createFixture();
  try {
    const before = await readFixtureFiles(fixture);
    const result = await verifyProductVersion({ repositoryRoot: fixture.root });
    const after = await readFixtureFiles(fixture);

    assert.equal(result.version, fixtureVersion);
    assert.deepEqual(result.surfaces.map(({ version }) => version), [
      fixtureVersion,
      fixtureVersion,
      fixtureVersion,
      fixtureVersion,
      fixtureVersion,
      fixtureVersion,
    ]);
    assert.deepEqual(after, before);
  } finally {
    await cleanup(fixture.tmp);
  }
});

for (const [name, mutate] of [
  ['desktop package drift', mutateDesktopPackage],
  ['Cargo manifest drift', mutateCargoManifest],
  ['Tauri config drift', mutateTauriConfig],
  ['Cargo lock drift', mutateCargoLock],
]) {
  mutationTest(`${name}를 거부한다`, mutate, /expected 1\.2\.3/);
}

mutationTest(
  'root version의 invalid SemVer를 거부한다',
  async (fixture) => updateJson(fixture.rootPackagePath, { version: '01.2.3' }),
  /strict SemVer/,
);

mutationTest(
  '손상된 root package JSON을 거부한다',
  async (fixture) => writeFile(fixture.rootPackagePath, '{ invalid\n'),
  /JSON parse 실패/,
);

mutationTest(
  '누락된 desktop package version을 거부한다',
  async (fixture) => updateJson(fixture.desktopPackagePath, { version: undefined }),
  /desktop package version 문자열이 필요합니다/,
);

mutationTest(
  '누락된 Cargo manifest version을 거부한다',
  async (fixture) => replaceInFile(
    fixture.cargoManifestPath,
    `version = "${fixtureVersion}"\n`,
    '',
  ),
  /Cargo\.toml version 문자열이 필요합니다/,
);

mutationTest(
  '누락된 Cargo lock package를 거부한다',
  async (fixture) => replaceInFile(
    fixture.cargoLockPath,
    'name = "hwply-desktop"',
    'name = "other-package"',
  ),
  /hwply-desktop package가 없습니다/,
);

mutationTest(
  '중복된 Cargo lock package를 거부한다',
  async (fixture) => {
    const source = await readFile(fixture.cargoLockPath, 'utf8');
    await writeFile(fixture.cargoLockPath, `${source}\n${fixture.lockPackage}`);
  },
  /hwply-desktop package가 중복되었습니다/,
);

test('CLI는 fixture root를 검증한다', async () => {
  const fixture = await createFixture();
  try {
    const result = runCli(['--root', fixture.root]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Product version check passed: 1\.2\.3/);
  } finally {
    await cleanup(fixture.tmp);
  }
});

test('CLI는 unknown option과 누락된 root 값을 거부한다', () => {
  for (const args of [['--unknown'], ['--root']]) {
    const result = runCli(args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /지원하지 않는 인자입니다/);
  }
});

function mutationTest(name, mutate, expectedError) {
  test(name, async () => {
    const fixture = await createFixture();
    try {
      await mutate(fixture);
      await assert.rejects(
        verifyProductVersion({ repositoryRoot: fixture.root }),
        expectedError,
      );
    } finally {
      await cleanup(fixture.tmp);
    }
  });
}

async function createFixture() {
  const tmp = await mkdtemp(join(tmpdir(), 'hwply-product-version-'));
  const root = join(tmp, 'repository');
  const desktopDir = join(root, 'apps/desktop');
  const tauriDir = join(desktopDir, 'src-tauri');
  const rootPackagePath = join(root, 'package.json');
  const desktopPackagePath = join(desktopDir, 'package.json');
  const cargoManifestPath = join(tauriDir, 'Cargo.toml');
  const tauriConfigPath = join(tauriDir, 'tauri.conf.json');
  const cargoLockPath = join(tauriDir, 'Cargo.lock');
  const lockPackage = [
    '[[package]]',
    'name = "hwply-desktop"',
    `version = "${fixtureVersion}"`,
    'dependencies = []',
    '',
  ].join('\n');

  await mkdir(tauriDir, { recursive: true });
  await writeJson(rootPackagePath, {
    name: 'hwply-tauri',
    version: fixtureVersion,
  });
  await writeJson(desktopPackagePath, {
    name: 'hwply-desktop',
    version: fixtureVersion,
  });
  await writeFile(
    cargoManifestPath,
    `[package]\nname = "hwply-desktop"\nversion = "${fixtureVersion}"\n`,
  );
  await writeJson(tauriConfigPath, {
    productName: 'hwply',
    version: fixtureVersion,
  });
  await writeFile(cargoLockPath, `version = 4\n\n${lockPackage}`);
  const cliManifestPath = join(root, 'apps/cli/Cargo.toml');
  await mkdir(dirname(cliManifestPath), { recursive: true });
  await writeFile(
    cliManifestPath,
    `[package]\nname = "hwply-cli"\nversion = "${fixtureVersion}"\n\n[[bin]]\nname = "hwply"\n`,
  );

  return {
    tmp,
    root,
    rootPackagePath,
    desktopPackagePath,
    cargoManifestPath,
    tauriConfigPath,
    cargoLockPath,
    cliManifestPath,
    lockPackage,
  };
}

test('cli version must match app version', async () => {
  const fixture = await createFixture();
  try {
    await replaceInFile(fixture.cliManifestPath, fixtureVersion, '9.9.9');
    await assert.rejects(
      verifyProductVersion({ repositoryRoot: fixture.root }),
      /apps\/cli\/Cargo\.toml 제품 version이 root package\.json과 다릅니다: 9\.9\.9/,
    );
  } finally {
    await cleanup(fixture.tmp);
  }
});

async function mutateDesktopPackage(fixture) {
  await updateJson(fixture.desktopPackagePath, { version: '9.9.9' });
}

async function mutateCargoManifest(fixture) {
  await replaceInFile(
    fixture.cargoManifestPath,
    fixtureVersion,
    '9.9.9',
  );
}

async function mutateTauriConfig(fixture) {
  await updateJson(fixture.tauriConfigPath, { version: '9.9.9' });
}

async function mutateCargoLock(fixture) {
  await replaceInFile(fixture.cargoLockPath, fixtureVersion, '9.9.9');
}

async function updateJson(path, changes) {
  const value = JSON.parse(await readFile(path, 'utf8'));
  for (const [key, next] of Object.entries(changes)) {
    if (next === undefined) delete value[key];
    else value[key] = next;
  }
  await writeJson(path, value);
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function replaceInFile(path, search, replacement) {
  const source = await readFile(path, 'utf8');
  const updated = source.replace(search, replacement);
  assert.notEqual(updated, source, `fixture mutation target이 없습니다: ${search}`);
  await writeFile(path, updated);
}

async function readFixtureFiles(fixture) {
  return Promise.all([
    readFile(fixture.rootPackagePath, 'utf8'),
    readFile(fixture.desktopPackagePath, 'utf8'),
    readFile(fixture.cargoManifestPath, 'utf8'),
    readFile(fixture.tauriConfigPath, 'utf8'),
    readFile(fixture.cargoLockPath, 'utf8'),
  ]);
}

function runCli(args) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8',
  });
}

async function cleanup(path) {
  await rm(path, { recursive: true, force: true });
}
