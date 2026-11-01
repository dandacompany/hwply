import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readRhwpPin, RHWP_REPOSITORY } from './verify-rhwp-pin.mjs';
import {
  assertCurrentPinState,
  assertSingleLine,
  assertSubmoduleWorktree,
  isAutomationBranch,
  resolveTagCommit,
  selectMaximumStableRelease,
} from './rhwp-upstream-release-policy.mjs';

const upstreamApiRepository = 'edwardkim/rhwp';

export async function fetchReleaseMetadata({ targetTag }) {
  if (targetTag) {
    return JSON.parse(run('gh', [
      'api',
      `repos/${upstreamApiRepository}/releases/tags/${encodeURIComponent(targetTag)}`,
    ]));
  }
  const pages = parsePaginatedArrays(run('gh', [
    'api',
    '--paginate',
    '--slurp',
    `repos/${upstreamApiRepository}/releases?per_page=100`,
  ]), 'GitHub release');
  return selectMaximumStableRelease(pages.flat());
}

export async function resolveRemoteTag(tag) {
  const baseRef = `refs/tags/${tag}`;
  const output = run('git', ['ls-remote', RHWP_REPOSITORY, baseRef, `${baseRef}^{}`]);
  return resolveTagCommit(output, tag);
}

export async function readCurrentPinState({ repositoryRoot }) {
  const pin = await readRhwpPin({ repoRoot: repositoryRoot });
  const gitlink = run('git', ['ls-files', '--stage', 'third_party/rhwp'], {
    cwd: repositoryRoot,
  }).match(/^160000 ([0-9a-f]{40}) 0\tthird_party\/rhwp$/)?.[1];
  const submoduleRoot = resolve(repositoryRoot, 'third_party/rhwp');
  const topLevel = run('git', ['rev-parse', '--show-toplevel'], { cwd: submoduleRoot });
  assertSubmoduleWorktree(submoduleRoot, topLevel);
  const [studioIndex, studioMain] = await Promise.all([
    readOptional(resolve(submoduleRoot, 'rhwp-studio/index.html')),
    readOptional(resolve(submoduleRoot, 'rhwp-studio/src/main.ts')),
  ]);
  return assertCurrentPinState({
    tag: pin.rhwp_release_tag,
    commit: pin.rhwp_commit,
    gitlinkCommit: gitlink,
    submoduleCommit: run('git', ['rev-parse', 'HEAD'], { cwd: submoduleRoot }),
    studioIndexPresent: studioIndex.length > 0,
    studioMainPresent: studioMain.length > 0,
  });
}

export async function readCandidateState({
  branch,
  productRepository,
  baseBranch,
  repositoryRoot,
}) {
  const branchExists = run('git', ['ls-remote', 'origin', `refs/heads/${branch}`], {
    cwd: repositoryRoot,
  }).trim() !== '';
  const query = new URLSearchParams({ state: 'open', base: baseBranch, per_page: '100' });
  const pages = parsePaginatedArrays(run('gh', [
    'api',
    '--paginate',
    '--slurp',
    `repos/${productRepository}/pulls?${query}`,
  ]), 'GitHub pull request');
  return classifyCandidatePulls({
    pulls: pages.flat(),
    branch,
    productRepository,
    branchExists,
  });
}

export function classifyCandidatePulls({ pulls, branch, productRepository, branchExists }) {
  if (!Array.isArray(pulls)) throw new Error('GitHub pull request 목록이 배열이 아닙니다.');
  const candidates = pulls
    .filter((pull) => pull?.head?.repo?.full_name === productRepository
      && isAutomationBranch(pull?.head?.ref))
    .sort((left, right) => (left.number ?? 0) - (right.number ?? 0));
  const matching = candidates.find((pull) => pull.head.ref === branch);
  const other = candidates.find((pull) => pull.head.ref !== branch);
  for (const url of [matching?.html_url, other?.html_url].filter(Boolean)) {
    assertSingleLine(url, 'candidate PR URL');
  }
  return {
    branchExists,
    prUrl: matching?.html_url ?? '',
    otherPrUrl: other?.html_url ?? '',
    candidateCount: candidates.length,
  };
}

function parsePaginatedArrays(source, label) {
  const pages = JSON.parse(source);
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
    throw new Error(`${label} paginated 응답이 배열 목록이 아닙니다.`);
  }
  return pages;
}

async function readOptional(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  if (result.error) throw new Error(`${command} 실행 실패: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${command} ${args[0]} 실패 (${result.status}): ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}
