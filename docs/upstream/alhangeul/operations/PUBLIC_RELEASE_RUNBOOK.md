# 공개 릴리즈 실행 가이드

Windows/Linux 릴리즈 순서다. 기준은 [정책](DESKTOP_RELEASE.md), 검증 선택은 [체크리스트](RELEASE_CHECKLIST.md), 결과는
[버전별 기록](../releases/README.md)에 둔다. 이 문서 자체는 실행·서명·게시 승인이 아니다.

## 실행 전 약속

- 명령은 root의 Bash, 승인 exact source·pnpm 의존성 기준이다. 검토 중 일괄 실행하지 않으며 실패하면 중단한다.
- `조회`는 원격 변경 없음, `로컬`은 다운로드·생성물 저장, `원격 실행`은 CI 자원 사용,
  `공개`는 Release 또는 Pages 변경이다. 서명 후보도 Secret 사용 승인이 필요하다.
- `ALH_*`는 버전 기록에서 확정한 값이다. 미설정 검사 통과는 승인이 아니며 private key·암호·token은 기록하지 않는다.
- source/workflow SHA와 Pages SHA, Actions archive digest와 installer SHA-256은 다른 값이다.
  각 gate에 결과·근거·승인자·시점·실패 원인·재개 위치를 기록한다.

## Gate 0 — 공개 입력과 채널 확정

입력: Issue·owner·version/tag·이전 tag/commit·candidate SHA·패키지·한계·서명 정책·release PR. 첫 이전 버전은 `없음`이다.

조회:

```bash
ALH_REPO=postmelee/alhangeul-tauri
git status --short --branch
git remote get-url origin
gh api --paginate "repos/$ALH_REPO/releases" --jq '.[] | {tag_name,draft,prerelease,published_at,html_url}'
gh api "repos/$ALH_REPO/environments/release"
gh api "repos/$ALH_REPO/environments/github-pages"
gh api "repos/$ALH_REPO/environments/github-pages/deployment-branch-policies"
```

기대: 공개 목록·작업트리·reviewer/self-review·허용 ref를 기록한다. release branch policy가 있으면 목록도 조회하며 이름만으로 보호를 추정하지 않는다.
2026-09-04 확인값은 `github-pages`: `devel` 허용, `release`: reviewer 있음/ref 제한 없음이다.
실행 때 재확인하고 필요한 보호 변경은 별도 승인을 받는다. 조회 실패를 '제한 없음'으로 해석하지 않는다.

현재 [updater workflow](../../.github/workflows/alhangeul-desktop.yml)와 [Pages 데이터](../../scripts/pages/release-data.mjs)는 stable `X.Y.Z`만 지원한다.
prerelease는 별도 구현이다. Gate 4 draft는 stable 공개 전 확인 단계이며, 수동 3종은 같은 SHA 일반 run에서 보완한다.
Pages 검사는 #9에서 실제 source와 고정 상태 fixture로 분리했다. 상태별 구조 검증은 공개 승인을 확인하지 않는다.
첫 공개 전 source는 unreleased를 유지하고, Release read-back 뒤 Gate 5의 별도 데이터 PR·배포 승인으로 전환한다.
**중단/재개:** 미정 입력·공개 정책 차이가 있으면 owner 결정 후 이 gate부터 재확인한다.

## Gate 1 — 변경 범위와 검증 선택

입력: 이전 source/첫 분석 SHA는 `ALH_BASE_SHA`, 후보는 `ALH_SOURCE_SHA`. 일반 PR은 `devel`, release PR은 `devel → main`이다.

조회·로컬 검사:

```bash
: "${ALH_BASE_SHA:?승인한 분석 시작 SHA}" "${ALH_SOURCE_SHA:?승인한 후보 SHA}"
git log --oneline "$ALH_BASE_SHA..$ALH_SOURCE_SHA"
git diff --name-status "$ALH_BASE_SHA" "$ALH_SOURCE_SHA"
git rev-parse HEAD
pnpm run check:product-version
pnpm run check:release-metadata
pnpm run check:rhwp-pin
```

