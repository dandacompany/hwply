import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const scriptPath = join(repoRoot, 'scripts/update-upstream.sh');
const nativeLocks = ['apps/desktop/src-tauri/Cargo.lock'];
const upstreamScriptTest = process.platform === 'win32' ? test.skip : test;

upstreamScriptTest('updates source, Cargo lock, WASM, and pin from a verified lightweight tag', async () => {
  const fixture = await createFixture();
  try {
    const release = await createRelease(fixture, { tag: 'v0.1.0' });
    const result = runUpdateScript(fixture, [
      '--tag',
      release.tag,
      '--commit',
      release.commit,
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Stable upstream pin updated and verified\./);
    assert.match(result.stdout, /Release tag: v0\.1\.0/);
    assert.match(result.stdout, new RegExp(`Resolved commit: ${release.commit}`));
    assert.equal(
      git(['rev-parse', 'HEAD'], { cwd: fixture.submodule }).stdout.trim(),
      release.commit,
    );
    for (const lockPath of nativeLocks) {
      assert.match(await readFile(join(fixture.parent, lockPath), 'utf8'),
        /name = "rhwp"\nversion = "0\.1\.0"/);
    }
    const vendorPackage = JSON.parse(
      await readFile(
        join(fixture.parent, 'apps/studio-host/vendor/rhwp-core/package.json'),
        'utf8',
      ),
    );
    assert.equal(vendorPackage.version, '0.1.0');
    assert.match(
      await readFile(join(fixture.parent, 'rhwp-core.lock'), 'utf8'),
      new RegExp(`${release.tag} ${release.commit}`),
    );
    assert.deepEqual(
      (await readdir(fixture.submodule)).filter((name) =>
        name.startsWith('.hwply-wasm-build.')),
      [],
    );
  } finally {
    await cleanup(fixture.tmp);
  }
});

upstreamScriptTest('resolves an annotated release tag to its commit', async () => {
  const fixture = await createFixture();
  try {
    const release = await createRelease(fixture, {
      tag: 'v0.2.0',
      annotated: true,
    });
    const result = runUpdateScript(fixture, [
      '--tag',
      release.tag,
      '--commit',
      release.commit,
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Release tag: v0\.2\.0/);
    assert.equal(
      git(['rev-parse', 'HEAD'], { cwd: fixture.submodule }).stdout.trim(),
      release.commit,
    );
  } finally {
    await cleanup(fixture.tmp);
  }
});

upstreamScriptTest('requires immutable Stable tag and full commit arguments before fetch', async () => {
  const fixture = await createFixture();
  try {
    const before = git(['rev-parse', 'HEAD'], { cwd: fixture.submodule }).stdout.trim();
    const fullCommit = 'a'.repeat(40);
    const cases = [
      { args: [], error: /--tag is required/ },
      { args: ['--tag', 'v0.1.0'], error: /--commit is required/ },
      { args: ['--commit', fullCommit], error: /--tag is required/ },
      {
        args: ['--tag', 'main', '--commit', fullCommit],
        error: /Stable release tag in vX\.Y\.Z form/,
      },
      {
        args: ['--tag', 'v0.1.0-rc.1', '--commit', fullCommit],
        error: /Stable release tag in vX\.Y\.Z form/,
      },
      {
        args: ['--tag', 'v01.0.0', '--commit', fullCommit],
        error: /Stable release tag in vX\.Y\.Z form/,
      },
      {
        args: ['--tag', 'v0.1.0', '--commit', 'abc123'],
        error: /lowercase 40-character SHA/,
      },
      {
        args: ['--tag', 'v0.1.0', '--tag', 'v0.2.0', '--commit', fullCommit],
        error: /--tag may only be specified once/,
      },
      {
        args: ['--tag', 'v0.1.0', '--commit', fullCommit, '--commit', fullCommit],
        error: /--commit may only be specified once/,
      },
    ];

    for (const entry of cases) {
      const result = runUpdateScript(fixture, entry.args);
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, entry.error);
      assert.equal(
        git(['rev-parse', 'HEAD'], { cwd: fixture.submodule }).stdout.trim(),
        before,
      );
    }
  } finally {
    await cleanup(fixture.tmp);
  }
});

upstreamScriptTest('rejects a tag and commit mismatch without changing the checkout', async () => {
  const fixture = await createFixture();
  try {
    const before = git(['rev-parse', 'HEAD'], { cwd: fixture.submodule }).stdout.trim();
    const release = await createRelease(fixture, { tag: 'v0.3.0' });
    const result = runUpdateScript(fixture, [
      '--tag',
      release.tag,
      '--commit',
      release.postReleaseCommit,
    ]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Release tag and expected commit do not match/);
    assert.match(result.stderr, new RegExp(`Resolved: ${release.commit}`));
    assert.match(result.stderr, new RegExp(`Expected: ${release.postReleaseCommit}`));
    assert.equal(
      git(['rev-parse', 'HEAD'], { cwd: fixture.submodule }).stdout.trim(),
      before,
    );
  } finally {
    await cleanup(fixture.tmp);
  }
});

upstreamScriptTest('rejects branch, floating ref, and positional ref inputs', async () => {
  const fixture = await createFixture();
  try {
    const before = git(['rev-parse', 'HEAD'], { cwd: fixture.submodule }).stdout.trim();
    for (const args of [
      ['--branch', 'main'],
      ['--ref', 'origin/main'],
      ['v0.1.0'],
    ]) {
      const result = runUpdateScript(fixture, args);
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /unknown option or positional ref/);
      assert.equal(
        git(['rev-parse', 'HEAD'], { cwd: fixture.submodule }).stdout.trim(),
        before,
      );
    }
  } finally {
    await cleanup(fixture.tmp);
  }
});

