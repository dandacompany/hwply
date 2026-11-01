const stableTagPattern = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const shaPattern = /^[0-9a-f]{40}$/;
const automationBranchPattern =
  /^automation\/rhwp-v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-full-sync$/;

export function selectMaximumStableRelease(releases) {
  if (!Array.isArray(releases)) throw new Error('GitHub release 목록이 배열이 아닙니다.');
  const stable = releases.filter((release) => release?.draft === false
    && release?.prerelease === false
    && stableTagPattern.test(release?.tag_name ?? ''));
  if (stable.length === 0) throw new Error('공개 Stable release를 찾을 수 없습니다.');
  const selected = stable.reduce((maximum, release) => (
    compareStableTags(release.tag_name, maximum.tag_name) > 0 ? release : maximum
  ));
  return validateStableRelease(selected);
}

export function validateStableRelease(release, requestedTag) {
  if (!release || typeof release !== 'object') {
    throw new Error('GitHub release metadata가 객체가 아닙니다.');
  }
  assertStableTag(release.tag_name);
  if (requestedTag && release.tag_name !== requestedTag) {
    throw new Error(`요청 tag와 release tag가 다릅니다: ${release.tag_name}`);
  }
  if (release.draft !== false || release.prerelease !== false) {
    throw new Error(`공개 Stable release가 아닙니다: ${release.tag_name}`);
  }
  assertReleaseUrl(release.html_url, release.tag_name);
  return release;
}

export function resolveTagCommit(lsRemoteOutput, tag) {
  assertStableTag(tag);
  const baseRef = `refs/tags/${tag}`;
  const refs = new Map();
  for (const line of lsRemoteOutput.trim().split(/\r?\n/).filter(Boolean)) {
    const match = line.match(/^([0-9a-f]{40})\s+(.+)$/);
    if (!match) throw new Error(`git ls-remote 응답이 올바르지 않습니다: ${line}`);
    refs.set(match[2], match[1]);
  }
  const commit = refs.get(`${baseRef}^{}`) ?? refs.get(baseRef);
  if (!commit) throw new Error(`upstream release tag를 찾을 수 없습니다: ${tag}`);
  assertSha(commit, 'resolved tag commit');
  return commit;
}

export function assertCurrentPinState(state) {
  assertStableTag(state.tag);
  assertSha(state.commit, 'current lock commit');
  for (const [label, value] of [
    ['gitlink', state.gitlinkCommit],
    ['submodule HEAD', state.submoduleCommit],
  ]) {
    if (value !== state.commit) {
      throw new Error(`${label}가 current lock commit과 다릅니다: ${value}`);
    }
  }
  if (state.studioIndexPresent !== true || state.studioMainPresent !== true) {
    throw new Error('exact upstream Studio entry가 누락되었습니다.');
  }
  return Object.freeze({ tag: state.tag, commit: state.commit });
}

export function assertSubmoduleWorktree(expectedRoot, actualTopLevel) {
  if (typeof actualTopLevel !== 'string' || actualTopLevel.length === 0
    || normalizePath(actualTopLevel) !== normalizePath(expectedRoot)) {
    throw new Error(
      'third_party/rhwp submodule이 초기화되지 않았습니다. '
      + '`git submodule update --init --recursive third_party/rhwp`를 실행하세요.',
    );
  }
}

export function compareStableTags(left, right) {
  assertStableTag(left);
  assertStableTag(right);
  const leftParts = left.slice(1).split('.').map(Number);
  const rightParts = right.slice(1).split('.').map(Number);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
}

export function automationBranch(tag) {
  assertStableTag(tag);
  return `automation/rhwp-${tag}-full-sync`;
}

export function isAutomationBranch(branch) {
  return typeof branch === 'string' && automationBranchPattern.test(branch);
}

export function assertBaseBranch(branch) {
  if (typeof branch !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch)
    || branch.includes('..') || branch.includes('//') || branch.endsWith('/')
    || branch.endsWith('.') || branch.includes('@{')) {
    throw new Error(`base branch 형식이 올바르지 않습니다: ${branch}`);
  }
}

export function assertRepository(repository) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error(`GitHub repository 형식이 올바르지 않습니다: ${repository}`);
  }
}

export function assertStableTag(tag) {
  if (!stableTagPattern.test(tag)) throw new Error(`Stable release tag 형식이 올바르지 않습니다: ${tag}`);
}

export function assertSha(value, label) {
  if (!shaPattern.test(value ?? '')) throw new Error(`${label} 형식이 올바르지 않습니다: ${value}`);
}

export function assertReleaseUrl(value, tag) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`release URL이 올바르지 않습니다: ${value}`); }
  if (url.origin !== 'https://github.com' || url.username || url.password || url.search || url.hash
    || url.pathname !== `/edwardkim/rhwp/releases/tag/${tag}`) {
    throw new Error(`release URL이 올바르지 않습니다: ${value}`);
  }
}

export function assertSingleLine(value, label) {
  if (typeof value !== 'string' || /[\r\n]/.test(value)) {
    throw new Error(`${label} 출력이 올바르지 않습니다.`);
  }
}

function normalizePath(path) {
  return path.replaceAll('\\', '/').replace(/\/$/, '');
}
