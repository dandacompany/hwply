import { describe, expect, it } from 'vitest';
import { aboutDialogContent } from './about-dialog';

describe('aboutDialogContent', () => {
  it('정보 화면에 제품명·rhwp 버전·한컴 고지 두 문장', () => {
    const c = aboutDialogContent();
    expect(c.productName).toBe('hwply');
    expect(c.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(c.rhwpVersion).toBe('0.8.7');
    expect(c.rhwpCommit.startsWith('1a76570e')).toBe(true);
    expect(c.notices).toContain('본 제품은 한글과컴퓨터의 한글 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.');
    expect(c.notices).toContain('"한글", "한컴", "HWP", "HWPX"는 주식회사 한글과컴퓨터의 등록 상표이며, 본 프로젝트는 한글과컴퓨터와 제휴·후원·승인 관계가 없습니다.');
  });
});