upstreamScriptTest('rejects legacy upstream environment variables', async () => {
  const fixture = await createFixture();
  try {
    const before = git(['rev-parse', 'HEAD'], { cwd: fixture.submodule }).stdout.trim();
    const args = ['--tag', 'v0.1.0', '--commit', 'a'.repeat(40)];
    for (const name of [
      'UPSTREAM_BRANCH',
      'UPSTREAM_REMOTE',
      'UPSTREAM_REF',
      'RUN_CHECKS',
    ]) {
      const result = runUpdateScript(fixture, args, { [name]: 'legacy' });
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, new RegExp(`${name} is no longer supported`));
      assert.equal(
        git(['rev-parse', 'HEAD'], { cwd: fixture.submodule }).stdout.trim(),
        before,
      );
    }
  } finally {
    await cleanup(fixture.tmp);
  }
});

upstreamScriptTest('rejects an origin that differs from .gitmodules before fetch', async () => {
  const fixture = await createFixture();
  try {
    const before = git(['rev-parse', 'HEAD'], { cwd: fixture.submodule }).stdout.trim();
    git(['remote', 'set-url', 'origin', `${fixture.upstreamBare}-other`], {
      cwd: fixture.submodule,
    });
    const result = runUpdateScript(fixture, [
      '--tag',
      'v0.1.0',
      '--commit',
      'a'.repeat(40),
    ]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Upstream submodule origin does not match \.gitmodules/);
    assert.equal(
      git(['rev-parse', 'HEAD'], { cwd: fixture.submodule }).stdout.trim(),
      before,
    );
  } finally {
    await cleanup(fixture.tmp);
  }
});

upstreamScriptTest('fails before fetch when the upstream submodule is missing', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'hwply-update-upstream-'));
  try {
    git(['init', '-b', 'main'], { cwd: tmp });
    const result = spawnSync(
      'bash',
      [scriptPath, '--tag', 'v0.1.0', '--commit', 'a'.repeat(40)],
      { cwd: tmp, encoding: 'utf8' },
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Missing upstream submodule at third_party\/rhwp\./);
    assert.match(result.stderr, /git submodule update --init --recursive/);
  } finally {
    await cleanup(tmp);
  }
});

upstreamScriptTest('refuses to update when the upstream submodule has local changes', async () => {
  const fixture = await createFixture();
  try {
    const before = git(['rev-parse', 'HEAD'], { cwd: fixture.submodule }).stdout.trim();
    const release = await createRelease(fixture, { tag: 'v0.4.0' });
    await writeFile(join(fixture.submodule, 'dirty.txt'), 'local change');
    const result = runUpdateScript(fixture, [
      '--tag',
      release.tag,
      '--commit',
      release.commit,
    ]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Upstream submodule has local changes/);
    assert.equal(
      git(['rev-parse', 'HEAD'], { cwd: fixture.submodule }).stdout.trim(),
      before,
    );
  } finally {
    await cleanup(fixture.tmp);
  }
});

