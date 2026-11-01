import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { writeRhwpPin } from '../scripts/write-rhwp-pin.mjs';
import {
  RHWP_CLI_TARGETS,
  RHWP_REPOSITORY,
  verifyRepositoryPin,
} from '../scripts/verify-rhwp-pin.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const fixtureVersion = '1.2.3';
const fixtureTag = `v${fixtureVersion}`;

test('writer가 deterministic lock을 만들고 verifier가 정상 fixture를 승인한다', async () => {
  const fixture = await createFixture();
  try {
    const first = await readFile(fixture.lockPath, 'utf8');
    const pin = await verifyRepositoryPin({ repoRoot: fixture.root });
    await writeRhwpPin(fixture.writerOptions);
    const second = await readFile(fixture.lockPath, 'utf8');

    assert.equal(pin.rhwp_release_tag, fixtureTag);
    assert.equal(pin.rhwp_commit, fixture.commit);
    assert.equal(pin.artifacts.length, 6);
    assert.deepEqual(pin.rhwp_cli.map((e) => e.target), RHWP_CLI_TARGETS);
    assert.equal(pin.rhwp_cli[2].asset, `rhwp-${fixtureTag}-windows-x86_64.zip`);
    assert.equal(pin.rhwp_cli[2].binary, 'rhwp/rhwp.exe');
    assert.equal(second, first, '동일한 source와 artifact는 동일한 lock을 생성해야 한다');
  } finally {
    await cleanup(fixture.tmp);
  }
});

test('실제 저장소의 rhwp pin과 managed artifact가 일치한다', async () => {
  const pin = await verifyRepositoryPin({ repoRoot });
  assert.equal(pin.rhwp_release_tag, 'v0.8.7');
  assert.equal(pin.rhwp_commit, '1a76570e833917d15817415a53c09ad61ab3203f');
  assert.deepEqual(
    pin.rhwp_cli.map((e) => [e.target, e.asset, e.sha256]),
    [
      ['aarch64-apple-darwin', 'rhwp-v0.8.7-macos-aarch64.tar.gz', '6ed46aa63f6d10c447842999f73abc59cf9586c5645fefc5e763bd6a6d43662d'],
      ['x86_64-apple-darwin', 'rhwp-v0.8.7-macos-x86_64.tar.gz', '07b1a5ea570e410d1b52b4d848a94f00c64674e84004883c62efad7daab61da4'],
      ['x86_64-pc-windows-msvc', 'rhwp-v0.8.7-windows-x86_64.zip', 'f7ac326e98f595ae8fecd8da7a614ee9a37db77bdf938782a8e07c9da473ec6f'],
    ],
  );
});

test('writer는 SHA256SUMS에 대상 자산이 없으면 거부한다', async () => {
  const fixture = await createFixture();
  try {
    const sums = fixture.writerOptions.cliSums.split('\n').filter((l) => !l.includes('windows')).join('\n');
    await assert.rejects(
      writeRhwpPin({ ...fixture.writerOptions, cliSums: sums }),
      /SHA256SUMS에 rhwp-v1\.2\.3-windows-x86_64\.zip 이 없습니다/,
    );
  } finally {
    await cleanup(fixture.tmp);
  }
});

mutationTest(
  'pin requires rhwp_cli for all release targets',
  async (fixture) => {
    const text = await readFile(fixture.lockPath, 'utf8');
    await writeFile(fixture.lockPath, text.replace(/\n\[\[rhwp_cli\]\]\ntarget = "x86_64-pc-windows-msvc"[\s\S]*$/, '\n'));
  },
  /rhwp_cli 대상이 올바르지 않습니다/,
);

mutationTest(
  'rhwp_cli asset tag must match rhwp_release_tag',
  async (fixture) => {
    await replaceInFile(fixture.lockPath, 'rhwp-v1.2.3-macos-x86_64', 'rhwp-v1.2.2-macos-x86_64');
  },
  /rhwp_cli asset 이 release tag 와 다릅니다/,
);