기대: HEAD·후보 일치, 제품 version·공개키/endpoint·rhwp tag/commit·core/WASM/Studio 출처 정합성. pin tag만 로컬에 없으면
[upstream 절차](../architecture/UPSTREAM.md)로 exact tag를 확보한다. 임의 pin 갱신은 하지 않는다.
포함 PR은 앱/upstream/운영/문서, Issue는 해결/참고로 구분한다. 최신 upstream과 다르면 pin 유지 승인 또는 별도 갱신 Task를 기록한다.
사용자 원문 `docs/releases/v<version>.notes.json`과 기술 기록을 함께 준비한다.
[작성·생성·검사](../releases/README.md#작성과-생성-및-검사)에 따라 metadata·문구·실제 PR/Issue 근거를 확정한다.

[영향표](RELEASE_CHECKLIST.md#변경-영향별-추가-확인)로 실행/재사용/해당 없음을 정한다. 재사용에는 SHA·run·환경·diff가 필요하다.
문서-only에 native/negative 전체를 반복하지 않으며, 새 bytes의 설치·무결성은 재사용하지 않는다.
**중단/재개:** identity·pin 불일치, 포함 범위 누락, 필수 위험 미결정이면 후보 승인부터 다시 받는다.

## Gate 2 — 승인된 비게시 후보 확보

입력: release PR merge 뒤 승인한 main exact SHA와 이를 가리키는 `ALH_WORKFLOW_REF`,
version/tag/notes, 선택 검증 범위. 준비 Task에서 merge 전 전체 후보를 반복 빌드하지 않는다.
`--ref`는 workflow가 있는 branch/tag이고 `build_ref`는 exact SHA다. dispatch 직전 remote ref의
resolved commit을 확인한다. 일반 artifact와 updater 모두 workflow SHA = build_ref = checkout SHA가 필수다.

원격 실행 — 필요한 경우에만 일반 package/native 증거 확보:

```bash
: "${ALH_WORKFLOW_REF:?승인 ref}" "${ALH_SOURCE_SHA:?승인 SHA}"
gh workflow run alhangeul-desktop.yml -R "$ALH_REPO" --ref "$ALH_WORKFLOW_REF" \
  -f mode=artifact -f build_ref="$ALH_SOURCE_SHA" -f run_tests=true \
  -f artifact_platform=all -f validation_profile=full -f publish_release=false
```

일반 mode는 6종 package·thumbnail 근거를 만든다. 공개에는 DEB x64·RPM x64·DEB arm64만
선택하며 updater run과 같은 exact SHA여야 한다. 일반 MSI/NSIS/AppImage는 게시하지 않는다.

원격 실행·서명 — 비게시 updater 후보:

```bash
: "${ALH_VERSION:?승인 X.Y.Z}" "${ALH_TAG:?승인 vX.Y.Z}" "${ALH_NOTES:?승인 notes}"
gh workflow run alhangeul-desktop.yml -R "$ALH_REPO" --ref "$ALH_WORKFLOW_REF" \
  -f mode=updater -f build_ref="$ALH_SOURCE_SHA" \
  -f release_version="$ALH_VERSION" -f release_tag="$ALH_TAG" \
  -f release_notes="$ALH_NOTES" -f publish_release=false
```

`release`의 `TAURI_SIGNING_PRIVATE_KEY`·`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`는 서명 build에만 사용하며 값을 출력하지 않는다.
updater mode의 `run_tests`는 일반 mode의 전체 test·Windows installer smoke를 실행시키는 스위치가 아니다.

조회 — 반환된 URL에서 run ID를 고정한다. '가장 최근 run'을 임의 선택하지 않는다:

```bash
: "${ALH_RUN_ID:?해당 dispatch run ID}"
gh run view "$ALH_RUN_ID" -R "$ALH_REPO" --json url,headSha,event,status,conclusion,jobs
gh api --paginate "repos/$ALH_REPO/actions/runs/$ALH_RUN_ID/artifacts" \
  --jq '.artifacts[] | {id,name,digest,expired,expires_at,size_in_bytes}'
```

기대: 필수 job/step·upload 성공, checkout/workflow SHA·입력·archive ID/digest/만료일을 기록한다.
updater 두 build·complete inventory verifier 성공과 publish skipped가 필수다. 일반 mode의 updater skipped는 오류도 수용도 아니다.
일반 Windows의 `contract_status=passed`는 [설치 검사 계약](CI_VALIDATION.md#windows-설치-계약과-실제-관측)
통과다. NSIS·MSI·강제 재설치의 원시 결과와 평가 JSON을 읽어 썸네일 실패·재부팅 후 미검증을
별도로 기록한다. `additional-validation-only` handoff나 경량 집계 성공을 Gate 3의 파일 수용으로
대체하지 않는다. #67 독립 재검산 고도화 없이도 아래 exact bytes·승인·read-back 절차는 유지한다.
**중단/재개:** 실패·증거 누락·ref 이동은 원인과 변경 입력 확인 후 승인된 재실행만 한다.

## Gate 3 — 실제 게시할 파일 검증과 Go/No-Go

입력: **게시 대상 bytes**·inventory·설치 환경. 다운로드는 새 `mktemp -d` 폴더에 archive 내부 경로를 유지한다.

일반 artifact의 예 (`ALH_PLATFORM`은 승인한 `windows-x64`, `linux-x64`, `linux-arm64` 중 하나):

```bash
: "${ALH_PLATFORM:?검증할 platform}" "${ALH_RUN_ID:?일반 artifact run}"
ALH_ARTIFACT_DIR=$(mktemp -d)
gh run download "$ALH_RUN_ID" -R "$ALH_REPO" \
  -n "alhangeul-desktop-$ALH_PLATFORM" -D "$ALH_ARTIFACT_DIR"
pnpm run check:desktop-artifacts -- --platform "$ALH_PLATFORM" \
  --root "$ALH_ARTIFACT_DIR" --source-sha "$ALH_SOURCE_SHA" \
  --verify-inventory "$ALH_ARTIFACT_DIR/alhangeul-artifact-inventory.json"
```

updater의 `alhangeul-updater-windows-x64`·`alhangeul-updater-linux-x64`는 `gh run download`로 같은 새 root에 받는다.
`alhangeul-updater-release-inventory`는 별도 폴더에 받고 원본 archive ID/digest도 보존한다.
`ALH_UPDATER_DIR`를 두 slice root로 지정하고 후보 checkout의 공개키로 검사한다:

```bash
: "${ALH_UPDATER_DIR:?검증할 updater root}"
export TAURI_UPDATER_PUBLIC_KEY="$(node -p "require('./apps/desktop/src-tauri/tauri.updater.conf.json').plugins.updater.pubkey")"
pnpm run check:updater-artifacts -- --root "$ALH_UPDATER_DIR" \
  --version "$ALH_VERSION" --tag "$ALH_TAG" --source-sha "$ALH_SOURCE_SHA" \
  --public-key-env TAURI_UPDATER_PUBLIC_KEY
```

기대·증거: 세 installer 각각의 실제 크기·SHA-256·`.sig`·target과 complete inventory가 같다.
검증기는 bytes의 Minisign을 확인하지만 기존 inventory field 비교를 대신하지 않는다. sourceSha는 입력 provenance이지 서명으로 증명된 commit이 아니다.
공개키 fingerprint는 [정책](DESKTOP_RELEASE.md#production-updater-key와-secret-책임)과 대조한다. Authenticode·경고는 별도로 확인한다.

게시할 Windows NSIS/MSI는 격리 환경, AppImage는 쓰기 가능한 파일·부모 경로에서 확인한다.
각 파일의 설치·실행/version·대표 문서 열기/저장/재열기와 production 설정을 검사한다.
수동 3종도 해당 배포판·architecture의 실제 설치·실행이 필요하며 환경은 버전 기록에 고정한다.
Linux launcher 변경 시 DEB/RPM 및 AppImage 내부 `.desktop`의 `%F`, 실제 argv와 열린 문서를
확인한다. 추가 GUI·인쇄·thumbnail은 영향표를 적용하고 미검증 환경을 통과로 쓰지 않는다.
알려진 NSIS 제한이 남으면 대상 환경·관측·MSI 대안·지원 범위와 owner 판단을 명시한다.
진단 계약 성공이나 안내 문구로 필수 기능 검증을 면제하지 않으며, 지원 범위·위험 처리가
미결정이면 공개하지 않는다. 재부팅 요구는 재부팅 후 검증 전까지 미검증으로 남긴다.
**중단/재개:** 미통과 파일은 게시하지 않는다. `publish_release=true`는 재빌드하며 수동 설치
대기를 보장하지 않는다. 아래 CLI 경로도 승인되지 않았다면 멈춘다.

## Gate 4 — GitHub Release 게시와 원격 파일 재검증

선행: Gate 3 통과와 exact 후보/채널/asset·notes 공개 승인. 문서 PR merge나 비게시 서명 승인은 공개 승인이 아니다.
`ALH_NOTES_FILE`은 승인 원문·템플릿에서 생성한 `release-body.md` 절대 경로다.
`check:release-notes` 통과 뒤 exact 내용·hash를 owner에게 제시하고 공개 승인을 기록한다.
updater build의 짧은 `ALH_NOTES`와 GitHub 전체 본문 파일은 용도가 다르다.

유지관리자 CLI로 Gate 3 파일을 그대로 게시한다. `gh api user --jq .login`으로 인증 주체를
확인하고 버전 기록에 owner·승인 시각·허용 main SHA·파일 목록을 남긴다. CLI는 Actions의
environment reviewer/ref 제한을 자동 적용받지 않으므로 이 경로 자체에 대한 승인도 필요하다.
기존 `publish_release=true`는 다른 재빌드 경로이며 이번 파일의 승격용으로 실행하지 않는다.
조회: 성공한 Release 목록 조회와 `git ls-remote origin "refs/tags/$ALH_TAG" "refs/tags/$ALH_TAG^{}"`로
중복을 확인한다. 조회 실패는 부재가 아니다. 기존 Release는 중단 후 복구 판단을 받고,
기존 tag는 peeled commit이 승인 SHA와 같아야 한다. tag가 없을 때만 별도 승인 후 아래를 실행한다:

```bash
git tag -a "$ALH_TAG" "$ALH_SOURCE_SHA" -m "Alhangeul $ALH_VERSION"
git push origin "refs/tags/$ALH_TAG:refs/tags/$ALH_TAG"
```

push 전 로컬 tag, push 후 원격 tag의 resolved commit을 대조한다. 기존 tag 이동·force는 금지다.
로컬 준비: 새 `ALH_UPLOAD_DIR`에 선택한 10개 파일을 basename 그대로 복사하고 원본 hash와
대조한다. 버전 기록의 **명시한 basename 10개**를 `ALH_INPUT_FILES` Bash 배열로 설정한다.
이름 중복·누락·여분 파일·symlink를 거부한다. updater 한 run의 7개와 같은 SHA 일반 run의
수동 3개만 허용한다. `.sig`/inventory를 installer 전용 `create:release-checksums`에 넣지 않는다:

```bash
: "${ALH_UPLOAD_DIR:?검증 파일 폴더}" "${ALH_NOTES_FILE:?승인 사용자 notes 파일의 절대 경로}"
[[ "${#ALH_INPUT_FILES[@]}" -eq 10 && "$ALH_NOTES_FILE" == /* ]]
(set -eC; cd "$ALH_UPLOAD_DIR"; shasum -a 256 -- "${ALH_INPUT_FILES[@]}" > SHA256SUMS)
(cd "$ALH_UPLOAD_DIR" && shasum -a 256 -c SHA256SUMS && shasum -a 256 SHA256SUMS)
```

SHA256SUMS는 상대 basename 10행이며 자기 hash는 버전 기록에 따로 둔다. 공개 — draft 생성:

```bash
(cd "$ALH_UPLOAD_DIR" && gh release create "$ALH_TAG" -R "$ALH_REPO" \
  --verify-tag --draft --title "Alhangeul $ALH_VERSION" --notes-file "$ALH_NOTES_FILE" \
  "${ALH_INPUT_FILES[@]}" SHA256SUMS)
```

아래 read-back으로 draft의 **11개** 전체 bytes·hash·서명·notes를 검증한 뒤 공개한다.
승인된 전체 목록이 그대로라는 확인 없이 publish하지 않는다. 공개 뒤 같은 read-back을 반복한다:

```bash
gh release edit "$ALH_TAG" -R "$ALH_REPO" --verify-tag --draft=false --prerelease=false --latest
```

조회·로컬 저장 — draft/public 두 시점 모두 새 폴더에서 검사한다:

```bash
gh release view "$ALH_TAG" -R "$ALH_REPO" \
  --json url,tagName,targetCommitish,isDraft,isPrerelease,publishedAt,assets,body
git ls-remote --tags origin "refs/tags/$ALH_TAG" "refs/tags/$ALH_TAG^{}"
ALH_PUBLIC_DIR=$(mktemp -d)
gh release download "$ALH_TAG" -R "$ALH_REPO" -D "$ALH_PUBLIC_DIR"
```

기대·증거: 공개 후 stable non-draft/non-prerelease, 승인된 notes, tag의 resolved commit 일치.
annotated tag는 peeled `^{}`를 사용한다. `targetCommitish` 문자열만으로 source를 판정하지 않는다.
asset 11개의 이름·URL·크기·hash·서명과 두 원본 run을 대조한다. 내려받은 SHA256SUMS 자체의
hash부터 로컬 승인값과 비교한 뒤 10행을 검증한다. checksum 목록만 서로 맞는 것으로 끝내지 않는다.

Gate 3 updater 검사에서 root를 `ALH_PUBLIC_DIR`로 바꿔 **원격에서 받은 bytes**의 서명을
재검증한다. inventory 파일이 함께 있어도 이 CLI는 그것을 자동 비교하지 않는다. 각 installer의
SHA-256은 `sha256sum`(Linux) 또는 `shasum -a 256`(검사 호스트), 크기는 `wc -c`로 확인한다.
complete inventory의 sourceSha/version/tag/keyFingerprint와 target별 kind/파일 basename/
URL/size/sha256/signature를 게시 전 근거·원격 bytes·`.sig`와 대조한다. archive 내부 path와
Release 평면 파일명을 구분하며 inventory 자체 hash·Release/asset ID·게시 시각도 기록한다.
`check:updater-acceptance-release`는 시험 prerelease 전용이므로 여기에 사용하지 않는다.
**중단/재개:** 불명확한 응답은 먼저 조회한다. 누락된 draft asset만 owner 승인 후
`gh release upload "$ALH_TAG" -R "$ALH_REPO" <승인한-누락-파일>`로 보완하고 `--clobber`는 금지한다.
다른 bytes·공개 후 누락이면 게시/Pages를 중단하고 [복구 표](#실패와-재개)를 따른다.

### 기존 공개 Release의 body만 보정할 때

원문·metadata·템플릿을 검사하고 새 directory에 생성한 exact body의 수정 승인을 받는다.
기존 Release ID·tag/source·publishedAt·11개 asset identity/hash를 먼저 기록한다.
승인 후 다음 명령은 body만 변경한다. tag 이동·재빌드·asset 교체·채널 변경은 수행하지 않는다.

```bash
: "${ALH_NOTES_FILE:?승인한 생성 body의 절대 경로}"
gh release edit "$ALH_TAG" -R "$ALH_REPO" --notes-file "$ALH_NOTES_FILE"
gh release view "$ALH_TAG" -R "$ALH_REPO" \
  --json body,tagName,isDraft,isPrerelease,publishedAt,assets \
  > "$ALH_NOTES_DIR/release-readback.json"
```

JSON body 문자열과 승인 파일의 UTF-8 bytes를 정확히 비교하고 hash를 남긴다. 기존 identity·
공개 시각·asset 목록이 같아야 한다. 생성 성공을 수정 완료로 쓰지 않으며 응답이 불명확하면
Release를 먼저 조회한다. 실패 시 이전 body와 차이를 보존하고 owner에게 복구 판단을 요청한다.

## Gate 5 — release data PR과 Pages 배포

입력: Gate 4 metadata·inventory, 별도 Pages/manifest 승인. [site/release.json](../../site/release.json)은 `devel` 대상 PR로 변경한다.

| 필드 | 공개값과 검토 기준 |
|---|---|
| status/channel/version/tag | `published`/`stable`/승인 X.Y.Z/일치하는 vX.Y.Z |
| publishedAt/notes | 실제 UTC 공개 시각/같은 version 원문의 content.updaterSummary 그대로, 4000자 이하 |
| downloads | NSIS·MSI·AppImage 세 target의 고정 tag HTTPS URL; 수동 패키지 key 추가 금지 |
| updater | 고정 production endpoint, 활성화 승인 시 `manifestPublished=true`와 검증 inventory |

다운로드만 승인하면 manifest false/inventory null이며, 그 전에는 unreleased/null을 유지한다.
`published`에는 세 URL이 필수다. 기존 manifest 제거는 UI 변경이 아니라 별도 복구 승인이 필요하다.
`tests/pages.test.mjs`는 실제 source의 상태별 구조·URL·inventory와 세 고정 fixture를 검사한다.
`requireUnreleased`는 미공개만 허용할 호출자의 옵션이다. 일반 source 검사에는 강제하지 않는다.
유효한 published 입력도 검사를 통과하므로 첫 공개 전환의 권한은 별도 데이터 PR·Release read-back·배포 승인으로 통제한다.
고정 unreleased의 null·manifest 부재와 published manifest true/false 검사를 유지하며 skip으로 우회하지 않는다.

웹 일반 다운로드 목록은 승인 원문 `docs/releases/v<version>.notes.json`의 installer 6종에서
`build:pages`가 `_site/downloads.json`으로 생성한다. Windows x64 NSIS·MSI와 Linux x64
AppImage는 앱 내 업데이트 대상이며 Linux x64 DEB·RPM과 Linux arm64 DEB는 수동 업데이트다.
`site/release.json.downloads`와 signed updater manifest는 기존 3종을 유지한다.

새 published release는 같은 version/tag/공개일/짧은 notes와 installer inventory를 가진 원문을
먼저 준비하고 버전 HTML을 공식 생성한다. published 원문 누락·metadata/inventory 불일치나
수동 작성한 `site/downloads.json`은 build/check에서 거부한다. unreleased 목록은 비어 있다.
빌드 후 `check:pages`는 생성 목록의 exact bytes를 원문과 대조한다. 브라우저는 release와
목록의 정합성을 확인한 뒤 6종을 함께 활성화하며 조회 실패·버전 혼합에는 GitHub Releases
‘다운로드 안내’를 유지한다. 웹 목록 검사는 installer bytes·서명 검증을 대신하지 않는다.

로컬 생성·검사 — 승인된 Pages checkout에서:

```bash
pnpm run check:release-notes
pnpm run test:release-notes
pnpm run build:pages
pnpm run check:pages
node --test tests/updater-release.test.mjs tests/pages.test.mjs tests/actions-workflows.test.mjs
```

버전별 HTML·목록 링크·short notes를 [작성 절차](../releases/README.md#작성과-생성-및-검사)에 따라 반영한다.
규격이 별도 PR이면 먼저 devel에 병합하고 데이터 PR은 최신 devel을 merge해 새 head를 검사한다.
원문·템플릿·짧은 notes가 바뀌면 이전 manifest/body hash를 재사용하지 않는다.
기대: data/inventory/manifest·Pages 검사 성공. 원격 파일 검사가 아니므로 Gate 4를 대체하지 않는다. PR diff·Pages SHA도 기록한다.
원격 실행·공개 — merge된 exact `devel` SHA를 `ALH_PAGES_SHA`로 승인받은 뒤:

```bash
: "${ALH_PAGES_SHA:?승인한 Pages exact SHA}"
git ls-remote origin refs/heads/devel
gh workflow run pages.yml -R "$ALH_REPO" --ref devel -f deploy_ref="$ALH_PAGES_SHA"
```

remote devel 일치 확인 후 dispatch한다. Pages는 workflow SHA = deploy_ref = checkout SHA와 `github-pages` 환경을 사용한다.
run·Pages SHA·upload/deploy 결과를 기록한다. 앱 source와 Pages SHA는 같을 필요가 없다.
**중단/재개:** ref 이동·검사·배포 실패면 Release는 다시 만들지 않고 Pages 입력부터 재확인한다.

## Gate 6 — 공개 화면과 production 설치본 확인

입력: Pages run·Release·실제 MSI/NSIS/AppImage·이전 버전(있는 경우). 조회·저장 — manifest 승인·게시 후:

```bash
ALH_READBACK_DIR=$(mktemp -d)
curl --fail --location --show-error \
  https://postmelee.github.io/alhangeul-tauri/updater/stable.json \
  --output "$ALH_READBACK_DIR/stable.json"
cmp _site/updater/stable.json "$ALH_READBACK_DIR/stable.json"
```

`_site`는 Gate 5 exact SHA output이다. HTTP 성공과 version/pub_date/notes/세 URL·signature를 대조한다.
manifest false라면 미게시 상태를 확인한다. HTTP 200은 installer 서명 검증 성공이 아니다.
공개 홈·`/updates/`·`/feedback/`와 `/updates/v<version>.html`의 버튼/페이지 안 다운로드 선택·notes·수동 안내·모바일 줄바꿈과 승인 파일 연결을 확인한다.
버전별 안내의 실제 공개 날짜·6개 고정 다운로드·기술 기록 링크, 최신 선택 영역의 Windows 2종·Linux 4종과 실제 release/downloads data를 대조한다.

첫 공개: version·production key/endpoint와 manifest 게시 시 같은 버전의 '업데이트 없음'을 확인한다.
manifest 미게시라면 production 확인 미실행 사유를 남긴다. endpoint 오류를 '업데이트 없음'으로 기록하지 않는다.
MSI/NSIS 격리 설치본·실제 파일/부모 경로 쓰기 자격을 갖춘 AppImage를 다음 릴리즈까지 보존한다. 개인 경로·문서는 공개하지 않는다.
다음 공개: 각 **동일 설치 형식**에서 실제 N → N+1 확인·다운로드·서명 검증·동의·설치·재실행·
version을 기록한다. dirty 문서 보호를 유지하고 NSIS↔MSI 교차 설치로 대체하지 않는다.
DEB/RPM/arm64는 수동 안내다. 시험 endpoint·같은 version·실제 production upgrade를 구분하며 공개 후 결과를 미리 완료로 적지 않는다.
**중단/재개:** production 확인 실패는 원인을 기록하고 아래 복구 판단을 받는다.

## Gate 7 — 기록과 다음 릴리즈 인계

입력: 모든 gate 결과·승인·URL·SHA·파일 provenance. 버전 기록·[인덱스](../releases/README.md) 갱신 후 diff·링크를 확인한다.
Release·Pages·manifest·실제 updater 상태를 분리한다. run 외 inventory·hash·환경·한계를 남기며 임시 archive를 영구 보존으로 착각하지 않는다.
owner 결과 확인 뒤 보고·PR·merge 후 정리한다. 미실행은 담당 Issue·다음 version에 인계하며 임의 close하지 않는다. upstream은 별도 Task다.
첫 공개 후 보존 설치본 → 별도 upstream 갱신 → 다음 공개 → 실제 updater 검증으로 연결한다.

## 실패와 재개

| 실패 시점 | 보존·중단 | 승인 후 재개 |
|---|---|---|
| 후보 build·서명·inventory·설치 | 실패 입력·run·비밀 없는 오류; 게시 금지 | 원인 변화 확인 후 Gate 1~3의 영향 부분만 |
| Release 게시 요청 결과 불명확 | exact tag/Release/asset 먼저 조회; 중복 생성 금지 | 미게시라면 원인 해결, 일부 게시면 owner 복구 판단 |
| Release 성공, Pages 전/배포 실패 | Release/tag 유지; 먼저 공개 상태를 조회해 기존 feed/첫 unreleased 유지 여부 확인 | 변경되지 않았다면 Gate 5에서 Pages만 재개; 변경됐다면 아래 사후 결함 경로 |
| manifest 게시 후 결함 | 새 유입·이미 업데이트한 사용자 영향 분리, 추가 게시 중단 | 이전 검증 feed/안내 복구 또는 더 높은 fixed version 승인 |

같은 입력/상태에서 CI만 반복하거나 asset 덮어쓰기/tag 이동으로 고치지 않는다. feed 복구는 앱 자동 downgrade가 아니다. key 노출·유실은
[키 책임 정책](DESKTOP_RELEASE.md#production-updater-key와-secret-책임)으로 별도 처리한다.
첫 공개에 없는 이전 version을 만들지 않는다. owner가 unreleased/manifest 미게시 복구 또는 더 높은 수정 버전을 승인하며 앱 조회 오류 가능성도 알린다.
