# 로컬 폰트 해석 규칙

Alhangeul은 `third_party/rhwp`를 수정하지 않고 desktop shell과 studio host adapter에서 로컬 폰트 해석을 소유한다.

## 목표

- 실제 OS 설치 폰트가 있으면 Alhangeul 번들 substitute보다 우선한다.
- 지원된 로컬 파일 기반 폰트는 저장소나 배포물에 번들하지 않고 editor와 PDF export에서 같은 규칙으로 해석한다.
- proprietary 폰트 바이너리를 업로드, 로그 출력 또는 번들링하지 않는다.

## 해석 순서

1. system-installed 폰트
2. 지원된 file-backed 폰트
3. Alhangeul 번들 substitute 폰트

`apps/desktop/src-tauri/src/font_catalog.rs`가 native font catalog와 추가 스캔 root를 소유한다. PDF는
system·file-backed font 뒤에 `assets/fonts/pdf/`의 Noto Sans/Serif KR Regular를 마지막 fallback으로
적재한다. `apps/studio-host/src/core/font-loader.ts`는 upstream loader를 그대로 다시 내보내며,
`local-fonts.ts`와 분리된 provider·record adapter만 native catalog를 읽어 webview에 필요한
file-backed 폰트를 `FontFace`로 등록한다.

native catalog는 `font_names.rs`에서 실제 name table의 legacy family·full name·typographic
family를 함께 보존한다. `나눔스퀘어 Bold`처럼 문서에 저장된 face 이름을 묶음 family와
구분한다. 같은 파일·PostScript·style·weight의 다국어 행은 하나의 record로 합치지만
다른 파일이나 굵기는 통합하지 않는다. 정확한 PostScript/full name을 우선하며 여전히
모호한 family 요청에는 임의의 face를 선택하지 않는다.

file-backed CSS 등록은 선택된 full face 이름과 요청 별칭을 사용해 Regular/Bold 충돌을
피한다. 직접 등록하지 않는 system-installed 경로는 OS의 CSS family를 유지한다.
CanvasKit의 fullName 재조회와 byte cache는 선택된 파일·face의 식별자를 유지한다.
이 이름 보정은 native read 허용 root나 PDF·인쇄 경로의 지원 범위를 확대하지 않는다.

## 사용 선택과 복원

처음 로컬 글꼴 사용 안내에서 사용/미사용을 선택하면 앱 데이터 폴더의
`local-font-preferences.json`에 version 1과 선택만 저장한다. 목록·경로·글꼴 bytes를
설정 파일에 보관하지 않는다. 사용 선택은 문서 진입과 새 창에서 복원해 감지하며,
native service는 디스크 설정을 읽으므로 새 프로세스에서도 같은 선택을 복원하도록 구현되어 있다.
실제 설치본의 재실행 수용 여부는 아래 검증 범위와 별도로 확인한다.

- **사용**: 현재 지원 catalog와 문서에 필요한 글꼴 공급을 활성화한다.
- **사용 안 함**: 제품의 직접 감지·공급을 중단한다. OS의 CSS 글꼴 해석 전체를 차단하지 않는다.
- **닫기/Escape**: 영구 선택을 저장하지 않고 해당 앱 실행 중의 반복 안내만 억제한다.
- **설정 저장 실패**: 선택은 해당 창에만 임시 적용하며 저장 성공이나 재실행 지속으로 안내하지 않는다.
- **설정 읽기 실패**: 자동 직접 공급을 중단하고 설정 메뉴에서 다시 선택할 수 있도록 안내한다.

도구 메뉴의 **로컬 글꼴 설정…**에서 선택을 바꾸거나 **다시 감지**할 수 있다.
설정은 창 간 revision 이벤트로 전달하고 문서 진입·focus 복귀의 snapshot으로 누락을 회복한다.
내부 상태의 `stored=true`와 `storage=native-preference`는 사용 선택 저장을 뜻하며,
감지 목록 저장이나 모든 글꼴의 화면 적용 완료를 뜻하지 않는다.
이 선택은 editor의 직접 감지·공급 설정이다. 별도 native 경로인 PDF·인쇄·썸네일의
폰트 정책을 함께 변경하는 전역 설정은 아니다.

## Editor 공급과 캐시

