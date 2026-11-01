import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
import { createReleaseChecksums } from '../scripts/create-release-checksums.mjs';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const scriptPath = join(repositoryRoot, 'scripts/create-release-checksums.mjs');
const baselineFiles = Object.freeze({
  'windows/msi/hwply_0.1.0_x64_en-US.msi': 'windows msi',
  'windows/nsis/hwply_0.1.0_x64-setup.exe': 'windows nsis',
  'linux-x64/appimage/hwply_0.1.0_amd64.AppImage': 'linux appimage',
  'linux-x64/deb/hwply_0.1.0_amd64.deb': 'linux deb',
  'linux-x64/rpm/hwply-0.1.0-1.x86_64.rpm': 'linux rpm',
  'linux-arm64/deb/hwply_0.1.0_arm64.deb': 'linux arm64 deb',
});

test('baseline installer checksum을 상대 경로 순으로 결정적으로 생성한다', async () => {
  const fixture = await createFixture({
    ...baselineFiles,
    'windows/hwply-artifact-inventory.json': '{}',
    'linux-x64/appimage/hwply.AppDir/usr/bin/hwply': 'intermediate',
  });
  try {
    const outputPath = join(fixture.root, 'SHA256SUMS');
    const first = await createReleaseChecksums({
      root: fixture.root,
      outputPath,
    });
    const second = await createReleaseChecksums({
      root: fixture.root,
      outputPath,
    });
    const expectedPaths = Object.keys(baselineFiles).sort();

    assert.deepEqual(first.entries.map((entry) => entry.path), expectedPaths);
    assert.deepEqual(
      first.entries.map((entry) => entry.kind),
      ['deb', 'appimage', 'deb', 'rpm', 'msi', 'nsis'],
    );
    assert.equal(second.content, first.content);
    assert.equal(await readFile(outputPath, 'utf8'), first.content);
    assert.doesNotMatch(first.content, /inventory|AppDir/);

    const expected = expectedPaths
      .map((path) => `${sha256(baselineFiles[path])}  ${path}`)
      .join('\n')
      .concat('\n');
    assert.equal(first.content, expected);
  } finally {
    await cleanup(fixture.tmp);
  }
});

for (const [name, files, expectedError] of [
  [
    'updater signature 입력에 게시 경로를 안내하고',
    { ...baselineFiles, 'hwply_0.1.0_amd64.AppImage.sig': 'signature' },
    /installer 전용.*PUBLIC_RELEASE_RUNBOOK\.md Gate 4의 shasum/,
  ],
  [
    'updater inventory 입력에 게시 경로를 안내하고',
    { ...baselineFiles, 'hwply-updater-release-inventory.json': '{}' },
    /installer 전용.*PUBLIC_RELEASE_RUNBOOK\.md Gate 4의 shasum/,
  ],
  [
    '지원하지 않는 파일',
    {
      ...baselineFiles,
      'notes.txt': 'not an installer',
    },
    /공개 checksum에 지원하지 않는 파일입니다: notes\.txt/,
  ],
  [
    '빈 installer',
    {
      ...baselineFiles,
      'windows/msi/hwply_0.1.0_x64_en-US.msi': '',
    },
    /빈 installer는 공개 checksum에 포함할 수 없습니다/,
  ],
  [
    '중복 공개 asset 이름',
    {
      'one/deb/hwply_0.1.0_amd64.deb': 'first',
      'two/deb/hwply_0.1.0_amd64.deb': 'second',
    },
    /공개 asset 파일명이 중복됩니다/,
  ],
]) {
  test(`${name}을 거부한다`, async () => {
    const fixture = await createFixture(files);
    try {
      await assert.rejects(
        createReleaseChecksums({
          root: fixture.root,
          outputPath: join(fixture.root, 'SHA256SUMS'),
        }),
        expectedError,
      );
    } finally {
      await cleanup(fixture.tmp);
    }
  });
}

test('installer가 없는 root와 잘못된 output 이름을 거부한다', async () => {
  const fixture = await createFixture({
    'hwply-artifact-inventory.json': '{}',
  });
  try {
    await assert.rejects(
      createReleaseChecksums({
        root: fixture.root,
        outputPath: join(fixture.root, 'SHA256SUMS'),
      }),
      /지원 installer가 없습니다/,
    );
    await assert.rejects(
      createReleaseChecksums({
        root: fixture.root,
        outputPath: join(fixture.root, 'checksums.txt'),
      }),
      /output 파일명은 SHA256SUMS이어야 합니다/,
    );
  } finally {
    await cleanup(fixture.tmp);
  }
});

test('CLI는 package separator, help와 필수 인자 검증을 지원한다', async () => {
  const fixture = await createFixture(baselineFiles);
  try {
    const outputPath = join(fixture.root, 'SHA256SUMS');
    const result = runCli([
      '--',
      '--root',
      fixture.root,
      '--output',
      outputPath,
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Release checksums created: 6 files/);
    assert.match(await readFile(outputPath, 'utf8'), /^[a-f0-9]{64}  /m);
  } finally {
    await cleanup(fixture.tmp);
  }

  const help = runCli(['--help']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Usage:/);

  const unknown = runCli(['--unknown', 'value']);
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /지원하지 않는 option입니다/);

  const missing = runCli(['--root', '/tmp']);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /checksum output 경로가 필요합니다/);
});

async function createFixture(files) {
  const tmp = await mkdtemp(join(tmpdir(), 'hwply-release-checksums-'));
  const root = join(tmp, 'artifacts');
  await mkdir(root, { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    const outputPath = join(root, path);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, content);
  }
  return { tmp, root };
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function runCli(args) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
}

async function cleanup(path) {
  await rm(path, { recursive: true, force: true });
}
