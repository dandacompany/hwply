# 릴리즈 최소 검증 체크리스트

이 문서는 검증 **선택 기준**이다. 실행 순서는 [runbook](PUBLIC_RELEASE_RUNBOOK.md),
지원·승인 기준은 [정책](DESKTOP_RELEASE.md), 실제 결과는
[버전별 기록](../releases/README.md)에 둔다. 모든 체크를 매번 새 CI로 수행하라는 뜻이 아니다.

## 사용 방법

1. 이전 공개 또는 승인한 수용 source와 후보의 diff를 읽고 아래 추가 확인을 선택한다.
2. 각 항목을 `실행/재사용/해당 없음/미실행`으로 계획하고 결과는 `통과/실패`와 구분한다.
3. 재사용에는 이전 exact SHA·run·환경, 관련 코드/설정/의존성/검사 도구가 같다는 근거를 적는다.
4. 새 installer bytes의 hash·서명·설치 성공은 재사용하지 않는다. 새 build는 새 파일이다.
5. 필수 gate 실패·증거 누락·승인 미정은 중단한다. 위험 수용과 기술 검증 통과를 구분한다.

문서-only 변경은 문서 검증만으로 마칠 수 있다. 별도 앱 릴리즈가 없다면 서명 build나
N→N+1을 만들 필요도 없다. 릴리즈를 실제 게시한다면 아래 공개 항목은 생략하지 않는다.

작업 중 빠른 계약·플랫폼별 package·기존 제품 bytes의 installer 검증 선택은
[CI 검증 가이드](CI_VALIDATION.md)를 따른다. CI의 full도 GUI·updater·공개 승인 전체를 뜻하지 않는다.

## 매 공개 기본 확인

### 후보·판단 — runbook Gate 0~1

- [ ] owner·실행 Issue·release PR, version/tag/채널/candidate exact SHA 승인.
- [ ] 이전 공개 version/tag/resolved commit 확인; 첫 공개는 `없음`, 분석 시작 기준 별도 확정.
- [ ] 포함 PR·앱/upstream/운영 변화·해결 Issue/참고 Issue·known limitations 분리.
- [ ] 제품 version 정합성, rhwp Stable tag+commit 및 core/WASM/Studio 동일 release 확인.
- [ ] updater production 공개키 fingerprint/endpoint, 서명 책임·복구본 보관 확인. 비밀 값 제외.
- [ ] Windows Authenticode와 updater Minisign 구분, 미서명 경고·배포 정책 판단.
- [ ] `release`/`github-pages` 실제 reviewer·허용 ref 확인; 변경이 필요하면 별도 승인.
- [ ] 변경 영향·재사용 근거·미검증 Windows/Linux 환경과 필수 위험 처리 결정.
- [ ] `v<version>.notes.json`의 사용자 변화·rhwp 변화·관련/해결 Issue·조회 근거와 6개 asset/3개 updater metadata 대조.
- [ ] 본문·웹·짧은 notes 생성 및 `check:release-notes` 통과; 공개일·고정 URL·placeholder·출력 drift 확인.
- [ ] Pages 상태별 검사는 공개 권한 검사가 아님을 확인. 첫 전환은 Release read-back 후 별도 데이터 PR·배포 승인으로 통제.

### 파일·설치 — runbook Gate 2~3

- [ ] 실제 mode/입력/checkout SHA/workflow SHA/run ID·필수 job/step/upload 결과 연결.
- [ ] Windows 설치 계약의 통과와 실제 기능 결과 분리. NSIS 제한·MSI 재부팅 후 미검증·최신 VDI 여부를 기록하고, `additional-validation-only`를 공개 파일 수용으로 쓰지 않음.
- [ ] archive ID/digest·만료 여부와 installer 파일명/target/크기/SHA-256 구분.
- [ ] updater 대상 MSI·NSIS·AppImage 각각의 `.sig`를 production 공개키로 실제 검증.
- [ ] complete inventory의 version/tag/sourceSha/keyFingerprint와 target별 파일·URL·hash·서명 대조.
- [ ] **게시할 bytes**에서 대상별 설치·실행·앱 version·대표 문서 열기/저장/재열기 확인.
- [ ] Linux launcher의 파일 인자와 taskbar 아이콘 그룹핑 확인; StartupWMClass와 실제 창 식별 불일치 시 기록·보정.
- [ ] 지원 updater 형식·production 설정 확인; 수동 패키지는 해당 설치/안내 경로 확인.
- [ ] 동일 파일 검증 뒤 게시를 보장하는 승인 경로 확인. 재빌드하면 새 파일 검증으로 돌아감.
- [ ] 6종 공개 시 updater 한 run의 세 installer·서명·inventory와 같은 SHA 일반 run의 수동 3종만 선택.
- [ ] 평면 파일명 10개와 SHA256SUMS의 10행 대조, checksum 자체 hash 별도 기록; 총 11개 asset 확정.