문서 진입 시 catalog는 재사용하고 필요한 파일의 bytes를 다시 확인한다. 수동 재감지는
catalog까지 새로 읽는다. 등록·읽기 요청은 세대별로 합치며, 이전 문서나 선택의 늦은 결과를
새 상태에 등록하지 않는다. 제품이 추가한 FontFace만 회수하고 다른 소유자의 객체는 유지한다.
실패한 file-backed face는 표시용 resolve에서 제외해 fallback으로 진행한다.

catalog 로드가 성공하면 정규화한 이름별 후보와 sourceKey 인덱스를 한 번 구축하고 entries와
함께 공개한다. 이름 조회는 해당 후보만 확인하며 파일 읽기 실패 등 현재 가용성을 매번 반영한다.
조회 성공이나 실패 자체를 고정 캐시하지 않는다. 무효화는 catalog와 인덱스를 함께 비우고,
같은 세대에서 늦게 로드된 catalog도 새 인덱스로 교체한다. 공개 레코드·배열은 내부 인덱스와
분리해 호출자의 변경이 후속 조회를 오염시키지 않도록 한다.
설정 변경·재감지의 뷰 재준비가 CanvasKit 자원을 초기화하므로, 완료 후 필요한 로컬
Typeface를 다시 공급하고 보기 갱신을 요청한다. 공급 중 문서나 renderer 결정이 바뀌면
이전 요청의 화면 갱신은 버린다.

| 경로 | 구현 경계 | 성공으로 해석하면 안 되는 근거 |
|---|---|---|
| CSS/SVG/Canvas2D | system-installed의 OS 해석과 필요한 file-backed FontFace 등록을 구분 | catalog 존재·family chain·등록 수만으로 실제 face 선택을 보증하지 않음 |
| CanvasKit | 허용 root에서 읽은 bytes를 기존 upstream renderer에 공급 | OS 목록에 있어도 bytes를 읽지 못하면 해당 경로에서는 fallback |
| 미사용·재감지 | 공개 renderer session 무효화로 성공·실패 자원을 다시 준비 | cache 초기화만으로 화면 적용을 보증하지 않음 |

catalog에 collection index·variation coordinate가 없으므로 editor의 직접 bytes 공급은
standalone static sfnt TTF/OTF로 제한한다. 모호한 동명 face, TTC/OTC·가변 face와 기타
미확인 container는 성공으로 표시하지 않는다. 이는 아래 native read의 확장자 허용 범위와
별개이며, PDF·인쇄·썸네일의 지원 범위를 확대하지 않는다.

rhwp v0.8.7의 `resolveRendererLocalFont`·`loadRendererLocalFont`도 같은 catalog/index와 native
byte cache를 사용한다. 기본 desktop은 기존 native 공급 경로이며 명시 host provider를 설정한
경우에만 그 snapshot을 같은 catalog로 정규화한다. 사용 선택·금지 family·정확한 face/style과
revision/generation을 확인하고 stale snapshot/bytes는 버린다. snapshot·bytes는 복사해 반환하며
transport 연결이 있다는 사실을 font 화면 적용 성공으로 표시하지 않는다.

## 지원 스캔 root

기본 system font directory는 `fontdb.load_system_fonts()`에 맡긴다. 추가 스캔은 Alhangeul이 소유하는 제한된 root만 허용한다.

- Linux: `~/.local/share/fonts`, `~/.fonts`, 필요 시 `/mnt/c/Windows/Fonts`
- Windows per-user: `%LOCALAPPDATA%/Microsoft/Windows/Fonts`

`%ProgramFiles%/Hnc/Office*/HOffice*/Shared/TTF` 같은 Windows Hancom vendor root는 의도적으로 스캔하지 않는다. proprietary Hancom/Human 폰트명을 참조하는 문서는 Alhangeul substitute 폰트로 렌더링하지만 해당 로컬 vendor 폰트 바이너리를 authoring 폰트로 노출하지 않는다.

## 보안과 라이선스 경계

- font bytes는 현재 머신에서만 읽고 editor webview 등록에만 사용한다.
- file-backed font read는 지원 root 내부와 허용 확장자(`ttf`, `otf`, `ttc`, `otc`, `woff`, `woff2`)로 제한한다.
- proprietary font path나 bytes를 telemetry, log 또는 artifact에 남기지 않는다.
- proprietary Hancom/Human family name은 authoring 목록에서 제외하고 새 서식이나 HTML 붙여넣기에서는 Alhangeul-safe substitute family로 정규화한다.
- 저장소에는 오픈 라이선스 substitute 폰트만 유지한다.
- PDF용 OTF는 공식 release의 unmodified KR subset만 사용하고 `assets/fonts/FONTS.md`에 source tag,
  SHA-256, 저작권, OFL 원문 위치를 기록한다.

