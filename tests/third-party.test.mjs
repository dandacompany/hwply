import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const text = readFileSync('THIRD_PARTY_LICENSES.md', 'utf8');

function section(heading) {
  const start = text.indexOf(heading);
  assert.ok(start >= 0, `${heading} 절이 없다`);
  const next = text.indexOf('\n## ', start + 1);
  return text.slice(start, next < 0 ? undefined : next);
}

function rows(body) {
  return body.split('\n').filter((line) => /^\| [^-]/.test(line) && !line.startsWith('| 크레이트') && !line.startsWith('| 패키지'));
}

test('Rust 표에 브리지·CLI 의존성이 있고 머리말 개수와 행 수가 같다', () => {
  const body = section('## 4. Rust 의존성');
  for (const crate of ['axum', 'clap', 'ureq', 'async-trait', 'unicode-normalization']) {
    assert.match(body, new RegExp(`^\\| ${crate} \\|`, 'm'), crate);
  }
  const declared = Number(/(\d+)개\)/.exec(body)?.[1]);
  assert.equal(rows(body).length, declared);
});

test('npm 표에 happy-dom 이 있고 머리말 개수와 행 수가 같다', () => {
  const body = section('## 5. npm 의존성');
  assert.match(body, /^\| happy-dom \|/m);
  const declared = Number(/(\d+)개\)/.exec(body)?.[1]);
  assert.equal(rows(body).length, declared);
});
