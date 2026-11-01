import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { verifyCommittedRhwp } from '../scripts/verify-committed-rhwp.mjs';

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function initialize(root) {
  git(root, 'init', '--initial-branch=main');
  git(root, 'config', 'user.name', 'Committed pin fixture');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  git(root, 'config', 'core.autocrlf', 'false');
  git(root, 'config', 'commit.gpgsign', 'false');
}

test('real Git acceptance rejects unstaged and staged pin changes until HEAD records lock and gitlink', async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'hwply-committed-pin-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const upstream = join(root, 'third_party', 'rhwp');
  await mkdir(join(upstream, 'rhwp-studio', 'src'), { recursive: true });
  initialize(root);
  initialize(upstream);
  await writeFile(join(upstream, 'rhwp-studio', 'index.html'), 'fixture');
  await writeFile(join(upstream, 'rhwp-studio', 'src', 'main.ts'), 'export {};');
  git(upstream, 'add', '.');
  git(upstream, 'commit', '-m', 'upstream baseline');
  const previous = git(upstream, 'rev-parse', 'HEAD');
  const template = await readFile(new URL('../rhwp-core.lock', import.meta.url), 'utf8');
  const lock = (commit) => template.replace(/rhwp_commit = "[0-9a-f]{40}"/, `rhwp_commit = "${commit}"`);
  await writeFile(join(root, 'rhwp-core.lock'), lock(previous));
  git(root, 'add', 'rhwp-core.lock', 'third_party/rhwp');
  git(root, 'commit', '-m', 'committed baseline');
  assert.equal((await verifyCommittedRhwp(root)).commit, previous);

  await writeFile(join(upstream, 'new-source.txt'), 'new upstream');
  git(upstream, 'add', '.');
  git(upstream, 'commit', '-m', 'new upstream');
  const next = git(upstream, 'rev-parse', 'HEAD');
  await writeFile(join(root, 'rhwp-core.lock'), lock(next));
  await assert.rejects(verifyCommittedRhwp(root), /gitlink가 current lock commit과 다릅니다/);
  git(root, 'add', 'rhwp-core.lock', 'third_party/rhwp');
  await assert.rejects(verifyCommittedRhwp(root), /Committed HEAD lock\/gitlink/);
  git(root, 'commit', '-m', 'accept new pin');
  assert.equal((await verifyCommittedRhwp(root)).commit, next);
});

test('current repository committed lock, index and submodule agree', async () => {
  const pin = await verifyCommittedRhwp();
  assert.match(pin.tag, /^v\d+\.\d+\.\d+$/);
  assert.match(pin.commit, /^[0-9a-f]{40}$/);
});
