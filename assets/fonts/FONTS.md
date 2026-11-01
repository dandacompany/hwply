# 번들 글꼴

hwply 는 Studio UI·문서 표시와 PDF 대체(fallback)에 쓸 수 있는 **재배포 가능 글꼴만** 번들에 넣는다.
한컴 글꼴(함초롬·HY 계열)과 Microsoft·OS 기본 글꼴은 어떤 경로로도 넣지 않는다.
재배포 약관을 확인하지 못한 Cafe24 써라운드·슈퍼매직·행복고딕(Happiness Sans)은 제외한다(설계 §4).

## PDF 대체 OTF

PDF 용 OTF 는 원본 release 의 KR subset Regular 파일을 변환하거나 개명하지 않고 넣는다. Rust PDF font database 에만
적재하며 편집기의 authoring 글꼴 목록에는 노출하지 않는다.

| 파일 | 버전·출처 | SHA-256 |
| --- | --- | --- |
| `pdf/NotoSansKR-Regular.otf` | [notofonts/noto-cjk `Sans2.004`](https://github.com/notofonts/noto-cjk/blob/Sans2.004/Sans/SubsetOTF/KR/NotoSansKR-Regular.otf) | `69975a0ac8472717870aefeab0a4d52739308d90856b9955313b2ad5e0148d68` |
| `pdf/NotoSerifKR-Regular.otf` | [notofonts/noto-cjk `Serif2.003`](https://github.com/notofonts/noto-cjk/blob/Serif2.003/Serif/SubsetOTF/KR/NotoSerifKR-Regular.otf) | `5ea012e15cb7eacc1f680aee1703f3b164791b1443ea3e52b65080cca5d179cf` |

## Studio 웹폰트와 라이선스 원문

| 파일 | 라이선스 | 저작권 | 원문 |
| --- | --- | --- | --- |
| `Pretendard-*.woff2` | SIL OFL 1.1 | Kil Hyung-jin / Pretendard | `licenses/Pretendard-OFL-1.1.txt` |
| `NotoSansKR-*.woff2 · pdf/NotoSansKR-Regular.otf` | SIL OFL 1.1 | Adobe / Google (Noto) | `licenses/NotoSansKR-OFL-1.1.txt` |
| `NotoSerifKR-*.woff2 · pdf/NotoSerifKR-Regular.otf` | SIL OFL 1.1 | Adobe / Google (Noto) | `licenses/NotoSerifKR-OFL-1.1.txt` |
| `NanumGothic-Regular.woff2` | SIL OFL 1.1 | NHN Corporation (나눔) | `licenses/NanumGothic-OFL-1.1.txt` |
| `NanumMyeongjo-Regular.woff2` | SIL OFL 1.1 | NHN Corporation (나눔) | `licenses/NanumMyeongjo-OFL-1.1.txt` |
| `NanumGothicCoding-Regular.woff2` | SIL OFL 1.1 | NHN Corporation (나눔) | `licenses/NanumGothicCoding-OFL-1.1.txt` |
| `GowunBatang-Regular.woff2` | SIL OFL 1.1 | The Gowun Batang Project Authors | `licenses/GowunBatang-OFL-1.1.txt` |
| `GowunDodum-Regular.woff2` | SIL OFL 1.1 | The Gowun Dodum Project Authors | `licenses/GowunDodum-OFL-1.1.txt` |
| `D2Coding-Regular.woff2` | SIL OFL 1.1 | NAVER Corporation | `licenses/D2Coding-OFL-1.1.txt` |
| `SpoqaHanSans-Regular.woff2` | SIL OFL 1.1 | Spoqa | `licenses/SpoqaHanSans-OFL-1.1.txt` |
| `LatinModernMath-Regular.woff2` | GUST Font License 1.0 | GUST e-foundry | `licenses/LatinModernMath-GUST-FONT-LICENSE.txt` |

OFL 글꼴은 폰트 자체를 단독 판매하지 않는다. 배포 bundle 의 `licenses/fonts/` 에 이 문서와 원문이 함께 들어간다.
다른 형식으로 변환하거나 수정한 파생 글꼴은 이 목록에 추가하지 않는다.
