#!/usr/bin/env node

import { appendFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertBaseBranch,
  assertRepository,
  assertSha,
  assertSingleLine,
  assertStableTag,
  automationBranch,
  compareStableTags,
  resolveTagCommit,
  validateStableRelease,
  assertCurrentPinState,
} from './rhwp-upstream-release-policy.mjs';
import {
  fetchReleaseMetadata,
  readCandidateState,
  readCurrentPinState,
  resolveRemoteTag,
} from './rhwp-upstream-release-services.mjs';

export { assertCurrentPinState, resolveTagCommit, validateStableRelease };

const defaultRepositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultProductRepository = 'dandacompany/hwply';
const defaultBaseBranch = 'devel';
const usage = `Usage: node scripts/check-rhwp-upstream-release.mjs
  [--target-tag vX.Y.Z] [--base-branch <branch>] [--dry-run]
  [--json-output <path>] [--github-output <path>]`;

export async function checkRhwpUpstreamRelease(options = {}) {
  const repositoryRoot = resolve(options.repositoryRoot ?? defaultRepositoryRoot);
  const productRepository = options.productRepository
    ?? process.env.GITHUB_REPOSITORY
    ?? defaultProductRepository;
  const baseBranch = options.baseBranch ?? process.env.BASE_BRANCH ?? defaultBaseBranch;
  assertRepository(productRepository);
  assertBaseBranch(baseBranch);
  if (options.targetTag !== undefined) assertStableTag(options.targetTag);

  const services = {
    fetchRelease: fetchReleaseMetadata,
    resolveTag: resolveRemoteTag,
    readCurrent: readCurrentPinState,
    readCandidate: readCandidateState,
    ...options.services,
  };
  const release = validateStableRelease(
    await services.fetchRelease({ targetTag: options.targetTag }),
    options.targetTag,
  );
  const targetCommit = await services.resolveTag(release.tag_name);
  assertSha(targetCommit, 'resolved tag commit');
  const current = await services.readCurrent({ repositoryRoot });
  const branch = automationBranch(release.tag_name);
  const relation = compareStableTags(release.tag_name, current.tag);

  let decision;
  let existingPrUrl = '';
  let candidateCount = 0;
  if (relation === 0) {
    if (current.commit !== targetCommit) {
      throw new Error(`고정된 Stable release tag의 resolved commit이 이동했습니다: ${release.tag_name}`);
    }
    decision = 'current';
  } else if (relation < 0) {
    if (options.targetTag) {
      throw new Error(`현재 pin보다 낮은 release로 자동 동기화할 수 없습니다: ${release.tag_name}`);
    }
    decision = 'upstream_behind_current';
  } else if (options.dryRun === true) {
    decision = 'dry_run';
  } else {
    const candidate = await services.readCandidate({
      branch,
      productRepository,
      baseBranch,
      repositoryRoot,
    });
    candidateCount = candidate.candidateCount ?? Number(Boolean(candidate.prUrl));
    if (candidate.candidateCount > 1) {
      decision = 'candidate_blocker';
      existingPrUrl = candidate.otherPrUrl || candidate.prUrl;
    } else if (candidate.prUrl) {
      decision = 'existing_pr';
      existingPrUrl = candidate.prUrl;
    } else if (candidate.otherPrUrl) {
      decision = 'candidate_blocker';
      existingPrUrl = candidate.otherPrUrl;
    } else if (candidate.branchExists) {
      decision = 'branch_blocker';
    } else {
      decision = 'create_candidate';
    }
  }

  return Object.freeze({
    currentTag: current.tag,
    currentCommit: current.commit,
    targetTag: release.tag_name,
    targetCommit,
    releaseUrl: release.html_url,
    baseBranch,
    branch,
    decision,
    existingPrUrl,
    candidateCount,
  });
}

export async function writeReleaseCheckOutputs(result, options = {}) {
  if (options.jsonOutput) {
    await (options.writeFile ?? writeFile)(
      resolve(options.jsonOutput),
      `${JSON.stringify(result, null, 2)}\n`,
    );
  }
  if (options.githubOutput) {
    const lines = Object.entries({
      current_tag: result.currentTag,
      current_commit: result.currentCommit,
      target_tag: result.targetTag,
      target_commit: result.targetCommit,
      release_url: result.releaseUrl,
      base_branch: result.baseBranch,
      branch: result.branch,
      decision: result.decision,
      existing_pr_url: result.existingPrUrl,
      candidate_count: String(result.candidateCount),
    });
    for (const [key, value] of lines) assertSingleLine(value, key);
    await (options.appendFile ?? appendFile)(
      resolve(options.githubOutput),
      `${lines.map(([key, value]) => `${key}=${value}`).join('\n')}\n`,
    );
  }
}

function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help') return { help: true };
    if (arg === '--dry-run') options.dryRun = true;
    else if (['--target-tag', '--base-branch', '--json-output', '--github-output'].includes(arg)) {
      const value = args[index + 1];
      if (!value) throw new Error(`${arg} 값이 필요합니다.\n${usage}`);
      options[arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
      index += 1;
    } else throw new Error(`지원하지 않는 인자입니다: ${arg}\n${usage}`);
  }
  return options;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) console.log(usage);
    else {
      const result = await checkRhwpUpstreamRelease(options);
      await writeReleaseCheckOutputs(result, options);
      console.log(`rhwp upstream check: ${result.decision} (${result.targetTag} ${result.targetCommit})`);
    }
  } catch (error) {
    console.error(`rhwp upstream check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