mutationTest(
  'repository pin 변조를 거부한다',
  async (fixture) => {
    await replaceInFile(
      fixture.lockPath,
      RHWP_REPOSITORY,
      'https://example.invalid/rhwp.git',
    );
  },
  /repository pin이 올바르지 않습니다/,
);

mutationTest(
  'release tag 변조를 거부한다',
  async (fixture) => {
    await replaceInFile(fixture.lockPath, fixtureTag, 'v1.2.4');
  },
  /refs\/tags\/v1\.2\.4/,
);

mutationTest(
  'resolved commit 변조를 거부한다',
  async (fixture) => {
    await replaceInFile(fixture.lockPath, fixture.commit, 'b'.repeat(40));
  },
  /submodule HEAD가 lock commit과 다릅니다/,
);

mutationTest(
  'desktop Cargo version 변조를 거부한다',
  async (fixture) => {
    await replaceInFile(fixture.desktopLockPath, fixtureVersion, '9.9.9');
  },
  /apps\/desktop\/src-tauri\/Cargo\.lock rhwp version이 release tag와 다릅니다/,
);

mutationTest(
  'vendored WASM package version 변조를 거부한다',
  async (fixture) => {
    const packagePath = join(fixture.vendorDir, 'package.json');
    const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
    packageJson.version = '9.9.9';
    await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  },
  /vendored WASM package version이 release tag와 다릅니다/,
);

mutationTest(
  'upstream Cargo.lock fingerprint 변조를 거부한다',
  async (fixture) => {
    await replaceInFile(
      fixture.lockPath,
      /source_cargo_lock_sha256 = "[0-9a-f]{64}"/,
      `source_cargo_lock_sha256 = "${'0'.repeat(64)}"`,
    );
  },
  /upstream Cargo\.lock SHA-256가 lock과 다릅니다/,
);

mutationTest(
  '동일 크기의 managed artifact hash 변조를 거부한다',
  async (fixture) => {
    const wasmPath = join(fixture.vendorDir, 'rhwp_bg.wasm');
    const bytes = await readFile(wasmPath);
    bytes[0] ^= 0xff;
    await writeFile(wasmPath, bytes);
  },
  /managed artifact SHA-256가 lock과 다릅니다/,
);

mutationTest(
  'managed artifact size 변조를 거부한다',
  async (fixture) => {
    const path = join(fixture.vendorDir, 'rhwp.js');
    const bytes = await readFile(path);
    await writeFile(path, Buffer.concat([bytes, Buffer.from('x')]));
  },
  /managed artifact size가 lock과 다릅니다/,
);

mutationTest(
  '누락된 managed artifact를 거부한다',
  async (fixture) => {
    await unlink(join(fixture.vendorDir, 'rhwp.d.ts'));
  },
  /managed artifact를 읽을 수 없습니다/,
);

mutationTest(
  'submodule origin 변조를 거부한다',
  async (fixture) => {
    git(
      ['remote', 'set-url', 'origin', 'https://example.invalid/rhwp.git'],
      fixture.submodule,
    );
  },
  /submodule origin이 올바르지 않습니다/,
);

mutationTest(
  'dirty upstream submodule을 거부한다',
  async (fixture) => {
    await writeFile(join(fixture.submodule, 'dirty.txt'), 'dirty\n');
  },
  /upstream submodule에 추적되지 않은 변경이 있습니다/,
);

for (const lockPath of []) {
  mutationTest(`${lockPath} stale rhwp version을 거부한다`, async fixture => {
    const path = join(fixture.root, lockPath);
    await writeFile(path, (await readFile(path, 'utf8')).replace(fixtureVersion, '0.0.1'));
  }, /rhwp version이 release tag와 다릅니다/);
}

function mutationTest(name, mutate, expectedError) {
  test(name, async () => {
    const fixture = await createFixture();
    try {
      await mutate(fixture);
      await assert.rejects(
        verifyRepositoryPin({ repoRoot: fixture.root }),
        expectedError,
      );
    } finally {
      await cleanup(fixture.tmp);
    }
  });
}