## Editor / PDF 일관성

- editor: `list_local_fonts`와 `read_local_font` Tauri command로 system-installed/file-backed 폰트를 구분하고 필요할 때 lazy load한다.
- PDF export: `font_catalog::create_pdf_font_database()`로 같은 추가 스캔 root를 공유하고, 페이지 SVG를 임시 저장하기 전에 제한 폰트 family를 안전한 serif/sans fallback으로 바꾼다. system CJK font가 없는 환경에서도 번들 Noto Sans/Serif KR을 generic 기본값으로 사용해 `<text>`를 유지한다.
- generic `monospace`도 최소 환경의 CJK 글리프 누락을 막기 위해 마지막에는 번들 Noto Sans KR로 해석한다. 이는 coverage fallback이며 고정폭 metric이나 monospaced 시각 fidelity를 보장하지 않는다. 문서가 명시한 설치 폰트와 지원된 file-backed 폰트는 이 fallback보다 우선한다.
- PDF text: `svg2pdf`의 `embed_text: true`를 먼저 사용한다. 변환 자체가 실패할 때만 같은 SVG를 `embed_text: false`로 다시 변환하며, 결과를 `outlined-fallback`으로 표시하고 사용자에게 경고한다.

PDF 변환 전에는 원본 SVG의 내용 있는 `<text>` 수와 `usvg` tree의 text·glyph를 비교한다. font 해석
중 text가 사라지거나 `.notdef` glyph가 남으면 target을 쓰지 않고 명시적으로 실패한다. searchable
결과에 text가 있으면 PDF의 `ToUnicode` mapping도 확인하며, mapping이 없을 때만 기존
`outlined-fallback` 경고 경로를 사용한다.

Studio UI는 기존 `NotoSansKR-Regular.woff2`를 system UI font chain의 마지막 fallback으로 사용한다.
이는 최소 Linux의 메뉴·리본·모달 글자 깨짐을 막는 제품 chrome 보정이며 upstream 문서 글꼴,
CanvasKit loader, authoring 목록에는 관여하지 않는다.

검색·선택 가능한 텍스트와 font subset의 실제 결과, 제한 폰트 대체의 시각 정합은 Windows/Linux exact-SHA native 검증 대상이다. 플랫폼 중립 test는 searchable 경로 우선, 명시적 fallback과 경고 계약만 보증하며 실제 PDF 수용을 대신하지 않는다.

## Task #74 검증 범위