과거 GUI 기능 수용 전체를 매번 반복하지 않지만 새 파일의 최소 설치 확인을 생략하지 않는다.
현재 `publish_release=true`에는 기존 비게시 artifact 승격이나 동일 bytes 수동 설치 대기 보장이
없다. runbook Gate 4의 유지관리자 CLI 경로도 별도 승인이 필요하며, 환경 reviewer가
CLI 게시까지 보호하지 않는다. 인증 주체·허용 ref·최종 파일 승인 기록이 미정이면 공개하지 않는다.

### 공개·read-back — runbook Gate 4~7

- [ ] 생성 `release-body.md`의 exact 내용·hash 승인; 기존 body만 보정할 때도 수정 승인·identity 보존·read-back 일치 기록.
- [ ] source/채널/최종 asset/notes 공개 승인 후 게시. 비게시 서명 승인을 공개 승인으로 쓰지 않음.
- [ ] exact tag가 후보 commit을 가리키며 Release draft/prerelease 상태가 승인 채널과 일치.
- [ ] 원격 installer를 새로 받아 크기/hash/서명/inventory를 게시 전 근거와 비교.
- [ ] draft에 고정 목록 전체를 올려 read-back한 뒤 stable 공개; 공개 후 다시 내려받아 동일 bytes 확인.
- [ ] 기존 tag/Release 선조회, tag resolved SHA 대조; 불명확한 응답은 재조회하고 중복 생성/덮어쓰기 금지.
- [ ] Release read-back 후 `site/release.json` PR 검토·devel merge·Pages/manifest 게시 승인.
- [ ] 같은 version의 site notes는 원문의 updaterSummary와 일치; 긴 GitHub 본문 복사 금지. 새 원문이면 새 생성물/hash 검사.
- [ ] exact Pages SHA/workflow/deploy_ref 일치, build/check/test/upload/deploy 성공.
- [ ] 공개 홈·업데이트·문의·버전별 안내의 링크/다운로드·공개일·최신 표시와 승인된 manifest version/URL/서명 read-back.
- [ ] 실제 production 설치본의 결과 확인. 첫 공개·다음 공개의 차이는 아래 항목 적용.
- [ ] 버전 기록·릴리즈 인덱스에 실제 게시 시각/URL/run/근거/미실행/승인/후속 Issue 반영.

## 변경 영향별 추가 확인

native UI 자동화 자체를 변경하거나 실패를 진단할 때는
[Native UI 테스트 가이드](NATIVE_UI_TESTING.md)를 따른다. 이 링크는 새 릴리즈 gate를
추가하거나 기존 필수 검증을 해제하지 않는다.

아래 표는 후보 diff에 해당하는 행만 선택한다. 여러 영역이 바뀌면 필요한 항목을 합치되
동일 검사를 중복 실행하지 않는다. 세부 명령·환경은 해당 Task 계획에서 확정한다.

