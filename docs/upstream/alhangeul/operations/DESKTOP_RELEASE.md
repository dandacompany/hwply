# 데스크톱 릴리즈 정책

이 문서는 Windows/Linux Alhangeul의 반복 배포 기준이다. 실행 결과와 공개 여부는
[릴리즈 기록 인덱스](../releases/README.md), 첫 공개 준비는 [v0.1.0 기록](../releases/v0.1.0.md)을
따른다. 기능 구현, 검증 성공, Release 게시, updater 활성화는 서로 다른 완료 상태다.

## 문서 읽는 순서

| 문서 | 답하는 질문 |
|---|---|
| 이 문서 | 무엇을 배포하며 어떤 승인·신뢰 경계를 지키는가 |
| [공개 실행 가이드](PUBLIC_RELEASE_RUNBOOK.md) | 어떤 입력·명령·승인으로 진행하고 어디서 멈추는가 |
| [최소 검증 체크리스트](RELEASE_CHECKLIST.md) | 이번 변경에서 무엇을 실행하고 재사용하는가 |
| [릴리즈 기록 인덱스](../releases/README.md) | 어느 버전이 준비 중이고 무엇이 실제 공개됐는가 |
| 버전별 기록 | 이전 버전·후보·변경점·검증·승인·공개 근거가 무엇인가 |
| [기록 템플릿](../../mydocs/_templates/release_record.md) | 새 버전의 기록을 어떤 형식으로 작성하는가 |
| [updater 아키텍처](../architecture/UPDATER.md) | 설치 형식 판별·서명·dirty 보호·수동 복구는 어떻게 동작하는가 |
| [개발 문서](../DEVELOPMENT.md)·[upstream 경계](../architecture/UPSTREAM.md) | 개발 검증과 의존성 갱신은 어디서 시작하는가 |

정책·실행 가이드·체크리스트를 읽은 것만으로 공개 실행 승인을 대신하지 않는다.

## 제품 version과 source 기준

- 제품 source version의 기준은 root `package.json`이다. desktop package, Cargo manifest·lock,
  Tauri 설정의 일치는 `pnpm run check:product-version`으로 확인한다.
- 공개 식별자는 승인한 version, `v<version>` tag와 tag가 가리키는 exact 40자리 commit이다.
  branch 이름이나 `latest` redirect만으로 후보·다운로드를 식별하지 않는다.
- 초기 HOP version과 Alhangeul의 독립 계보는 [출처 문서](../architecture/PROVENANCE.md)를
  따른다. 과거 canary installer를 Alhangeul의 공개 릴리즈로 재분류하지 않는다.
- `rhwp`는 Stable tag와 resolved commit을 함께 고정한다. source submodule, native Cargo lock,
  bundled WASM과 전체 upstream Studio는 같은 release여야 한다. 버전 갱신은 별도 Task다.
- 릴리즈 시작 시 최신 공개 앱과 upstream 상태를 다시 읽는다. 새 upstream이 있어도 임의로
  교체하지 않고 현재 pin 유지 이유 또는 별도 갱신 순서를 승인받아 기록한다.
- version·candidate·이전 공개 버전·채널·배포 패키지·known limitations가 미확정이면 게시하지 않는다.

## 지원 패키지와 통합 범위

다음은 현재 구현 matrix이며 모든 조합의 실기기 수용이나 공개 완료를 뜻하지 않는다.

| 대상 | 일반 artifact bundle | 앱 내 updater | 파일 관리자 썸네일 |
|---|---|---|---|
| Windows x64 | MSI, NSIS | release overlay로 만든 동일 설치 형식 | 두 installer의 COM handler·worker 등록 |
| Linux x64 | AppImage | release overlay와 실행·쓰기 자격을 갖춘 AppImage | AppImage 자체의 Freedesktop 등록 없음 |
| Linux x64 | DEB, RPM | 수동 다운로드 안내 | package-owned helper·MIME XML·thumbnailer |
| Linux arm64 | DEB | 수동 다운로드 안내 | package-owned helper·MIME XML·thumbnailer |

