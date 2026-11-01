/**
 * 스파이크 S2 — `rhwp` CLI 의 구역·문단 좌표가 Studio(WASM) 의 문단 번호와 같은가.
 * CLI 쪽은 `rhwp dump <파일>` 의 `--- 문단 S.P --- cc=…, text_len=…` / `텍스트:` 줄을 읽고,
 * WASM 쪽은 같은 코어의 getSectionCount/getParagraphCount/getParagraphLength/getTextRange 를 부른다.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { HwpDocument, initSync } from '@wasm/rhwp.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const samplesDir = resolve(here, '../../../../third_party/rhwp/rhwp-studio/public/samples');
const wasmPath = resolve(here, '../../vendor/rhwp-core/rhwp_bg.wasm');
const RHWP = process.env.HWPLY_RHWP_BIN ?? 'rhwp';
const hasRhwp = spawnSync(RHWP, ['--version'], { encoding: 'utf8' }).status === 0;

interface DumpParagraph {
  section: number;
  paragraph: number;
  cc: number;
  textLen: number;
  text: string | null; // null = 빈 문단
  truncated: boolean;
}

export function parseDump(output: string): DumpParagraph[] {
  const lines = output.split('\n');
  const result: DumpParagraph[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^--- 문단 (\d+)\.(\d+) --- cc=(\d+), text_len=(\d+)/.exec(lines[i]);
    if (!m) continue;
    const textLine = lines[i + 1] ?? '';
    let text: string | null = null;
    let truncated = false;
    const t = /^\s*텍스트: "(.*)"\s*$/.exec(textLine);
    if (t) {
      text = t[1];
      // dump 는 긴 텍스트를 자르고 '...' 를 공백 없이 붙인다(예: `출...`). 진짜 말줄임표로 끝나는 문단도 앞부분 비교로 통과한다.
      if (text.endsWith('...')) { truncated = true; text = text.slice(0, -3); }
    }
    result.push({ section: Number(m[1]), paragraph: Number(m[2]), cc: Number(m[3]), textLen: Number(m[4]), text, truncated });
  }
  return result;
}

function dump(path: string): DumpParagraph[] {
  const r = spawnSync(RHWP, ['dump', path], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`rhwp dump failed: ${r.stderr}`);
  return parseDump(r.stdout);
}

const SAMPLES = ['biz_plan.hwp', 'field-01.hwp', 'footnote-01.hwp'];

describe.skipIf(!hasRhwp)('스파이크 S2: rhwp CLI 좌표 == Studio 문단 번호', () => {
  beforeAll(() => {
    initSync({ module: readFileSync(wasmPath) });
  });

  describe.each(SAMPLES)('%s', (name) => {
    const path = resolve(samplesDir, name);

    it('구역 수와 구역별 문단 수가 같다', () => {
      const doc = new HwpDocument(readFileSync(path));
      const cli = dump(path);
      const cliSections = new Map<number, number>();
      for (const p of cli) cliSections.set(p.section, Math.max(cliSections.get(p.section) ?? 0, p.paragraph + 1));
      expect(cliSections.size).toBe(doc.getSectionCount());
      for (const [section, count] of cliSections) {
        expect({ section, count }).toEqual({ section, count: doc.getParagraphCount(section) });
      }
    });

    it('문단마다 text_len 과 텍스트가 같다 (잘린 텍스트는 앞부분만)', () => {
      const doc = new HwpDocument(readFileSync(path));
      const mismatches: string[] = [];
      for (const p of dump(path)) {
        const len = doc.getParagraphLength(p.section, p.paragraph);
        if (len !== p.textLen) mismatches.push(`${p.section}.${p.paragraph}: text_len cli=${p.textLen} wasm=${len} (cc=${p.cc})`);
        const wasmText = len > 0 ? doc.getTextRange(p.section, p.paragraph, 0, len) : '';
        const cliText = p.text ?? '';
        const same = p.truncated ? wasmText.startsWith(cliText) : wasmText === cliText;
        if (!same) mismatches.push(`${p.section}.${p.paragraph}: text cli=${JSON.stringify(cliText).slice(0, 60)} wasm=${JSON.stringify(wasmText).slice(0, 60)}`);
      }
      expect(mismatches).toEqual([]);
    });
  });
});
