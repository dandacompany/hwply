import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRhwpPin } from './verify-rhwp-pin.mjs';
import { readCurrentPinState } from './rhwp-upstream-release-services.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Committed rhwp Git read failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

export async function verifyCommittedRhwp(root = repoRoot) {
  // Current state owns index/submodule/Studio readiness; acceptance additionally owns HEAD.
  const current = await readCurrentPinState({ repositoryRoot: root });
  const committed = parseRhwpPin(git(root, ['show', 'HEAD:rhwp-core.lock']));
  const headGitlink = git(root, ['ls-tree', 'HEAD', '--', 'third_party/rhwp'])
    .match(/^160000 commit ([0-9a-f]{40})\tthird_party\/rhwp$/)?.[1];
  if (headGitlink !== current.commit || committed.rhwp_commit !== current.commit
    || committed.rhwp_release_tag !== current.tag) {
    throw new Error('Committed HEAD lock/gitlink must match working lock, index gitlink and submodule HEAD');
  }
  return current;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await verifyCommittedRhwp();
    console.log(`Committed rhwp verified: ${result.tag} (${result.commit})`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