upstreamScriptTest('rejects a wasm-pack version mismatch before checkout', async () => {
  const fixture = await createFixture();
  try {
    const before = git(['rev-parse', 'HEAD'], { cwd: fixture.submodule }).stdout.trim();
    const release = await createRelease(fixture, { tag: 'v0.5.0' });
    const result = runUpdateScript(
      fixture,
      ['--tag', release.tag, '--commit', release.commit],
      { HWPLY_FAKE_WASM_PACK_VERSION: '0.14.0' },
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /wasm-pack version mismatch/);
    assert.match(result.stderr, /Expected: wasm-pack 0\.15\.0/);
    assert.equal(
      git(['rev-parse', 'HEAD'], { cwd: fixture.submodule }).stdout.trim(),
      before,
    );
  } finally {
    await cleanup(fixture.tmp);
  }
});

upstreamScriptTest('cleans fresh WASM staging and preserves partial state on build failure', async () => {
  const fixture = await createFixture();
  try {
    const release = await createRelease(fixture, { tag: 'v0.6.0' });
    const result = runUpdateScript(
      fixture,
      ['--tag', release.tag, '--commit', release.commit],
      { HWPLY_FAKE_WASM_PACK_FAIL_BUILD: '1' },
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Stable upstream update failed during: fresh WASM build/);
    assert.match(result.stderr, /No automatic reset was performed/);
    assert.equal(
      git(['rev-parse', 'HEAD'], { cwd: fixture.submodule }).stdout.trim(),
      release.commit,
      '실패 시 checkout을 자동 reset하지 않아야 한다',
    );
    assert.deepEqual(
      (await readdir(fixture.submodule)).filter((name) =>
        name.startsWith('.hwply-wasm-build.')),
      [],
    );
  } finally {
    await cleanup(fixture.tmp);
  }
});

upstreamScriptTest('--run-checks preserves the full platform-neutral order', async () => {
  const fixture = await createFixture();
  try {
    const release = await createRelease(fixture, { tag: 'v0.7.0' });
    const logPath = join(fixture.tmp, 'commands.log');
    const result = runUpdateScript(
      fixture,
      [
        '--tag',
        release.tag,
        '--commit',
        release.commit,
        '--run-checks',
      ],
      { HWPLY_COMMAND_LOG: logPath },
    );

    assert.equal(result.status, 0, result.stderr);
    const commands = (await readFile(logPath, 'utf8')).trim().split('\n');
    assert.equal(commands[0], 'wasm-pack --version');
    assert.deepEqual(commands.slice(1, 1 + nativeLocks.length), nativeLocks.map(path =>
      `cargo update --manifest-path ${path.replace('Cargo.lock', 'Cargo.toml')} -p rhwp`));
    const n = nativeLocks.length;
    assert.match(
      commands[1 + n],
      /^wasm-pack build --target web --release --out-dir \.hwply-wasm-build\.[A-Za-z0-9]+$/,
    );
    assert.match(
      commands[2 + n],
      new RegExp(`^gh release download ${release.tag} --repo edwardkim/rhwp --pattern SHA256SUMS\\.txt --output \\S+ --clobber$`),
    );
    assert.match(
      commands[3 + n],
      new RegExp(`^node write-rhwp-pin --tag ${release.tag} --commit ${release.commit} --wasm-pack-version 0\\.15\\.0 --cli-sums \\S+$`),
    );
    assert.equal(commands[4 + n], 'node verify-rhwp-pin');
    assert.deepEqual(commands.slice(5 + n), [
      'pnpm install --frozen-lockfile',
      'pnpm run check:rhwp-pin',
      'pnpm run check:product-boundary',
      'pnpm run test:upstream',
      'pnpm run test:studio',
      'pnpm run build:studio',
      'cargo metadata --manifest-path apps/desktop/src-tauri/Cargo.toml --locked --offline --no-deps',
      'cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --all -- --check',
    ]);
    assert.doesNotMatch(commands.join('\n'), /\btauri (?:build|dev)|cargo test|clippy/);
  } finally {
    await cleanup(fixture.tmp);
  }
});