- Windows MSI·NSIS를 교차 업데이트하지 않는다. 설치 근거가 불명확하면 수동 안내로 닫힌다.
- Linux AppImage는 실제 실행 경로와 현재 process의 실효 `W_OK`가 필요하다. 읽기 전용
  AppImage·DEB·RPM·arm64는 자동 설치 대상이 아니다.
- Windows ARM64, Linux arm64 RPM, KDE/Dolphin, Flatpak/Snap과 AppImage 등록은 위 matrix 밖이다.
- Linux arm64 GUI, Fedora RPM GUI·dependency resolution과 모든 Windows DPI·한컴 조합은
  자동 수용 결과로 추정하지 않는다. 버전 기록에 실행 환경과 미검증 범위를 적는다.
- [Windows thumbnail](../architecture/WINDOWS_THUMBNAILS.md)과
  [Linux thumbnail](../architecture/LINUX_THUMBNAILS.md) 아키텍처가 세부 통합 계약을 소유한다.

## workflow와 산출물 계층

진실 원천은 [CI 진입점](../../.github/workflows/ci.yml)과 [desktop workflow](../../.github/workflows/alhangeul-desktop.yml),
[Linux GUI workflow](../../.github/workflows/alhangeul-linux-gui.yml),
[Pages workflow](../../.github/workflows/pages.yml)다. 수동 dispatch 승인은 제품 공개 승인과 다르다.

| 경로 | 결과 | 공개 권한·용도 |
|---|---|---|
| `artifact` | Windows x64, Linux x64·arm64 bundle·inventory와 package/thumbnail 진단 | 비게시 검증; updater overlay·서명 Secret 없음 |
| `updater`, `publish_release=false` | Windows MSI·NSIS, Linux x64 AppImage·서명·검증 inventory | `release` 환경의 비게시 서명 후보 |
| `updater`, `publish_release=true` | 같은 run의 세 installer·세 `.sig`·complete inventory, 총 7개 Release asset | 별도 공개 승인 필요 |
| `updater-acceptance` 및 native acceptance mode | 시험용 N/N+1·positive·negative 근거 | 별도 시험 승인; production 수용을 대신하지 않음 |
| Linux GUI acceptance | 지정 native run의 exact DEB와 GUI·인쇄·thumbnail 증거 | 비게시 수용 |
| Pages | 검증된 `site/`를 `_site/`로 빌드·배포 | 별도 배포 승인; 앱 installer를 만들지 않음 |

일반 `artifact`의 기본 범위는 all/full/tests=true다. 플랫폼·core·제품 생성만 선택한 부분
profile과 기존 bytes 재사용은 [CI 검증 가이드](CI_VALIDATION.md)를 따른다. 일반 artifact도
workflow SHA와 실제 제품 checkout SHA가 같아야 한다.

