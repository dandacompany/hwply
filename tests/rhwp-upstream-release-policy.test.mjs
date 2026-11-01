import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertBaseBranch,
  assertSubmoduleWorktree,
  selectMaximumStableRelease,
} from '../scripts/rhwp-upstream-release-policy.mjs';
import { classifyCandidatePulls } from '../scripts/rhwp-upstream-release-services.mjs';

test('목록 순서가 아니라 exact semver 최댓값을 Stable로 선택한다', () => {
  const selected = selectMaximumStableRelease([
    release('v0.8.4'),
    release('v0.9.0', { prerelease: true }),
    release('nightly'),
    release('v0.7.6'),
    release('v0.10.0'),
  ]);
  assert.equal(selected.tag_name, 'v0.10.0');
});

test('공개 exact semver Stable이 없으면 진단적으로 실패한다', () => {
  assert.throws(
    () => selectMaximumStableRelease([release('latest'), release('v1.0.0', { draft: true })]),
    /공개 Stable release를 찾을 수 없습니다/,
  );
});

test('base branch traversal과 비정상 ref를 거부한다', () => {
  assert.doesNotThrow(() => assertBaseBranch('integration/rhwp'));
  for (const branch of ['', '../devel', 'a..b', 'a//b', 'devel.', 'a@{b', 'a b']) {
    assert.throws(() => assertBaseBranch(branch), /base branch 형식/);
  }
});

test('submodule worktree root가 superproject로 올라가면 초기화 명령을 안내한다', () => {
  assert.doesNotThrow(() => assertSubmoduleWorktree('/repo/third_party/rhwp', '/repo/third_party/rhwp'));
  assert.throws(
    () => assertSubmoduleWorktree('/repo/third_party/rhwp', '/repo'),
    /git submodule update --init --recursive third_party\/rhwp/,
  );
});

test('현재 저장소의 automation PR만 tag별 candidate로 분류한다', () => {
  const result = classifyCandidatePulls({
    pulls: [
      pull(40, 'automation/rhwp-v0.8.4-full-sync'),
      pull(41, 'automation/rhwp-v0.8.5-full-sync'),
      pull(42, 'feature/not-candidate'),
      pull(43, 'automation/rhwp-v0.8.6-full-sync', 'someone/fork'),
    ],
    branch: 'automation/rhwp-v0.8.5-full-sync',
    productRepository: 'dandacompany/hwply',
    branchExists: true,
  });
  assert.deepEqual(result, {
    branchExists: true,
    prUrl: 'https://github.com/dandacompany/hwply/pull/41',
    otherPrUrl: 'https://github.com/dandacompany/hwply/pull/40',
    candidateCount: 2,
  });
});

function release(tag_name, overrides = {}) {
  return {
    tag_name,
    draft: false,
    prerelease: false,
    html_url: `https://github.com/edwardkim/rhwp/releases/tag/${tag_name}`,
    ...overrides,
  };
}

function pull(number, ref, repository = 'dandacompany/hwply') {
  return {
    number,
    html_url: `https://github.com/dandacompany/hwply/pull/${number}`,
    head: { ref, repo: { full_name: repository } },
  };
}