| 변경 영역 | 추가 확인 | 기존 근거 재사용 경계 |
|---|---|---|
| rhwp pin/core/WASM/Studio | 동일 Stable provenance, 호환 문서 열기·편집·형식별 저장·재열기, PDF·시스템 인쇄, 양쪽 thumbnail renderer | 이전 pin의 렌더링 결과를 새 pin 수용으로 쓰지 않음 |
| adapter/native 문서 세션·저장·PDF·인쇄 | 변경 bridge 계약, dirty/다중 문서, revision·취소·반복, 출력 쪽 수/방향/한글/표 | 수정 경로와 무관한 installer/negative suite까지 확대하지 않음 |
| Windows installer·Tauri/WiX/NSIS·연결·thumbnail | MSI/NSIS 설치·rollback·제거·기존 연결 보존, handler/worker 등록·대표 bitmap·timeout fallback | MSI package 성공은 NSIS GUI나 모든 DPI/한컴 조합의 근거가 아님 |
| Linux helper·MIME·hook·package | 해당 architecture lifecycle, package-only MIME/thumbnailer, helper/cache·제거, file manager 확인 | DEB x64 GUI를 arm64/RPM GUI로 확대하지 않음; private MIME 주입 금지 |
| updater Rust/형식 판별/dirty·설치 | 변경 target 계약, 동일 형식 positive 설치·재실행, 영향받은 fail-closed/쓰기 자격/dirty 보호 | 수정된 분기의 이전 수용은 재사용 불가; 무관한 negative 전체는 반복 불필요 |
| updater key·endpoint·manifest/schema | 공개키 신뢰·서명·target URL/bytes, 필요 malformed/wrong-signature/wrong-target 시험, 기존 설치본 연속성 | 승인된 test-only 범위로 시험; production feed에 negative fixture 주입 금지 |
| Pages UI/release data/배포 workflow | build:pages/check:pages, Pages·updater·workflow 계약, 반응형·링크·read-back; published 전환 시 승인된 tests/pages.test.mjs 보정(미공개 고정/null 단언·manifest 부재 검사), manifest true/false 확인 | 미공개 fail-closed는 고정 fixture로 보존하고 실제 source 검증과 분리; 앱 source가 같으면 native/thumbnail 재실행 불필요 |
| 릴리즈 원문·템플릿·생성기 | check:release-notes/test:release-notes, 같은 원문 body/HTML/short notes, metadata·PR/Issue 의미 검토·출력 drift·좁은 화면 | 원문/템플릿이 바뀌면 생성 bytes/hash 재검사; 동일 앱·설치본은 재빌드하지 않음 |
| 문서만 | diff·사실/명령·상대 링크/앵커·미공개 표현·기록 정합성 | runtime/config/pin/판정 도구가 같으면 기존 source 수용 재사용 |
| build/lock/toolchain/workflow | 생성물·권한·provenance 변화에 해당하는 위 항목과 대상 package 확인 | source 코드가 같아도 새 bytes의 무결성/서명/설치는 재사용 불가 |

플랫폼 중립 기본 도구는 `check:product-boundary`, `test:upstream`, `test:studio`,
`build:studio`다. product version/metadata/pin 검사는 runbook Gate 1을 따른다.
Rust desktop test·clippy·Tauri build는 Windows/Linux에서만 수행한다. 이 표를 이유로
다른 OS용 제품 build나 검증 경로를 추가하지 않는다. 패키지 관리는 pnpm만 사용한다.

### PDF·시스템 인쇄를 확인할 때

- [ ] 직접 PDF 저장과 system print를 각각 확인. 직접 PDF 성공으로 print를 통과시키지 않음.
- [ ] system dialog 진입, 열린 문서의 쪽 수·방향·한글/표 출력, 취소·반복 뒤 편집기 복귀.
- [ ] 빈 editor/Studio chrome/잘못된 문서 revision·orphan surface가 없는지 확인.
- [ ] PDF 수치와 시각 판독, Windows 가상 출력/Linux GTK·CUPS/실제 printer 실행 범위 구분.

dialog 미진입·빈 페이지·쪽 수/방향 오류는 중단한다. 알려진 미해결 결함은 승인된 위험 판단과
후속 Issue로 기록하며 정상 결과로 숨기지 않는다. 승인된 공개 fixture만 사용한다.

### 썸네일·패키지를 확인할 때