async function createFixture() {
  const tmp = await mkdtemp(join(tmpdir(), 'hwply-update-upstream-'));
  const upstreamWork = join(tmp, 'upstream-work');
  const upstreamBare = join(tmp, 'upstream.git');
  const parent = join(tmp, 'parent');
  const submodule = join(parent, 'third_party/rhwp');
  const fakeBin = join(tmp, 'fake-bin');

  await mkdir(upstreamWork, { recursive: true });
  git(['init', '-b', 'main'], { cwd: upstreamWork });
  configureGitIdentity(upstreamWork);
  await commitUpstream(upstreamWork, 'README.md', 'initial\n');
  git(['clone', '--bare', upstreamWork, upstreamBare], { cwd: tmp });
  git(['remote', 'add', 'origin', upstreamBare], { cwd: upstreamWork });

  await mkdir(parent, { recursive: true });
  git(['init', '-b', 'main'], { cwd: parent });
  configureGitIdentity(parent);
  git(
    ['-c', 'protocol.file.allow=always', 'submodule', 'add', upstreamBare, 'third_party/rhwp'],
    { cwd: parent },
  );
  await createParentSupportFiles(parent);
  await createFakeCommands(fakeBin);
  git(['add', '.'], { cwd: parent });
  git(['commit', '-m', 'add update fixture'], { cwd: parent });

  return { tmp, upstreamWork, upstreamBare, parent, submodule, fakeBin };
}

async function createRelease(fixture, { tag, annotated = false }) {
  const version = tag.slice(1);
  await writeFile(
    join(fixture.upstreamWork, 'Cargo.toml'),
    `[package]\nname = "rhwp"\nversion = "${version}"\nedition = "2021"\n`,
  );
  await writeFile(
    join(fixture.upstreamWork, 'Cargo.lock'),
    `version = 4\n\n[[package]]\nname = "rhwp"\nversion = "${version}"\n`,
  );
  await writeFile(join(fixture.upstreamWork, 'LICENSE'), `license ${version}\n`);
  git(['add', 'Cargo.toml', 'Cargo.lock', 'LICENSE'], { cwd: fixture.upstreamWork });
  git(['commit', '-m', `release ${tag}`], { cwd: fixture.upstreamWork });
  const commit = git(['rev-parse', 'HEAD'], { cwd: fixture.upstreamWork }).stdout.trim();

  if (annotated) {
    git(['tag', '-a', tag, '-m', `release ${tag}`], { cwd: fixture.upstreamWork });
  } else {
    git(['tag', tag], { cwd: fixture.upstreamWork });
  }
  git(['push', 'origin', 'main'], { cwd: fixture.upstreamWork });
  git(['push', 'origin', tag], { cwd: fixture.upstreamWork });

  await commitUpstream(fixture.upstreamWork, `post-${tag}.txt`, `post ${tag}\n`);
  const postReleaseCommit = git(['rev-parse', 'HEAD'], {
    cwd: fixture.upstreamWork,
  }).stdout.trim();
  git(['push', 'origin', 'main'], { cwd: fixture.upstreamWork });
  return { tag, commit, postReleaseCommit };
}

async function createParentSupportFiles(parent) {
  const desktopDir = join(parent, 'apps/desktop/src-tauri');
  for (const lockPath of nativeLocks) {
    await mkdir(dirname(join(parent, lockPath)), { recursive: true });
    await writeFile(join(parent, lockPath), 'version = 4\n\n[[package]]\nname = "rhwp"\nversion = "0.0.0"\n');
  }
  const vendorDir = join(parent, 'apps/studio-host/vendor/rhwp-core');
  const scriptsDir = join(parent, 'scripts');
  await mkdir(desktopDir, { recursive: true });
  await mkdir(vendorDir, { recursive: true });
  await mkdir(scriptsDir, { recursive: true });
  await writeFile(
    join(desktopDir, 'Cargo.toml'),
    '[package]\nname = "fixture"\nversion = "0.0.0"\n',
  );
  await writeFile(
    join(desktopDir, 'Cargo.lock'),
    'version = 4\n\n[[package]]\nname = "rhwp"\nversion = "0.0.0"\n',
  );
  for (const name of [
    'package.json',
    'rhwp.js',
    'rhwp.d.ts',
    'rhwp_bg.wasm',
    'rhwp_bg.wasm.d.ts',
    'LICENSE',
  ]) {
    await writeFile(join(vendorDir, name), `old ${name}\n`);
  }
  await writeFile(
    join(scriptsDir, 'write-rhwp-pin.mjs'),
    `import { appendFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (process.env.HWPLY_COMMAND_LOG) {
  appendFileSync(process.env.HWPLY_COMMAND_LOG, \`node write-rhwp-pin \${args.join(' ')}\\n\`);
}
const tag = args[args.indexOf('--tag') + 1];
const commit = args[args.indexOf('--commit') + 1];
writeFileSync('rhwp-core.lock', \`\${tag} \${commit}\\n\`);
`,
  );
  await writeFile(
    join(scriptsDir, 'verify-rhwp-pin.mjs'),
    `import { appendFileSync, existsSync } from 'node:fs';
if (process.env.HWPLY_COMMAND_LOG) {
  appendFileSync(process.env.HWPLY_COMMAND_LOG, 'node verify-rhwp-pin\\n');
}
if (!existsSync('rhwp-core.lock')) process.exit(1);
`,
  );
}