async function createFixture() {
  const tmp = await mkdtemp(join(tmpdir(), 'hwply-rhwp-pin-'));
  const root = join(tmp, 'repository');
  const submodule = join(root, 'third_party/rhwp');
  const vendorDir = join(root, 'apps/studio-host/vendor/rhwp-core');
  const desktopDir = join(root, 'apps/desktop/src-tauri');
  const desktopLockPath = join(desktopDir, 'Cargo.lock');
  const lockPath = join(root, 'rhwp-core.lock');

  await mkdir(submodule, { recursive: true });
  await mkdir(vendorDir, { recursive: true });
  await mkdir(desktopDir, { recursive: true });
  await writeFile(
    join(root, '.gitmodules'),
    `[submodule "third_party/rhwp"]\n\tpath = third_party/rhwp\n\turl = ${RHWP_REPOSITORY}\n`,
  );

  git(['init', '-b', 'main'], submodule);
  configureGitIdentity(submodule);
  git(['remote', 'add', 'origin', RHWP_REPOSITORY], submodule);
  await writeFile(
    join(submodule, 'Cargo.toml'),
    `[package]\nname = "rhwp"\nversion = "${fixtureVersion}"\nedition = "2021"\n`,
  );
  await writeFile(
    join(submodule, 'Cargo.lock'),
    `version = 4\n\n[[package]]\nname = "rhwp"\nversion = "${fixtureVersion}"\n`,
  );
  await writeFile(join(submodule, 'LICENSE'), 'fixture license\n');
  git(['add', 'Cargo.toml', 'Cargo.lock', 'LICENSE'], submodule);
  git(['commit', '-m', 'fixture release'], submodule);
  git(['tag', fixtureTag], submodule);
  const commit = git(['rev-parse', 'HEAD'], submodule).stdout.trim();

  await writeFile(
    desktopLockPath,
    `version = 4\n\n[[package]]\nname = "rhwp"\nversion = "${fixtureVersion}"\n`,
  );
  for (const lockPath of []) {
    await mkdir(dirname(join(root, lockPath)), { recursive: true });
    await writeFile(join(root, lockPath), await readFile(desktopLockPath));
  }
  const artifacts = new Map([
    ['package.json', `${JSON.stringify({ name: 'rhwp', version: fixtureVersion }, null, 2)}\n`],
    ['rhwp.js', 'export default async function init() {}\n'],
    ['rhwp.d.ts', 'export default function init(): Promise<void>;\n'],
    ['rhwp_bg.wasm', Buffer.from([0x00, 0x61, 0x73, 0x6d])],
    ['rhwp_bg.wasm.d.ts', 'export const memory: WebAssembly.Memory;\n'],
    ['LICENSE', 'fixture license\n'],
  ]);
  for (const [name, content] of artifacts) {
    await writeFile(join(vendorDir, name), content);
  }

  const writerOptions = {
    repoRoot: root,
    releaseTag: fixtureTag,
    commit,
    wasmPackVersion: '0.15.0',
    cliSums: ['macos-aarch64.tar.gz', 'macos-x86_64.tar.gz', 'windows-x86_64.zip', 'linux-x86_64.tar.gz']
      .map((suffix, i) => `${String(i + 1).repeat(64)}  rhwp-${fixtureTag}-${suffix}`)
      .join('\n'),
  };
  await writeRhwpPin(writerOptions);
  return {
    tmp,
    root,
    submodule,
    vendorDir,
    desktopLockPath,
    lockPath,
    commit,
    writerOptions,
  };
}

async function replaceInFile(path, search, replacement) {
  const source = await readFile(path, 'utf8');
  const updated = source.replace(search, replacement);
  assert.notEqual(updated, source, `fixture mutation target을 찾지 못했습니다: ${search}`);
  await writeFile(path, updated);
}

function configureGitIdentity(cwd) {
  git(['config', 'user.email', 'test@example.com'], cwd);
  git(['config', 'user.name', 'Test User'], cwd);
}

function git(args, cwd) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
    },
  });
  assert.equal(
    result.status,
    0,
    `git ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result;
}

async function cleanup(path) {
  await rm(path, { recursive: true, force: true });
}
