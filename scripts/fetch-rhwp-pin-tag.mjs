#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRhwpPin } from './verify-rhwp-pin.mjs';

const STABLE_TAG_PATTERN = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/;

export async function fetchPinnedRhwpTag({ repoRoot, gitRunner = git }) {
  const pin = await readRhwpPin({ repoRoot });
  fetchPinnedRhwpTagFromPin({ repoRoot, pin, gitRunner });
  return pin;
}

export function fetchPinnedRhwpTagFromPin({ repoRoot, pin, gitRunner = git }) {
  validateFetchPin(pin);
  const submoduleDir = resolve(repoRoot, 'third_party/rhwp');
  const actualOrigin = gitRunner(['remote', 'get-url', 'origin'], submoduleDir);
  if (actualOrigin !== pin.rhwp_repo) {
    throw new Error(`submodule origin이 lock repository와 다릅니다: ${actualOrigin}`);
  }

  const actualCommit = gitRunner(['rev-parse', 'HEAD'], submoduleDir);
  if (actualCommit !== pin.rhwp_commit) {
    throw new Error(`submodule HEAD가 lock commit과 다릅니다: ${actualCommit}`);
  }

  const tagRef = `refs/tags/${pin.rhwp_release_tag}`;
  gitRunner(
    [
      'fetch',
      '--no-tags',
      '--depth=1',
      'origin',
      `+${tagRef}:${tagRef}`,
    ],
    submoduleDir,
  );

  const resolvedTagCommit = gitRunner(
    ['rev-parse', '--verify', `${tagRef}^{commit}`],
    submoduleDir,
  );
  if (resolvedTagCommit !== pin.rhwp_commit) {
    throw new Error(
      `release tag와 lock commit이 다릅니다: ${pin.rhwp_release_tag} -> ${resolvedTagCommit}`,
    );
  }
}

function validateFetchPin(pin) {
  if (!pin || typeof pin !== 'object') {
    throw new Error('rhwp pin 입력이 필요합니다.');
  }
  if (typeof pin.rhwp_repo !== 'string' || pin.rhwp_repo === '') {
    throw new Error('rhwp repository pin이 필요합니다.');
  }
  if (!STABLE_TAG_PATTERN.test(pin.rhwp_release_tag)) {
    throw new Error(`stable release tag가 올바르지 않습니다: ${pin.rhwp_release_tag}`);
  }
  if (!SHA_PATTERN.test(pin.rhwp_commit)) {
    throw new Error(`rhwp commit SHA가 올바르지 않습니다: ${pin.rhwp_commit}`);
  }
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
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(' ')} 실패\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  return result.stdout.trim();
}

async function main() {
  const repoRoot = git(['rev-parse', '--show-toplevel'], process.cwd());
  const pin = await fetchPinnedRhwpTag({ repoRoot });
  console.log(
    `rhwp release tag fetched: ${pin.rhwp_release_tag} (${pin.rhwp_commit})`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`rhwp release tag fetch failed: ${error.message}`);
    process.exitCode = 1;
  });
}