Stage 2 후보 `ebe5729`는 [native CI](https://github.com/postmelee/alhangeul-tauri/actions/runs/35969672923)에서
설정 디스크 복원·동시 쓰기를 포함한 Linux Rust test·Clippy를 통과했다.
Stage 3 후보 `8e7d26e`는 플랫폼 중립 Studio 222개, upstream 36개, 공개 fixture 계약 3개와
build를 통과했다. 실제 upstream CanvasKit/RendererSession의 성공·실패 cache 정책도
검사했지만 native parser 경계를 대체한 테스트이므로 실제 화면 수용은 아니다.

`tests/gui/local-fonts/`의 Abel 정적 TTF와 HWP/HWPX는 출처·라이선스·hash를 고정한
공개 Latin fixture다. 설치 helper는 격리된 Windows/Linux 사용자 환경에서만 사용하며
자신이 만든 디렉터리만 회수한다. 글꼴명·본문의 저장/재열기 계약은 통과했다.
한글 coverage, 실제 dirty/undo 상태, OS/WebView의 face 선택과 metric은 별도 수용 대상이다.

Stage 4 후보 `8e7d26e`의 [full CI](https://github.com/postmelee/alhangeul-tauri/actions/runs/35972535353)는
성공했다. Windows x64·Linux x64/arm64 native/package 및 필수 집계가 통과했다.
Windows MSI 일반 lifecycle은 raw passed지만 NSIS 썸네일 조회는 `0x80040154`,
MSI 강제 재설치는 재부팅 필요 `3010`으로 raw failed이며 진단 계약만 통과했다.
이는 모든 설치 시나리오·썸네일 화면이 정상이라는 뜻이 아니다.

Linux x64 설치본은 [GUI run 35979852070](https://github.com/postmelee/alhangeul-tauri/actions/runs/35979852070)에서
Canvas2D의 Abel HWP/HWPX 적용, 재감지, 파일 삭제·복구, 사용/미사용의 새 프로세스 복원을
확인했다. CanvasKit은 최초 적용과 재실행에서는 로컬 Typeface 1개를 사용하지만,
수동 재감지 후에는 0개로 줄어 Abel을 기본 글꼴로 대체하는 결함이 확인됐다.
같은 renderer에서도 FontFace 등록·CSS metric 정상만으로 실제 Typeface 공급을 판단할 수 없다.
이 run의 전체 결과는 failure이며 CanvasKit 미사용 복원과 새 창 수용은 미검증이다.
Windows x64 직접 검증 결과는 기다린다. 공개 Latin fixture 결과를 한글 coverage나
모든 문서·OS의 글꼴 수용으로 확대하지 않는다.
exact artifact와 raw 결과는 `tests/gui/local-fonts/acceptance.json`에 기록했다.

위 결함을 보정한 후보 `c4e9714`는 [full CI](https://github.com/postmelee/alhangeul-tauri/actions/runs/35981563185)와
같은 SHA의 [Linux GUI](https://github.com/postmelee/alhangeul-tauri/actions/runs/35984829169)를 통과했다.
full CI의 Linux x64 exact DEB를 설치하여 Canvas2D·CanvasKit의 HWP/HWPX 적용,
재감지, 글꼴 파일 삭제·복구, 사용/미사용 설정의 프로세스 재실행 복원을 확인했다.
20개 화면 관찰과 6회 프로세스 재시작을 기록했으며 CanvasKit 재감지·복구 후에도
localTypefaceCount=1, unregisteredFontFallbacks=0과 활성화 화면 픽셀을 유지한다.
실제 page PNG를 확인했고 내려받은 HWP/HWPX 내보내기 파일의 Abel 이름과 본문도 재검증했다.

Windows MSI 일반 lifecycle은 raw passed이며 NSIS `0x80040154`와 강제 재설치 `3010`의
raw 실패·진단 계약 통과는 새 full run에서도 유지된다. Windows 사용자 검증과 새 창
시나리오는 남아 있어 Stage 4 전체는 미완료다. 기존 후보의 실패 기록은 보존한다.

Windows 사용자 캡처에서 나눔스퀘어 표시 차이가 보고되어 제품의 이름 손실·다국어
record 중복을 별도로 보정했다. 공식 NanumSquareB.ttf를 읽는 native 회귀와 다중 굵기·
다른 파일 충돌·CSS 등록·CanvasKit 재조회 회귀를 추가했다. 해당 후보의 실제 Windows
표시는 새 설치본 사용자 검증으로 확인하며, 이전 Linux Abel 성공을 이 결과로 이전하지 않는다.
Abel의 문단 폭 맞춤에 따른 `iii` 굵기 차이는 이 보정의 대상이 아니다.


이름·별칭과 Windows 일반/확장 경로 중복을 보정한 후보 `a2f48b5`는
[full CI 36104289925](https://github.com/postmelee/alhangeul-tauri/actions/runs/36104289925)를 통과했다.
Windows desktop 189개에 실제 NanumSquareB의 한글/영문 이름과 중복 스캔 회귀가 포함된다.
Windows archive digest와 내부 inventory/source SHA도 검증했다. MSI 일반 설치는 raw passed,
NSIS 썸네일 실패·MSI 강제 재설치의 재부팅 요구는 기존 진단 계약만 통과했다.
실제 Windows 나눔스퀘어 표시와 새 후보의 GUI 수용은 사용자 검증 대기다.


2026-09-26 Windows 사용자는 나눔스퀘어·Abel의 설치 후 재감지와 실제 적용 성공을 확인했다.
동일 제품 후보 `a2f48b5`의 [Linux GUI 36222469761](https://github.com/postmelee/alhangeul-tauri/actions/runs/36222469761)도 통과했다.
Canvas2D·CanvasKit에서 24개 화면 관측, 6회 프로세스 재시작, 사용/미사용 각각의 새 창
4개 시나리오를 확인했다. CanvasKit 새 창에서도 사용 시 localTypefaceCount=1,
미사용 시 0이며 글꼴 삭제·복구 후 공급 상태가 바뀐다. HWP/HWPX 내보내기의 이름·본문도 보존된다.
최종 Windows 재실행·새 창·릴리즈 통합 점검은 작업지시자가 후속 v0.8.6 설치본에서 수행한다.
