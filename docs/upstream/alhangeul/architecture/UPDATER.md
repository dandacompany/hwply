# 데스크톱 updater 아키텍처

Alhangeul updater는 Windows x64 MSI·NSIS와 Linux x64 AppImage의 설치 형식을 구분해
동일한 형식의 서명된 새 버전만 확인·설치한다. DEB, RPM, Linux arm64와 설치 근거가 불명확한
환경은 앱 안에서 설치하지 않고 [업데이트 페이지](https://postmelee.github.io/alhangeul-tauri/updates/)로
안내한다.

현재 source에는 runtime과 release overlay가 준비되어 있지만 `site/release.json`은
`unreleased`, `manifestPublished=false`다. 공개 manifest와 실제 N→N+1 수용이 완료되기 전에는
updater가 배포 환경에서 활성화됐다고 판단하지 않는다.

## 소유 경계

- `apps/studio-host/src/core/desktop-updater.ts`는 Tauri bridge, stale event 제거와 UI 구독을 소유한다.
- `apps/studio-host/src/ui/update-dialog.ts`는 상태·진행률·릴리스 노트, 명시 설치와 native command를
  통한 수동 다운로드 안내만 표시한다.
- `apps/desktop/src-tauri/src/updater/`는 설치 형식 판별, 상태 전이, 단일 작업 직렬화,
  metadata 검증, 다운로드·설치와 dirty document 차단을 소유한다.
- `tauri-plugin-updater`는 HTTPS manifest 조회와 Tauri updater signature 검증·설치를 담당한다.
- `scripts/updater/`와 `scripts/pages/`는 signed artifact inventory와 stable manifest의 게시 전
  검증을 담당한다. runtime은 release asset 목록을 직접 추측하지 않는다.

base `tauri.conf.json`에는 endpoint와 public key가 없다. release build에서만
`tauri.updater.conf.json`을 명시적으로 합쳐 updater artifact 생성, canonical HTTPS endpoint,
production public key와 Windows passive install을 활성화한다. debug build와 일반 artifact build는
이 overlay를 사용하지 않으므로 updater service가 수동 다운로드 전용으로 닫힌다.

## command, event와 상태

TypeScript는 다음 다섯 command만 호출한다.

| Command | 역할 |
|---|---|
| `updater_get_state` | 현재 snapshot 조회 |
| `updater_check` | 사용자가 요청한 새 버전 확인 |
| `updater_apply` | 사용자가 선택한 update 다운로드 후 설치 |
| `updater_open_manual_downloads` | 인자 없이 canonical 업데이트 페이지를 OS 기본 브라우저로 열기 |
| `updater_restart` | AppImage 설치 완료 뒤 명시 재시작 |

Rust는 상태가 바뀔 때 `alhangeul-updater-state` event로 전체 snapshot을 보낸다. 상태는
`idle → checking → available → downloading → installing` 순서이며 AppImage 성공은
`restartRequired`, 실패는 `error`로 끝난다. 시작 시 자동 확인은 release-configured 지원 설치본에서만
실행한다. update가 발견돼도 자동 다운로드·설치하거나 앱을 임의로 종료하지 않는다.

snapshot은 operation ID, current/available version, resolved target, release notes, byte progress,
blocker, retry 가능 여부가 있는 failure와 manual download URL을 포함한다. 동시에 하나의 check/apply만
허용하고 이전 operation이나 뒤로 이동한 download progress event는 UI에서 버린다.

## 설치 target 판별

판별은 추측보다 거부를 우선한다.

| 환경 | 필요한 근거 | updater target |
|---|---|---|
| Windows x64 NSIS | 실행 경로와 일치하는 제품 record 하나, current-user uninstall entry 하나, NSIS uninstaller·binary 근거 | `windows-x86_64-nsis` |
| Windows x64 MSI | 실행 경로와 일치하는 제품 record 하나, 64-bit machine uninstall entry 하나, product code·Windows Installer 근거 | `windows-x86_64-msi` |
| Linux x64 AppImage | 절대 `APPIMAGE`·`APPDIR`, 실제 파일·디렉터리, 실행 파일이 AppDir 내부, 현재 process의 실효 권한으로 AppImage와 부모 경로에 `W_OK` | `linux-x86_64-appimage` |

architecture 불일치, 근거 누락·중복·경로 불일치와 probe 오류는 `unsupportedInstall`로 닫힌다.
읽기 전용 AppImage는 `readOnlyAppImage`로 닫힌다. Windows MSI와 NSIS를 교차 선택하거나 Linux
DEB/RPM을 AppImage로 간주하지 않는다.

## 확인·설치 보호

manifest 응답은 현재 version보다 높은 안정 SemVer, runtime에서 선택한 exact target, HTTPS download와
target에 맞는 canonical x64/amd64 파일명을 모두 만족해야 한다. MSI, NSIS와 AppImage URL 종류 또는
architecture가 다르거나 metadata가 불완전하면 download 전에 `invalidUpdateMetadata`로 실패한다.
artifact bytes와 signature의 최종 신뢰 검증은 Tauri updater가 embedded production public key로
수행한다. manifest 조회와 installer download는 각각 120초 request timeout 안에서 완료하며,
timeout과 HTTP 실패는 설치를 시작하지 않고 retry 가능한 `updateCheckFailed` 또는
`updateDownloadFailed`로 반환한다.

`updater_apply`는 download 전과 download 완료 후에 열린 문서의 dirty 상태를 각각 확인한다.
어느 시점이든 저장하지 않은 문서가 있으면 `dirtyDocuments`로 `available` 상태에 돌아가며 install,
종료와 재시작을 실행하지 않는다. 다운로드·설치는 분리되고 실패한 pending bytes는 재사용하지 않는다.
AppImage만 설치 성공 후 명시 재시작을 요구하며 Windows installer의 종료 동작은 native updater가
소유한다.

network, download와 install 오류는 편집 session을 유지한 채 `error`와 retryable failure로 표시하고
수동 다운로드 동작도 함께 제공한다. 지원하지 않는 설치본과 읽기 전용 AppImage도 command를
실패시키는 대신 수동 다운로드 URL을 계속 제공한다. UI는 snapshot의 URL을 직접 열지 않으며,
`updater_open_manual_downloads`가 인자를 받지 않고 고정된 canonical URL만 연다.

## 배포 신뢰 사슬

production public key는 tracked release overlay에 포함되며 private key와 암호는 repository, workflow
source, log와 artifact에 들어가지 않는다. release inventory의 canonical public-key fingerprint는
`9f86f804067eff359cd32707137dfaaea8710450985dda86b0392da5db63b8f8`다.

신뢰 사슬은 다음 순서로만 전진한다.

1. exact 40자리 source SHA에서 Windows MSI·NSIS와 Linux x64 AppImage를 만든다.
2. 세 installer와 각 `.sig`를 embedded public key로 검증하고 size·SHA-256·target·source SHA를
   complete release inventory에 고정한다.
3. inventory와 같은 artifact만 exact version tag의 GitHub Release에 게시한다.
4. release asset을 다시 읽어 inventory와 일치시킨 뒤 `site/release.json`에 반영한다.
5. complete published release data에서만 Pages output의 `updater/stable.json`을 생성한다.
6. canonical Pages manifest read-back과 세 설치 형식의 실제 N→N+1 수용 뒤 지원 상태를 확정한다.

중간 단계가 실패하면 기존 stable manifest를 유지하고 실패한 artifact나 inventory를 다음 실행에
재사용하지 않는다. key 보관, 게시 승인과 복구 절차는
[데스크톱 artifact와 배포 준비](../operations/DESKTOP_RELEASE.md)를 따른다.

## 검증 경계

플랫폼 중립 test는 상태 전이, target evidence, dirty 차단, metadata와 release/manifest 계약을
검증한다. 실제 Rust desktop test·Clippy, Tauri bundle, signature와 설치 동작은 Windows/Linux의
exact-SHA gate에서 검증한다. 지원 범위 밖 host의 native build 결과를 수용 근거로 사용하지 않는다.