Windows 설치 검사는 NSIS-only·MSI-only·강제 재설치의 개별 계약과 경량 상태 집계를 사용한다.
CI 전체 성공도 모든 썸네일 환경의 성공을 뜻하지 않는다. 원시 실패와 `thumbnailStatus`·
`lifecycleStatus`를 [CI 상태 해석](CI_VALIDATION.md#windows-설치-계약과-실제-관측)에 따라 읽는다.
성공 producer의 Windows bytes는 `additional-validation-only`로 추가 검사에 사용할 수 있으나
제품/릴리즈 수용은 별도다. 독립 재검산 자동화는 #67 후속이며 첫 공개 선행 조건이 아니다.

최종 파일 수용의 `release-file-acceptance`, `release-linux-file-acceptance`,
`release-fedora-vm-acceptance`는 checkout 안의 후보 JSON 경로를 `release_candidate_path`로 받는다.
JSON은 stable version/tag, exact source SHA, 선택한 성공 producer의 workflow/run,
archive ID/digest와 package path/hash를 고정한다. 다운로드 bytes·inventory 또는 서명·선택 파일을
대조한 뒤에만 설치와 GUI를 실행하며 누락·불일치는 실패다. 새 후보의 일반 문서 수용은
NSIS/MSI/AppImage를 포함하고, Windows-only는 두 Windows 형식, Linux arm64 선택은 arm64만
실행한다. production 검사 선택은 별도다. 입력을 비우면 과거 v0.1.0 검증 기본값을 보존하므로
새 릴리즈 수용에는 후보 JSON을 명시한다. 이는 공개 승인이나 updater 활성화를 대신하지 않는다.

일반 native build와 updater build를 혼용하지 않는다. 기본 build의 성공은 production endpoint와
서명이 포함된 파일의 검증이 아니다. updater build는 일반 build의 전체 test·package smoke를
자동으로 반복하는 경로가 아니므로 변경 영향과 실제 job 결과를 따로 확인한다.

`updater`는 `build_ref`, workflow SHA, checkout SHA의 일치와 stable `X.Y.Z` version,
일치하는 `vX.Y.Z` tag, 비어 있지 않은 release notes를 요구한다. 서명 build와 publish job은
`release` environment를 사용하며 publish job에만 필요한 `contents: write`를 부여한다.

현재 workflow에는 draft/prerelease 입력이나 이전 비게시 run의 파일을 그대로 승격하는 입력이 없다.
`publish_release=true`는 새 build를 거친 게시이며, DEB/RPM·arm64 파일은 이 7개 asset에 포함되지
않는다. 동일 bytes 게시에는 [runbook Gate 4](PUBLIC_RELEASE_RUNBOOK.md#gate-4--github-release-게시와-원격-파일-재검증)의
maintainer CLI 경로를 별도 승인받는다. 하나의 성공한 비게시 updater run에서 세 installer·서명·
complete inventory 전체를 가져오고, **같은 exact SHA**의 지정 일반 run에서 수동 패키지만 보완한다.
실패 run·다른 SHA·일반 MSI/NSIS/AppImage로 서명 후보를 대체하지 않는다. 기본 공개 목록은
installer 6개 + `.sig` 3개 + complete inventory + `SHA256SUMS`, 총 11개이며 버전별로 확정한다.
CLI에는 Actions environment 승인 규칙이 자동 적용되지 않는다. 인증 주체·허용 ref·파일 목록과
공개 승인 기록을 별도로 남기고, 그 경로를 허용하지 않는 보호 정책이면 실행하지 않는다.

Actions archive는 임시 검증물이다. 현재 desktop/updater artifact는 14일, Linux GUI evidence는
7일 retention이며 run 성공만으로 파일이 아직 내려받아지는 것은 아니다. 버전 기록에는 archive
ID·digest·만료와 실제 파일의 크기·SHA-256을 구분한다. 만료된 근거는 기록으로 남되 만료된 파일을
게시하거나 재빌드 파일이 같은 bytes라고 간주하지 않는다.

### Windows 썸네일 지원 묶음

일반 Windows artifact build는 installer bundle과 별도로
`alhangeul-windows-x64-thumbnail-support`를 생성한다. 사용자 진단 도구는
[exact 후보의 Windows CI 실사용 검증](../releases/v0.1.0.md#windows-썸네일-진단-수용과-잔여-제한)을
통과했지만 현장 실사용은 미검증이며 공개 Release/웹사이트 다운로드 목록에는 추가하지 않는다.
지원 묶음은 실행 의존 파일 10개, 같은 빌드의 inventory, Windows thumbnail 문서 복사본과
`support-manifest.json`이다. installer·DLL·worker·문서 fixture·진단 결과는 포함하지 않는다.

같은 run의 설치 파일과 묶음만 짝지으며 manifest의 exact source SHA·파일 해시,
원격 archive digest와 설치된 처리기 bytes/hash를 확인한다. 같은 version 문자열만으로
빌드를 혼용하지 않는다. artifact는 14일 임시 자료이며 공개 asset이나 서명된 도구가 아니다.
런타임 자동 다운로드·전송은 없고 사용법은 [수동 진단 안내](../architecture/WINDOWS_THUMBNAILS.md#수동-진단과-msi-대안)를 따른다.

installer job은 제공된 묶음 그대로 공개 fixture를 검사하고 원본 JSON·판정·종료 코드를
대조한다. `manualTests`·`manualEvidence`가 진단 도구 검증 결과이며 기존 제품 gate와 별개다.
NSIS의 실제 실패를 진단 도구가 올바르게 분류하더라도 제품 실패는 유지한다.
개인 사용자 문서/결과를 CI artifact로 업로드하지 않는다. 기존 5개 bundle 파일 계약과
릴리즈 수용·서명·게시 승인 경계는 바꾸지 않는다.

과거 run `34056210236`의 진단 성공과 전체 workflow failure는 당시 결과로 보존한다.
실패 run의 artifact는 제한적 진단 근거일 뿐 현재 추가 테스트용 재사용이나 공개 릴리즈 입력이 아니다.
현재 계약은 엄격히 일치한 알려진 제한을 별도로 판정하지만 원시 제품 실패를 지우지 않는다.
`continue-on-error` step의 표시만 보지 말고 `step-outcomes.json`의 실제 outcome,
`installer-evaluation.json` 및 upload·최종 계약 gate를 확인한다. 문서-only 정합화에서는 검증된 native SHA·같은 installer bytes를
재사용하며 문서 보고 commit을 native 검증 SHA로 기재하지 않는다. 기존 archive 안의 문서는
빌드 당시 복사본이다. 최신 안내는 저장소 문서를 읽고, manifest 검증 대상 파일을 고쳐 쓰지 않는다.

## 공개 기본 브랜치와 운영 대상

저장소의 공개 기본 브랜치는 `main`, 개발 통합과 일반 기여 PR 대상은 `devel`로 둔다.
공개 후 승인된 README·커뮤니티 안내·사이트·운영 문서는 `devel → main` PR로 정렬한다.
이때 공개 제품 source와의 차이를 확인하고, 문서용 main commit을 기존 설치본의 source로 기록하지 않는다.
기존 release tag와 asset은 해당 공개 제품 기준으로 보존한다.

예약 upstream workflow는 GitHub 기본 브랜치의 정의로 실행되며, checkout과 후보 PR 대상은
명시된 `BASE_BRANCH=devel`을 유지한다. 기본 브랜치 전환 후에는 workflow 존재와 이 대상을 확인한다.
Pages는 승인된 exact `devel` SHA와 기존 `github-pages` 환경의 devel 허용 정책을 계속 사용한다.
기본 브랜치 변경만으로 새 Release·설치본·manifest·Pages 배포를 실행하지 않는다.
새 기본 브랜치에서 Community Standards·제보 양식·보안 정책과 공개 사이트 연결을 재확인한다.

## 승인과 게시 순서

1. release owner가 변경 범위, 이전 버전, 후보 SHA·version·tag·채널, 서명 정책과 지원 matrix를
   승인한다. 일반 Task PR은 `devel`로, release PR은 `devel → main`으로 진행하는
   [브랜치 원칙](../../mydocs/manual/git_workflow_guide.md)을 따른다.
2. 승인한 source의 영향 검증과 실제 게시할 installer의 metadata·무결성·서명·설치 기본 동작을
   확인한다. 미게시 수용 이후 다시 빌드하면 새 파일로 다시 확인해야 한다.
3. 공개 승인 뒤 검증된 exact tag의 GitHub Release를 게시한다. version·target·source SHA·
   파일명·크기·hash·서명을 inventory와 맞추고 공개 asset을 다시 내려받아 대조한다.
4. Release read-back이 통과한 뒤 별도 승인으로 `site/release.json` 변경 PR을 `devel`에 병합한다.
   installer source SHA와 Pages source SHA는 역할이 다르므로 각각 기록한다.
5. Pages workflow SHA와 `deploy_ref`가 같은 exact `devel` commit을 배포한다. 배포 전에 현재
   `devel` ref가 이동하지 않았는지 확인하며 task/publish branch로 환경 정책을 우회하지 않는다.
6. 공개 홈·업데이트·문의 화면의 링크와 manifest를 다시 읽고, 버전 기록에 배포 run·SHA와
   대상별 결과를 남긴다. 실제 사용자 설치본의 확인과 두 버전 업데이트 결과는 따로 기록한다.

위 순서는 요구되는 승인 경계다. 현재 workflow가 게시할 동일 bytes의 수동 설치 확인을 자동으로
기다리거나 보장하지는 않는다. 이를 만족하는 게시 gate가 정해지지 않았다면 3단계 전에 멈춘다.
문서 PR merge, environment 이름, required reviewer의 존재만으로 공개가 승인된 것도 아니다.
실행 직전 승인자·허용 branch/tag·실제 protection rule을 확인하고 차이를 owner에게 보고한다.

## Pages와 updater 신뢰 사슬

[release data validator](../../scripts/pages/release-data.mjs)와
[inventory validator](../../scripts/updater/release-inventory.mjs)를 기준으로 다음을 지킨다.

- `site/release.json`이 `unreleased`이면 version·tag·download는 null이고 manifest는 생성하지 않는다.
- 현재 release data 채널은 `stable`만 허용한다. 다운로드 key는
  `windows-x86_64-nsis`, `windows-x86_64-msi`, `linux-x86_64-appimage` 세 개다.
- `published` 전환에는 세 target의 version-tag 고정 GitHub HTTPS URL이 모두 필요하다.
  수동 패키지 URL은 이 schema가 자동 게시하지 않는다.
- `manifestPublished=true`에는 세 target을 모두 가진 complete inventory와 release data의
  version·tag·URL 정합성이 필요하다. [manifest 생성기](../../scripts/updater/manifest.mjs)는
  검증된 inventory의 URL·signature만 투영한다.
- 이 구조 검증은 실제 원격 bytes의 서명 검증이나 public read-back을 수행한 증거가 아니다.
  build/publish 검증과 원격 read-back 결과를 버전 기록에서 연결해야 한다.
- endpoint는 `https://postmelee.github.io/alhangeul-tauri/updater/stable.json`이다.
  수동 복구는 native command가 고정 [업데이트 페이지](https://postmelee.github.io/alhangeul-tauri/updates/)만
  OS 기본 브라우저로 열며 WebView가 임의 URL을 대신 열지 않는다.

첫 공개에는 이전 공개 설치본이 없으므로 같은 버전에서 '업데이트 없음'을 확인할 수 있다.
이는 실제 `N → N+1` 성공이 아니다. 첫 공개 MSI·NSIS의 격리 설치본과 writable AppImage를
보존하고, 다음 실제 공개 후 동일 target의 다운로드·서명·설치·재실행·version을 확인한다.
시험 endpoint의 성공, production manifest 게시, 실제 production 업그레이드 성공을 구분한다.

## Production updater key와 Secret 책임

[tracked release overlay](../../apps/desktop/src-tauri/tauri.updater.conf.json)에는 public key만 둔다.
[release metadata 계약](../../scripts/check-release-metadata.mjs)의 공개 fingerprint는
`9f86f804067eff359cd32707137dfaaea8710450985dda86b0392da5db63b8f8`다.
updater Minisign 서명은 Windows Authenticode 인증서 서명과 별개이며 서로의 성공을 대신하지 않는다.

릴리즈 책임자는 repository 밖의 접근 제한된 primary key, 독립적인 암호화 복구본과 별도 credential
store의 암호를 보관한다. 복구본 존재와 공개 fingerprint만 확인하며 평상시 private material을
복호화·read-back하지 않는다. `release` environment의 Secret 이름은 다음과 같다.

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

키·암호·실제 보관 경로·credential store 항목 내용은 source·문서·log·PR·artifact·shell history에
기록하지 않는다. public key를 Secret으로 중복 등록하지 않으며, Secret 등록 후 값을 출력해
비교하지 않는다. 서명 key·암호·환경 변경은 별도 승인을 받아 수행한다.

키 유실 시 기존 설치본은 새 key의 update를 신뢰하지 못한다. 첫 공개 전 교체는 별도 승인 Task로,
공개 후에는 기존 key로 서명한 bridge release 가능성부터 검토한다. 불가능하면 수동 재설치와 사용자
공지를 포함한 복구 승인이 필요하다. 노출 의심 시 release·manifest 게시와 해당 key 사용을 중단한다.

## 검증 선택과 수용 한계

검증은 반복 횟수가 아니라 변경 영향과 공개할 파일을 기준으로 선택한다.

- 과거 성공 run의 exact SHA와 현재 candidate diff에서 관련 runtime·config·의존성·판정 도구가
  그대로인지 확인하고 재사용 이유를 기록한다. 문서-only merge만으로 전체 native/negative suite를
  다시 실행하지 않는다.
- 새 installer bytes에는 이전 파일의 checksum·서명·설치 성공을 승계하지 않는다.
- 제품명·Tauri·WiX/NSIS·file association·thumbnail binary/protocol·installer smoke가 바뀌면
  Windows 설치·rollback·제거·기존 연결 보존·Shell bitmap 경로를 다시 확인한다.
- Linux helper·MIME·registration·package hook이 바뀌면 해당 architecture의 lifecycle과
  package-only file-manager 경로를 확인한다. private MIME 주입으로 설치 성공을 대신하지 않는다.
- upstream pin 변경은 core·Studio·WASM·저장·PDF·인쇄 및 두 thumbnail renderer에 영향을 준다.
  [upstream 수용 기준](../architecture/UPSTREAM.md)을 적용하며 updater negative 전체 반복과는 구분한다.
- 실패한 check를 면제하려면 알려진 이름만 같다는 이유가 아니라 정확한 실패 지점·영향과
  owner 결정을 기록한다. 미실행 항목과 위험 수용을 '통과'로 쓰지 않는다.

### PDF snapshot과 stale job 수용 gate

현재 직접 PDF는 live page handler를 순회하지 않는다. save target 확정 뒤 현재 형식의 HWP/HWPX serializer를 한 번만 capture하고 격리 `WasmBridge`에 다시 로드한 immutable snapshot에서 모든 page SVG를 만든다. snapshot page count와 begin·append·commit·abort는 하나의 snapshot UUID에 결속하며 native session revision은 이 token을 대신하지 않는다.

제품이 유지할 계약은 다음과 같다. 수용 근거는 아래 계층별 검증으로 나누며 모든 경계를 매번
GUI로 재현하지 않는다.

1. snapshot capture 뒤 live 편집을 계속해도 PDF의 page count와 모든 page가 시작 snapshot 한 세대로 완성되고 mixed revision이 없다.
2. 성공·dialog 취소·snapshot/render/append/commit 실패와 timeout 뒤 source path·format·revision·dirty·recent·recovery가 기존 값이며 `notifySaved`가 호출되지 않는다.
3. capture 2분, 전체 pipeline 10분, 4,096쪽, SVG 16 MiB/page, 누적 512 MiB와 process 4-job 제한을 넘긴 요청이 기존 target PDF를 바꾸지 않는다.
4. WebView reload의 idle job은 최대 5분 30초, absolute job은 최대 15분 30초 안에 회수되어 같은 target으로 새 begin이 가능하고, window destroy는 자기 job만 정리하며 다른 window의 유효 lock은 유지한다.
5. app 재시작 cleanup은 OS temp 바로 아래의 24시간보다 오래된 safe product directory만 최대 64개 삭제한다. recent·prefix 불일치·symlink/reparse point·nested directory·unknown content와 사용자 문서·target PDF는 보존한다.
6. 같은 exact SHA에서 HWP/HWPX page count, searchable 한글 text, nonblank render와 atomic target replace를 Windows와 Linux 각각 확인한다.

| 경계 | 주된 수용 근거 | 별도로 기록할 한계 |
|---|---|---|
| snapshot 세대·dispose·source state | 실제 HWP/HWPX serializer round-trip과 격리 SVG 비교, live handler를 바꾸는 결정적 pipeline 테스트 | 실제 앱에서 동시 편집하는 시나리오를 실행했는지 구분 |
| limit·timeout·owner·target lock·실패 회수 | fake clock/작은 limit의 Studio 테스트와 Windows/Linux native job 테스트 | 실제 WebView reload와 5분/15분 대기는 미실행이면 그대로 표시 |
| startup orphan 안전성 | 실제 OS 임시 파일을 쓰는 cleanup 테스트: old/recent/unknown/nested·Linux symlink·Windows junction과 대상 보존 | 함수에 주입한 시각은 실제 24시간 대기가 아님. 앱 재시작 통합 여부도 구분 |
| 사용자 PDF 저장 | 동일 제품 후보의 Windows/Linux 설치본에서 HWP/HWPX 쪽 수·A4·한글 검색·nonblank, 원본 보존과 target 교체 증거 | 수치 성공은 조판 동등성/셀 내부 잘림 해결을 뜻하지 않음 |

결정적 테스트는 snapshot·시간 제한·잠금의 주된 근거로 수용하지만 정적 문자열 검사만으로
대체하지 않는다. 실제 동시 편집·reload·장시간 대기·앱 재시작 통합을 실행하지 않았다면
릴리즈 기록의 검증 한계에 명시한다. 제품의 startup/window event/reaper 연결 코드가 바뀌거나
회수 실패가 관측되면 해당 실제 수명주기 통합 검증을 다시 선정하고 승인받는다.

제품 SHA, 검증 harness SHA, OS, 실행한 테스트와 재사용한 run을 구분한다. 테스트/문서만
바뀌었고 runtime·의존성·설치 bytes가 그대로임을 diff/identity로 확인했다면 기존 설치본을
재사용한다. 제한·실패 시험은 source/target 전후 상태·hash, temp sentinel과 주입 시각을 기록한다.
미실행이나 일부 scope 성공을 전체 native/PDF/릴리즈 수용으로 승격하지 않는다.

최소 보완 실행은 기존 workflow의 선택을 이용한다. 기본 `full`은 유지한다.

- `ci.yml`, `scope=pdf-cleanup-windows`: Windows cleanup Rust 테스트만 실행하며 junction
  사례가 실제 실행됐는지 확인한다. 테스트 컴파일은 하지만 installer/thumbnail을 빌드하지 않는다.
  해당 test step의 `TAURI_CONFIG={"bundle":{"resources":[]}}`만 packaging resource 복사를
  제외한다. workflow/job 전체 환경이나 제품 설정으로 옮기지 않고 빈 DLL/EXE도 만들지 않는다.
  이 테스트 성공은 bundle resource 포함·설치 검증을 대신하지 않는다.
- `alhangeul-linux-gui.yml`, `scope=pdf-hwpx`: 검증된 `build_ref`/`native_run_id`의 DEB로
  HWPX direct PDF만 실행한다. 인쇄·thumbnail은 `skipped`로 기록하고 PDF/10쪽 증거가
  없으면 실패한다. `acceptance-scope.txt`와 phase/outcome을 함께 읽는다.

### 실제 인쇄와 PDF 직접 저장의 분리 gate

직접 PDF 성공은 system print 성공이 아니다. HWP/HWPX 열기·저장·재열기와 함께 다음을 확인한다.

- 별도 Alhangeul preview 없이 system print dialog로 진입한다.
- 출력 쪽 수·방향·한글·표가 열린 문서와 같고 Studio chrome이나 빈 editor 한 쪽을 출력하지 않는다.
- 취소·완료·반복 뒤 orphan surface 없이 편집기로 복귀한다.
- Windows Microsoft Print to PDF, Linux GTK/CUPS 가상 출력과 physical printer의 실행 여부를
  구분한다. PDF render·한글 glyph는 수치 gate와 시각 read-back을 함께 기록한다.

dialog 미진입, 빈 페이지, 잘못된 쪽 수·방향이면 공개 판단을 중단한다. editor WebView 직접 인쇄로
우회하지 않는다. 문서 revision 일관성 등 알려진 결함은 버전 기록의 별도 결정 항목이다.

### Linux x64 exact-SHA GUI acceptance

GUI gate는 exact 40자리 `build_ref`와 성공한 `native_run_id`에 연결된 단일 DEB를 설치한다.
원본 artifact ID·archive digest·inventory와 설치 DEB hash가 같은 chain인지 먼저 확인한다.
source/runtime metadata, step outcome, package-only MIME 전후 상태, screenshot·native UI tree,
직접/GTK/CUPS PDF와 thumbnail helper 실행·cache 근거를 결과와 함께 남긴다.
GUI 실패뿐 아니라 증거 누락·upload 실패도 gate 실패다.

hosted Ubuntu x64의 Xvfb·Nautilus·Thunar/Tumbler·가상 printer 결과는 Windows GUI, Linux arm64
GUI, Fedora RPM·AppImage desktop integration, Wayland/GPU·physical printer 결과가 아니다.
진단 probe는 수용 gate를 대체하지 않는다. legacy threshold와 특정 환경 회피 설정은
[과거 근거](../releases/v0.1.0.md#과거-증거-원문-보존)를 참고하며 현재 후보에 무조건 적용하지 않는다.

## 실패와 복구

- build·signing·inventory·publish·read-back 중 실패한 단계, exact 입력, 오류와 영향 범위를 기록한다.
  source/config·환경·외부 상태의 변화 없이 job만 재실행하지 않는다.
- 게시 전 실패한 candidate는 공개 입력에서 제외한다. 실패 run의 파일을 새 run에 일부 섞지 않는다.
- Release 이후 Pages 전 실패는 기존 stable manifest를 유지하고 문제 Release를 웹 다운로드·feed로
  새로 노출하지 않는다. 첫 공개라면 unreleased 상태를 유지한다.
- manifest 게시 후 결함은 owner 승인으로 이전 stable 안내 복구 또는 더 높은 fixed version을
  선택한다. feed 복구가 이미 업데이트된 설치본의 자동 downgrade를 뜻하지는 않는다.
- stable tag 이동, asset 교체, history rewrite와 무단 key rotation은 하지 않는다.
- 시험 전용 negative fixture의 manifest 교체·복원은 승인된 test endpoint 안에서만 수행한다.
  production release에 적용하지 않으며 과거 시험 절차는 [기록](../releases/v0.1.0.md#과거-증거-원문-보존)으로 보존한다.

## 검증된 rhwp `v0.8.4` native 수용 기준선

기존 upstream 문서의 Task #24 참조를 유지하는 역사적 진입점이다.
[버전 기록의 근거 목록](../releases/v0.1.0.md#기존-검증-근거)에서 Windows NSIS GUI와 MSI package,
Linux x64 DEB GUI 및 arm64 미실행 한계를 구분한다. 이 과거 수용은 새 공개 후보 승인이나 새 파일의
검증 성공이 아니다. 원래 문서의 Task #5·#7·#11·#13·#14·#17·#24·#50·updater 고유 값과 제한은
[고정 원문](../releases/v0.1.0.md#과거-증거-원문-보존)에 보존한다.
