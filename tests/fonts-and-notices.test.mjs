import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

const NOTICE_1 = '본 제품은 한글과컴퓨터의 한글 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.';
const NOTICE_2 = '"한글", "한컴", "HWP", "HWPX"는 주식회사 한글과컴퓨터의 등록 상표이며, 본 프로젝트는 한글과컴퓨터와 제휴·후원·승인 관계가 없습니다.';

test('제외 글꼴 파일이 없고 번들 글꼴마다 라이선스 파일이 있다', () => {
  const files = readdirSync('assets/fonts').filter((f) => f.endsWith('.woff2'));
  assert.equal(files.some((f) => /^(Cafe24|Happiness)/.test(f)), false, files.join(', '));
  const licenses = readdirSync('assets/fonts/licenses');
  for (const family of ['Pretendard', 'Nanum', 'D2Coding', 'GowunBatang', 'GowunDodum', 'SpoqaHanSans', 'NotoSansKR', 'NotoSerifKR', 'LatinModernMath']) {
    assert.ok(licenses.some((l) => l.startsWith(family)), `${family} 라이선스 파일 없음`);
  }
});

test('Rust·Vite 글꼴 표가 제외 글꼴을 가리키지 않는다 (FONTS.md 는 제외 사실을 적으므로 검사 대상이 아니다)', () => {
  const r = spawnSync('git', ['grep', '-I', '-i', '-l', '-E', 'cafe24|happiness|행복고딕|행복고흥|써라운드|슈퍼매직', '--',
    'apps/desktop/src-tauri/src', 'apps/studio-host/vite.config.ts'], { encoding: 'utf8' });
  assert.equal(r.status, 1, `제외 글꼴을 가리키는 파일:\n${r.stdout}`);
});

test('README·NOTICE 에 한컴 고지 두 문장이 원문 그대로', () => {
  for (const f of ['README.md', 'NOTICE.md']) {
    const t = readFileSync(f, 'utf8');
    assert.ok(t.includes(NOTICE_1), `${f}: 고지 1`);
    assert.ok(t.includes(NOTICE_2), `${f}: 고지 2`);
  }
});

test('THIRD_PARTY_LICENSES 에 rhwp 와 alhangeul-tauri 절과 MIT 전문이 있다', () => {
  const t = readFileSync('THIRD_PARTY_LICENSES.md', 'utf8');
  assert.match(t, /edwardkim\/rhwp/);
  assert.match(t, /postmelee\/alhangeul-tauri/);
  assert.match(t, /MIT License/);
  assert.match(t, /Permission is hereby granted, free of charge/);
});

test('LICENSE 는 hwply 저작권 줄로 시작하고 기반 저작권 고지를 보존한다', () => {
  const t = readFileSync('LICENSE', 'utf8');
  assert.match(t, /^MIT License\n\nCopyright \(c\) 2026 Dante Labs/);
  assert.match(t, /Copyright \(c\) 2025-2026 Edward Kim/);
});