- [ ] Windows installed handler/worker가 반환한 실제 bitmap과 앱/renderer provenance 확인.
- [ ] Windows NSIS/MSI별 HKCU/HKLM·연결 조회·직접 COM 생성과 실제 문서 Shell/강제 추출·JPG 대조 결과를 분리. 캐시 조회만으로 새 생성 성공을 판정하지 않음.
- [ ] 세 격리 설치 job의 raw summary·process/step outcome·evaluation과 upload·최종 gate 확인. `contract_status=passed`라도 `thumbnailStatus=not-accepted`이면 제한 유지, 새 오류·증거 누락은 실패.
- [ ] 지원 묶음 사용 시 같은 run·exact SHA·archive digest·manifest 파일 해시·설치된 DLL/worker hash 확인. 만료/다른 빌드 혼용 금지. 진단 종료 0/1/2와 원시 증거를 대조하고 도구 성공을 제품 gate 성공으로 바꾸지 않음.
- [ ] Windows 설치/재설치/제거를 따로 확인. 3010·지연 작업은 재부팅 후 새 process·DLL hash·Shell·OS 표식으로 재검증. 제거 코드 0이나 재부팅 전 bitmap 성공을 재부팅 완료로 쓰지 않음.
- [ ] 일반 로그인 Explorer 시각 결과·실제 한컴/VDI와 hosted CI를 구분. 수동 진단의 `lifecycleStatus=not-tested`와 미실행 환경을 명시.
- [ ] Linux package 자체가 설치한 helper/MIME/thumbnailer만으로 동작하는지 확인.
- [ ] Linux GUI artifact ID/digest·DEB hash·source/run과 설치 환경이 같은 증거 사슬인지 확인.
- [ ] screenshot·native UI tree·helper 실행/cache·필수 upload 누락을 성공으로 처리하지 않음.
- [ ] AppImage 자체 Freedesktop 등록, Fedora RPM GUI, arm64 GUI, Wayland/GPU 등의 미검증 구분.
- [ ] Linux desktopTemplate 변경 시 DEB/RPM과 AppImage 내부 launcher의 `%F` 및 실제 argv·열린 문서 확인.

상세 환경·과거 예외는 [정책의 수용 한계](DESKTOP_RELEASE.md#검증-선택과-수용-한계)와
해당 버전 기록에 둔다. probe나 `rpm --nodeps` 성공을 실사용 배포판 GUI 수용으로 쓰지 않는다.
#67 독립 재검산·재사용 고도화는 첫 릴리즈의 필수 선행이 아니다. 그렇더라도 위 원시 증거 확인,
게시할 exact bytes·서명·설치·지원 한계 승인·게시 후 대조는 생략하지 않는다.

## 첫 공개와 다음 공개의 updater 확인

| 시점 | 필수 확인과 남길 근거 | 완료로 주장하지 않을 것 |
|---|---|---|
| 첫 공개 | 세 형식의 production key/endpoint·설치 version, manifest 게시 시 같은 버전의 업데이트 없음, 기준선 보존 | manifest 미게시/endpoint 오류는 업데이트 없음이 아니며, 이전 공개본이 없으므로 N→N+1 성공도 아님 |
| 다음 공개 | 이전 공개 installer/hash를 설치한 격리 환경, 같은 형식 N→N+1 확인·다운로드·서명·동의·설치·재실행·version | NSIS→MSI 전환이나 시험 endpoint 성공으로 대체 불가 |
| 수동 패키지 | DEB/RPM/arm64의 수동 다운로드 안내·해당 package 설치 확인 | 자동 updater 성공 대상 아님 |

- [ ] Windows NSIS와 MSI의 기준선은 별도 환경으로 보존, 이전/이후 version과 파일 hash 기록.
- [ ] Linux x64 AppImage는 실제 APPIMAGE 경로와 파일·부모의 실효 쓰기 자격을 확인.
- [ ] unsaved 문서 보호를 유지하고 취소/실패 시 원본 문서를 보존.
- [ ] production 업그레이드는 공개 후 실제 결과로 기록. 첫 공개의 후속 미실행은 이유·담당자 명시.

첫 공개 이후 별도 upstream 갱신과 다음 앱 릴리즈를 이어갈 수 있다. upstream 버전과 다음 앱
version은 각각 승인받는다. updater 시험을 위해 미승인 가짜 production 버전을 만들지 않는다.

## 검증을 멈춰야 하는 경우

- [ ] 실패한 gate/입력/run·영향·원인 변화를 기록하기 전 같은 CI를 재실행하지 않음.
- [ ] Release만 성공했다면 실제 공개 manifest/안내의 유지 여부부터 확인하고 Pages 재개 또는 사후 복구 판단.
- [ ] 배포 후 결함이면 owner에게 이전 검증 feed/안내 복구 또는 더 높은 fixed version 판단 요청.
- [ ] tag 이동·asset 덮어쓰기·history rewrite·무단 key rotation으로 실패를 숨기지 않음.

재개 위치는 [runbook 실패 표](PUBLIC_RELEASE_RUNBOOK.md#실패와-재개)를 따른다.
검사 항목을 늘리는 대신 실패 원인에 필요한 검증을 선택하고 변경되지 않은 근거는 재사용한다.
