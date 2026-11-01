import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';

const ci = parse(readFileSync('.github/workflows/ci.yml', 'utf8'));

test('desktop job 은 macOS·Windows 러너에서만 돈다', () => {
  assert.deepEqual(ci.jobs.desktop.strategy.matrix.os, ['macos-15', 'windows-2025']);
  assert.equal(JSON.stringify(ci.jobs.desktop).includes('ubuntu'), false);
});

test('checks job 은 상류 서브모듈을 init.sh 로 가져온다', () => {
  const steps = ci.jobs.checks.steps.map((s) => s.run ?? '').join('\n');
  assert.match(steps, /scripts\/upstream\/init\.sh/);
});

test('모든 워크플로의 외부 action 은 커밋 SHA 로 고정돼 있다', () => {
  for (const file of readdirSync('.github/workflows')) {
    const doc = parse(readFileSync(`.github/workflows/${file}`, 'utf8'));
    for (const job of Object.values(doc.jobs)) {
      for (const step of job.steps ?? []) {
        if (!step.uses || step.uses.startsWith('./')) continue;
        assert.match(step.uses, /@[0-9a-f]{40}$/, `${file}: ${step.uses}`);
      }
    }
  }
});

test('트리거는 main push·pull_request·workflow_dispatch', () => {
  const on = ci.on ?? ci[true];
  assert.deepEqual(on.push.branches, ['main']);
  assert.ok('pull_request' in on);
  assert.ok('workflow_dispatch' in on);
});

const releasePath = '.github/workflows/release.yml';

test('release workflow pins actions and limits permissions', () => {
  const release = parse(readFileSync(releasePath, 'utf8'));
  assert.deepEqual(release.permissions, { contents: 'read' }, '기본은 읽기 전용');
  const jobs = Object.entries(release.jobs);
  assert.equal(jobs.length, 1);
  const [, job] = jobs[0];
  assert.equal(job['runs-on'], 'windows-2025');
  assert.deepEqual(job.permissions, { contents: 'write' }, '릴리스 초안에 올리는 job 만 쓰기');
  const text = readFileSync(releasePath, 'utf8');
  assert.match(text, /TAURI_SIGNING_PRIVATE_KEY: \$\{\{ secrets\.TAURI_SIGNING_PRIVATE_KEY \}\}/);
  assert.match(text, /--draft/, '태그 빌드는 초안에만 올린다(게시는 사람이)');
  assert.doesNotMatch(text, /--draft=false|gh release edit/, '워크플로가 릴리스를 게시하지 않는다');
});

test('release workflow triggers only on tags and dispatch', () => {
  const release = parse(readFileSync(releasePath, 'utf8'));
  const on = release.on ?? release[true];
  assert.deepEqual(Object.keys(on).sort(), ['push', 'workflow_dispatch']);
  assert.deepEqual(on.push, { tags: ['v*'] });
});
