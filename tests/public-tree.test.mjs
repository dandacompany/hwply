import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// 이 저장소는 공개 저장소다. 추적되는 파일에 개발 메타·개인 환경·비밀처럼 보이는 문자열이 없어야 한다.
// 검사 문자열은 조각으로 나눠 이 파일이 스스로 걸리지 않게 한다.
const PATTERN = new RegExp(
  ['sk-[a-z0-9]{16,}', 'api[_-]?key\\s*=', 'Claude' + '-Session', 'session' + '_01', 'super' + 'powers',
    '/Users/' + 'dante', '\\.claude/' + 'auth', 'Dante' + 'Mac'].join('|'),
  'i',
);
const NOTICE_1 = '본 제품은 한글과컴퓨터의 한글 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.';
const NOTICE_2 = '"한글", "한컴", "HWP", "HWPX"는 주식회사 한글과컴퓨터의 등록 상표이며, 본 프로젝트는 한글과컴퓨터와 제휴·후원·승인 관계가 없습니다.';

function trackedFiles() {
  const r = spawnSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.split('\0').filter(Boolean).filter((f) => f !== 'third_party/rhwp');
}

test('tracked files exclude internal design docs and local release config', () => {
  const files = trackedFiles();
  const meta = ['docs/' + ['super', 'powers'].join(''), '.' + ['super', 'powers'].join('')];
  assert.deepEqual(files.filter((f) => meta.some((m) => f.startsWith(m))), []);
  assert.ok(!files.includes('scripts/release/macos.local.env'), '이 맥 전용 릴리스 설정이 추적된다');
  assert.ok(files.includes('scripts/release/macos.local.env.example'));
});

test('tracked files pass secret and meta scan', () => {
  const hits = [];
  for (const f of trackedFiles()) {
    let text;
    try {
      text = readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    if (text.includes('\0')) continue; // 바이너리
    text.split('\n').forEach((line, i) => {
      // .gitignore 는 숨길 폴더 이름을 적어야 한다(내용이 아니라 경로 규칙). 주석 아닌 무시 규칙 줄만 예외.
      if (f === '.gitignore' && /^[^#\s]\S*\/$/.test(line)) return;
      if (PATTERN.test(line)) hits.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(hits, []);
});

test('readme carries both trademark sentences verbatim', () => {
  const readme = readFileSync('README.md', 'utf8');
  assert.ok(readme.includes(NOTICE_1));
  assert.ok(readme.includes(NOTICE_2));
});

test('readme names the release page as the only download source', () => {
  const readme = readFileSync('README.md', 'utf8');
  assert.match(readme, /https:\/\/github\.com\/dandacompany\/hwply\/releases/);
  assert.match(readme, /공식 배포처는 이 저장소의 Releases 뿐/);
  assert.doesNotMatch(readme, /비공개|docs\//);
});
