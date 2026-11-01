import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const DIR = 'skill/hwply';
const read = (p) => readFileSync(p, 'utf8');

function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, 'frontmatter 없음');
  return Object.fromEntries(
    m[1].split('\n').map((line) => {
      const i = line.indexOf(':');
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    }),
  );
}

test('frontmatter has name hwply and one-line plain description', () => {
  const text = read(`${DIR}/SKILL.md`);
  const fm = frontmatter(text);
  assert.equal(fm.name, 'hwply');
  const d = fm.description;
  assert.ok(d && d.length > 40, 'description 이 비었거나 짧다');
  assert.doesNotMatch(d, /^[>|[]/, '폴드 스칼라·배열 금지');
  assert.doesNotMatch(d, /[<>[\]]/, '대괄호·꺾쇠 금지');
  assert.doesNotMatch(d, /: /, '": " 금지');
  for (const word of ['hwply', '열린', 'rhwp']) assert.ok(d.includes(word), `트리거 ${word} 없음`);
});

test('open-document section comes first and names every exit code', () => {
  const body = read(`${DIR}/SKILL.md`).replace(/^---[\s\S]*?\n---\n/, '');
  const headings = [...body.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  assert.match(headings[0] ?? '', /열린 문서 다루기/);
  const first = body.split(/^## /m)[1];
  for (const code of ['0', '1', '2', '3', '4', '5']) {
    assert.match(first, new RegExp(`\\|\\s*\`?${code}\`?\\s*\\|`), `종료 코드 ${code} 가 표에 없다`);
  }
  for (const cmd of ['hwply docs', 'hwply read', 'hwply set-text', 'hwply checkout', 'hwply checkin', 'hwply save', 'hwply focus', 'hwply doctor']) {
    assert.ok(first.includes(cmd), `${cmd} 안내 없음`);
  }
});

test('every references link resolves', () => {
  const text = read(`${DIR}/SKILL.md`);
  const links = [...text.matchAll(/references\/([\w-]+\.md)/g)].map((m) => m[1]);
  assert.ok(links.length >= 10, `참조 링크가 ${links.length}개뿐`);
  for (const name of links) assert.ok(existsSync(`${DIR}/references/${name}`), `${name} 없음`);
  assert.ok(existsSync(`${DIR}/LICENSE-rhwp`), '상류 라이선스 없음');
});

test('no personal environment traces', () => {
  const files = ['SKILL.md', ...readdirSync(`${DIR}/references`).map((f) => `references/${f}`)];
  for (const f of files) {
    const t = read(`${DIR}/${f}`);
    // 검사 문자열은 조각으로 나눠 이 테스트 파일이 공개 트리 스캔에 걸리지 않게 한다.
    const traces = new RegExp(['/Users/', 'Dante' + 'Mac', '\\.claude/' + 'auth', 'super' + 'powers', 'rhwp-<버전>'].join('|'));
    assert.doesNotMatch(t, traces, f);
  }
});

test('tauri bundles the skill directory', () => {
  const conf = JSON.parse(read('apps/desktop/src-tauri/tauri.conf.json'));
  assert.equal(conf.bundle.resources['../../../skill/hwply/'], 'skill/hwply/');
});