async function createFakeCommands(fakeBin) {
  await mkdir(fakeBin, { recursive: true });
  await writeFile(
    join(fakeBin, 'cargo'),
    `#!/usr/bin/env node
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (process.env.HWPLY_COMMAND_LOG) {
  appendFileSync(process.env.HWPLY_COMMAND_LOG, \`cargo \${args.join(' ')}\\n\`);
}
if (args[0] === 'update') {
  const cargo = readFileSync('third_party/rhwp/Cargo.toml', 'utf8');
  const version = cargo.match(/^version = "([^"]+)"/m)[1];
  const lockPath = args[args.indexOf('--manifest-path') + 1].replace('Cargo.toml', 'Cargo.lock');
  writeFileSync(
    lockPath,
    \`version = 4\\n\\n[[package]]\\nname = "rhwp"\\nversion = "\${version}"\\n\`,
  );
}
`,
    { mode: 0o755 },
  );
  await writeFile(
    join(fakeBin, 'wasm-pack'),
    `#!/usr/bin/env node
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (process.env.HWPLY_COMMAND_LOG) {
  appendFileSync(process.env.HWPLY_COMMAND_LOG, \`wasm-pack \${args.join(' ')}\\n\`);
}
if (args[0] === '--version') {
  console.log(\`wasm-pack \${process.env.HWPLY_FAKE_WASM_PACK_VERSION || '0.15.0'}\`);
  process.exit(0);
}
if (process.env.HWPLY_FAKE_WASM_PACK_FAIL_BUILD === '1') process.exit(31);
const output = args[args.indexOf('--out-dir') + 1];
const cargo = readFileSync('Cargo.toml', 'utf8');
const version = cargo.match(/^version = "([^"]+)"/m)[1];
mkdirSync(output, { recursive: true });
writeFileSync(\`\${output}/package.json\`, JSON.stringify({ name: 'rhwp', version }, null, 2) + '\\n');
writeFileSync(\`\${output}/rhwp.js\`, 'export default async function init() {}\\n');
writeFileSync(\`\${output}/rhwp.d.ts\`, 'export default function init(): Promise<void>;\\n');
writeFileSync(\`\${output}/rhwp_bg.wasm\`, Buffer.from([0, 97, 115, 109]));
writeFileSync(\`\${output}/rhwp_bg.wasm.d.ts\`, 'export const memory: WebAssembly.Memory;\\n');
`,
    { mode: 0o755 },
  );
  await writeFile(
    join(fakeBin, 'gh'),
    `#!/usr/bin/env node
import { appendFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (process.env.HWPLY_COMMAND_LOG) {
  appendFileSync(process.env.HWPLY_COMMAND_LOG, \`gh \${args.join(' ')}\\n\`);
}
writeFileSync(args[args.indexOf('--output') + 1], 'fixture sums\\n');
`,
    { mode: 0o755 },
  );
  await writeFile(
    join(fakeBin, 'pnpm'),
    `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
if (process.env.HWPLY_COMMAND_LOG) {
  appendFileSync(process.env.HWPLY_COMMAND_LOG, \`pnpm \${process.argv.slice(2).join(' ')}\\n\`);
}
`,
    { mode: 0o755 },
  );
}

async function commitUpstream(cwd, name, content) {
  await writeFile(join(cwd, name), content);
  git(['add', name], { cwd });
  git(['commit', '-m', `add ${name}`], { cwd });
}

function configureGitIdentity(cwd) {
  git(['config', 'user.email', 'test@example.com'], { cwd });
  git(['config', 'user.name', 'Test User'], { cwd });
}

function runUpdateScript(fixture, args = [], env = {}) {
  return spawnSync('bash', [scriptPath, ...args], {
    cwd: fixture.parent,
    env: {
      ...process.env,
      PATH: `${fixture.fakeBin}:${process.env.PATH}`,
      ...env,
    },
    encoding: 'utf8',
  });
}

function git(args, { cwd }) {
  const result = spawnSync('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
    },
    encoding: 'utf8',
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
