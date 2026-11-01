# 변경 범위 기반 CI 검증

이 문서는 작업자가 필요한 검증을 선택하는 운영 계약이다. 개별 실행의 성패와 시간은 task 보고서에 기록한다. Actions artifact는 공식 릴리즈가 아니며 이 문서는 게시 권한을 부여하지 않는다.

외부 Action 고정·갱신은 [Action 의존성 정책](ACTION_DEPENDENCIES.md)을 따른다.
`pnpm run check:action-pins`와 `test:automation`은 workflow/composite의 전체 외부 참조를 검사한다.

## PR 필수 검증

`devel` 대상 PR은 [PR acceptance](../../.github/workflows/pr-acceptance.yml)가 자동으로 기존
Node/Studio·Windows PS fast를 실행한다. draft와 문서-only PR도 검사하며 단일 check
`Alhangeul PR required`는 실패·취소·누락·skip을 거부한다. merge candidate SHA와 committed
rhwp lock/HEAD/index/submodule 정합성을 확인한다. fast 성공은 native/package/GUI 수용이 아니다.
추가 수용은 아래 profile/task 계획에 따른다. 실제 보호·리뷰·복구는 [devel 보호 정책](BRANCH_PROTECTION.md)을 따른다.

## 계층과 책임

| 계층 | 입력 | 결과/소유권 | 대체하지 못하는 것 |
|---|---|---|---|
| 빠른 계약 | harness/source exact SHA | Node 계약·Studio·Windows PowerShell parser/회귀 | native ABI, 설치, Shell bitmap |
| core 진단 | product exact SHA, rhwp pin, OS | CLI release build·대표 fixture 성능/메모리 | installer와 desktop feature 조합 |
| 제품 생성 | product exact SHA, platform, tests 선택 | Rust 검사·Tauri·inventory·package lifecycle | 새 bytes의 별도 환경 수용 |
| 기존 artifact 검증 | product SHA + harness SHA + run/ID/digest | 같은 bytes의 installer/회귀 검사 | 변경된 제품 source 검증 |
| 전체 artifact 수용 | 모든 지원 platform 및 tests/core | 필수 job 상태 집계 | GUI·updater·공개 릴리즈 승인 |

빠른 계약 → 플랫폼별 제품 생성 → 해당 플랫폼 설치 검증 순서다. core 진단은 제품 생성과 병렬이며 전체 수용에서 합류한다. Windows 검증은 Linux 빌드 결과에 의존하지 않는다. 필수 검사 실패·미검증은 후속 gate로 전달한다. 설치의 원시 실패와 사전 정의한 진단 계약의 성공은 아래 상태 해석에 따라 별도로 기록한다.

## 작업별 실행 방법

수동 `Alhangeul CI` (`ci.yml`)의 `profile`을 선택한다. 기본값 `native`는 기존 Linux Rust
검사를 유지한다. 일상적인 script/계약 수정의 첫 피드백에는 `fast`를 사용한다.

동일 ref의 실행은 요청 profile별로 분리한다. 명시 `fast`만 진행 중인 같은 profile 실행을
취소하며, `auto`를 포함한 나머지 profile은 진행 중 실행을 취소하지 않는다. GitHub 기본
concurrency 정책에 따라 같은 그룹의 오래된 pending 실행은 새 pending 실행으로 교체될 수 있다.
#19의 기존 `scope=pdf-cleanup-windows` 선택은 별도 Windows Rust cleanup 검사로 보존한다.
이 선택은 profile 실행을 생략하며 같은 scope의 진행 중 실행을 취소하지 않는다.
일반 profile은 `scope=full`(기본값)에서 선택한다. concurrency 그룹은 ref/profile/scope 조합이다.

| profile | 실행 범위 | 사용 시점 |
|---|---|---|
| `fast` | Linux Node/Studio와 Windows PowerShell parser·격리 회귀 | native 생성 전 빠른 피드백 |
| `native` | fast 후 Linux desktop/document-preview Rust test·clippy | 기존 Linux Rust 검사 |
| `installer` | fast 후 고정된 Windows artifact를 현재 harness로 MSI/NSIS 검증 | 제품 bytes는 그대로이고 installer 검사만 변경 |
| `windows-package` | fast, Windows core·제품 생성 병렬, 새 Windows 설치 검증 | Windows 제품/등록/worker 변경 |
| `linux-package` | fast, Linux x64/arm64 core·제품 생성·package lifecycle | Linux 제품/helper/MIME 변경 |
| `full` | fast, 세 target의 core·native/package, Windows 설치와 전체 결과 집계 | 공유 제품/lock/build/workflow 변경 또는 통합 후보 |
| `auto` | exact `base_sha`와 현재 checkout 사이의 변경으로 위 profile 선택 | 변경 범위에 따른 검증 선택 |

예를 들어 승인된 작업 브랜치에서 빠른 검사만 실행한다.

```sh
gh workflow run ci.yml --ref publish/task59 -f profile=fast
```

branch 이름은 현재 작업의 `publish/taskN`으로 바꾼다. 자동 선택에는 승인한 비교 commit의
40자리 SHA를 `base_sha`로 지정한다. branch 이름·없는 commit·빈 diff는 full로 확대한다.

```sh
gh workflow run ci.yml --ref publish/task59 -f profile=auto -f base_sha="$BASE_SHA"
```

자동 선택 규칙의 진실 원천은 [`scripts/ci/profiles.mjs`](../../scripts/ci/profiles.mjs)다.
문서 및 일반 Node 계약만 변경하면 fast, Windows/Linux 전용 제품 경로는 해당 package,
공유 코드·CI·lock·알 수 없는 경로·플랫폼 혼합은 full이다. rename의 이전/새 경로와 삭제도
포함한다. 기존 installer helper만 바뀌면 installer를 선택하지만 아래 재사용 입력이 하나라도
없으면 windows-package로 확대한다. 새 이름의 script를 installer helper로 추측하지 않는다.
명시 `installer`는 네 재사용 입력의 누락·형식 오류를 선택 단계에서 거부한다. `auto`도
네 입력이 모두 있지만 형식이 잘못되면 거부한다. SHA는 40자리 소문자 hex, ID는 양의 안전한
정수, digest는 `sha256:` 뒤 64자리 소문자 hex여야 한다.
명시 profile은 작업자가 선택한 부분 검증이며 diff 전체 수용을 자동으로 보장하지 않는다.

기존 `Alhangeul Desktop Artifact Build`의 `mode=artifact`는 같은 reusable 구현을 호출한다.
`artifact_platform`은 `all`, `windows-x64`, `linux`, `linux-x64`, `linux-arm64`이고,
`validation_profile`은 `full`, `product`, `core`다. `product`는 core와 Windows 설치 smoke를
생략한 제품 생성, `core`는 core 진단만 뜻한다. `run_tests`는 native Rust 검사를 선택하며
빠른 계약은 항상 실행한다. **all/full/run_tests=true**만 전체 artifact 수용으로 집계한다.
ordinary artifact는 선택 workflow SHA와 `build_ref`의 resolved SHA가 같아야 한다. 다른
source를 새 workflow로 재빌드하는 경로는 허용하지 않으며, 기존 bytes는 installer를 쓴다.

```sh
gh workflow run alhangeul-desktop.yml --ref publish/task59 \
  -f mode=artifact -f build_ref="$CANDIDATE_SHA" \
  -f artifact_platform=all -f validation_profile=full \
  -f run_tests=true -f publish_release=false
```

workflow/source SHA, 선택 범위 및 각 필수 job의 실제 상태는 run summary에 남긴다.
core 실패 때문에 제품 빌드를 직렬로 막지는 않지만 최종 gate는 실패한다. Windows 설치는
Windows 제품의 artifact ID만 받아 실행하고 Linux 완료를 기다리지 않는다.

## 재사용 경계

제품 source가 달라지면 기존 installer는 새 source의 검증이 아니다. harness만 달라진 경우 product SHA와 harness SHA를 별도로 고정한다. source build workflow SHA와 실제 checkout SHA가 다를 수 있으므로 run head SHA만으로 제품 provenance를 단정하지 않는다. 재사용 경로는 같은 SHA로 workflow/source를 실행한 생산 run만 허용하고 archive metadata와 다운로드 bytes를 검증한다.

기존 artifact는 정확한 repository/run/workflow/ID/name/digest, 만료 여부 및 성공한 producer를 검사한다. 검증 전에 압축 bytes SHA-256을 재계산하고, 추출 후 inventory를 재계산한다. 누락·만료·불일치·중복·실패한 producer는 거부한다. latest 검색이나 artifact 이름만으로 대체하지 않는다.

새 제품 inventory에는 `sourceSha`를 기록한다. 과거 inventory는 일반 파일 검증에서 계속 읽을 수 있지만 sourceSha가 없는 과거 artifact를 새 재사용 profile에 넘기면 거부한다. 새로운 provenance를 갖춘 제품 artifact를 한 번 생성해야 한다. 검사 버전은 harness의 package.json이 아니라 product SHA의 package.json에서 가져온다.

재사용 입력은 `product_sha`, `product_run_id`, `artifact_id`, `artifact_digest` 네 개다.
생산 run은 같은 저장소의 `alhangeul-desktop.yml` 또는 `ci.yml`이며 전체 run 성공이어야 한다.
Linux/core 실패가 남은 run의 Windows archive만 골라 전체 생산 성공으로 취급하지 않는다.
성공한 `windows-package` 등 부분 생산 run의 Windows artifact도 재사용할 수 있다.
이는 선택한 생산 범위의 성공이며 모든 플랫폼 수용을 뜻하지 않는다.
`artifact_digest`는 `sha256:` 접두사가 있는 archive digest로, installer 개별 파일 hash와 다르다.

Windows ordinary artifact의 전달 목적은 `additional-validation-only`다. 성공한 producer에
알려진 NSIS 제한이 기록되어 있어도 추가 검사는 가능하지만, 제한 해결·새 source 제품 수용·
릴리즈 승인을 의미하지 않는다. handoff의 `productAcceptance`와 `releaseAcceptance`는
`unverified`이며, metadata 확인만으로 다운로드 bytes 검증이 끝난 것도 아니다. 현재 attempt와
artifact 소속·생성 시점을 함께 확인한다. 독립 acceptance archive/replay는 필수 조건이 아니며
[#67](https://github.com/postmelee/alhangeul-tauri/issues/67)의 후속 고도화다. 첫 릴리즈 선행 조건으로 삼지 않는다.

```sh
gh workflow run ci.yml --ref publish/task59 -f profile=installer \
  -f product_sha="$PRODUCT_SHA" -f product_run_id="$PRODUCT_RUN_ID" \
  -f artifact_id="$ARTIFACT_ID" -f artifact_digest="$ARTIFACT_DIGEST"
```

다운로드 action의 digest 오류를 실패로 강제하고, 현재 harness가 inventory의 source SHA와
모든 파일 hash를 재계산한 뒤 installer를 실행한다. 현재 harness SHA, 실제 제품 SHA,
archive ID/digest/크기와 installer 결과는 `alhangeul-installer-reuse-evidence-{nsis,msi,msi-forced-reinstall}`에 남긴다.
checkout과 Node 준비 이후 handoff 검사 전에 `workflow-context.json`을 생성한다. 여기의
요청 식별자는 아직 `unverified`이며, 성공한 handoff의 검증 metadata와 구별한다. handoff,
다운로드, inventory 또는 설치가 실패해도 `step-outcomes.json`에 실제 단계 상태를 기록하고
진단 upload를 시도한다. checkout/Node 준비 자체의 실패에는 실행 로그로 원인을 확인한다.
release 권한·secrets·제품 재빌드가 필요하지 않다.

Windows PDF 소비자도 `alhangeul-desktop.yml` 또는 `ci.yml`의 성공한 exact producer만 받는다.
기존 `build_ref`·`native_run_id`로 검증한 단일 artifact의 ID/digest를 기록하고, 다운로드 digest와
inventory source SHA/hash 확인 뒤 설치·선택 시나리오·cleanup을 실행한다. `open_only=true`는
문서 열기만 확인하며 PDF 내보내기 수용이 아니다. 기존 PDF/dialog dispatch와 Windows cleanup
scope를 유지한다. installer profile의 네 입력과 PDF의 기존 입력을 혼동하지 않는다.

Windows smoke와 installer reuse는 NSIS-only, MSI-only, MSI 강제 재설치를 각각 별도 runner에서
실행한다. 같은 run의 `installer-status`는 현재 attempt의 세 job과 필수 step·upload·최종 gate
성공을 확인하는 경량 집계다. 원시 증거를 재다운로드·독립 재계산하지 않는다. 후속 수정은 아래
소유 파일에 반영하고, Desktop entry에 옮긴 job 본문을 다시 복제하지 않는다.

| 변경할 책임 | 소유 파일 (`.github/workflows/`) |
|---|---|
| 빠른 검사·PowerShell 회귀 진입 | `alhangeul-ci-fast.yml` 및 `scripts/ci/windows-tests.ps1` |
| core CLI probe | `alhangeul-thumbnail-core.yml` |
| native build·Rust 검사·Linux package lifecycle | `alhangeul-artifact-platform.yml` |
| 같은 run의 Windows 설치 검사 | `alhangeul-windows-smoke.yml` |
| 이전 run의 exact Windows bytes 재검증 | `alhangeul-installer-reuse.yml` |
| 기존 Windows 제품의 PDF·문서 열기 검사 | `alhangeul-windows-pdf.yml` |
| 플랫폼 의존관계·최종 gate | `alhangeul-artifacts.yml` |

## 상태 해석

- `passed`: 명시한 계층의 검사 계약 통과. 실제 기능 성공 범위는 개별 결과로 확인.
- `failed`: 실행 또는 필수 증거 검증 실패. 진단 upload 성공으로 상쇄하지 않는다.
- `skipped`: 선택하지 않았거나 선행 실패로 건너뜀. 통과가 아니다.
- `reused`: 고정된 기존 bytes 사용. 새 제품 빌드 통과가 아니다.
- `unverified`: 필요한 검사를 수행하지 않았거나 근거가 부족함.

부분 profile 성공에는 전체 artifact 수용이라는 표현을 사용하지 않는다. `run_tests=false`, 단일 platform, core 생략, 기존 artifact만의 검증은 부분 검증이다. 릴리즈에는 [최소 체크리스트](RELEASE_CHECKLIST.md)가 별도로 적용된다.

### Windows 설치 계약과 실제 관측

| 계약 | 통과 조건의 의미 | 별도로 읽을 실제 결과 |
|---|---|---|
| `strict-product` | 지정한 설치·썸네일·lifecycle 증거 모두 통과 | 해당 시나리오만 수용, 모든 환경 보장 아님 |
| `hosted-nsis-diagnostic` | 정상 생성 또는 엄격히 정의한 사용자별 Shell 활성화 실패 패턴의 진단·정리 통과 | 제한 재현 시 raw exit 1·실패 12건, `thumbnailStatus=not-accepted` 유지 |
| `msi-forced-reinstall-reboot` | 정상 완료 또는 재설치 3010과 필수 관측·정리가 계약에 일치 | 3010이면 `reboot-required`·`post-reboot-unverified`, 재부팅 후 성공 아님 |

`installer-evaluation.json`과 `smoke-process.json`, `step-outcomes.json`, 원시 summary를 함께
읽는다. 새 오류·혼합 실패·증거 누락·정리 실패를 알려진 제한으로 자동 허용하지 않는다.
reuse는 `contract-result.json`에도 raw outcome과 계약 결과를 구분한다. raw smoke의
`continue-on-error` 표시만으로 통과하지 않으며 필수 평가·증거 upload·최종 gate가 모두 필요하다.
upload 실패도 최종 실패다. 종료 집계의 `contract_status=passed`와
`product_observation=see-scenario-evidence`는 전체 썸네일 지원·최신 VDI·릴리즈 수용이 아니다.
과거 실패 run을 새 계약으로 소급 통과시키지 않는다. 실제 후보별 관측은
[버전별 기록](../releases/v0.1.0.md#windows-썸네일-진단-수용과-잔여-제한)에 둔다.

## 측정 기준

run ID·attempt·head SHA·workflow path와 job/step의 started_at/completed_at을 보존한다. job wall time과 step 합계를 구분하며 병렬 job 시간을 더해 사용자 대기 시간으로 표시하지 않는다. job 시작 전 경과 시간은 dependency/runner 대기 등이 섞여 있어 runner queue 시간으로 단정하지 않는다. 미완료·skipped step은 0초 통과로 환산하지 않는다.

`node scripts/ci/timings.mjs postmelee/alhangeul-tauri RUN_ID`는 run의 현재 attempt에 속한
job/step을 JSON으로 출력한다. 필요한 경우 `GH_TOKEN` 또는 `GITHUB_TOKEN`을 실행 환경에서
제공한다. token을 명령 출력·보고서에 적지 않는다. cache hit/restore key는 해당 action log와
별도로 대조한다. 동일 source·workload 재실행을 cold/warm 검증 목적으로 선택했다면 그 목적과
첫 실행 성공을 기록하고, 실패를 변화 없이 재시도하는 용도로 쓰지 않는다.

| 기준 run | Windows 제품 build | core | Rust 검사 묶음 | thumbnail build | Tauri | Cargo restore |
|---|---:|---:|---:|---:|---:|---:|
| [34047889263](https://github.com/postmelee/alhangeul-tauri/actions/runs/34047889263) | 24:51 | 7:30 | 5:12 | 2:19 | 5:18 | 2:09 |
| [34052696931](https://github.com/postmelee/alhangeul-tauri/actions/runs/34052696931) | 34:37 | 10:24 | 6:40 | 3:14 | 7:33 | 2:11 |

두 run은 #57의 서로 다른 source이며 통제된 동일 SHA A/B 실험이 아니다. 동일 3.4 GB primary cache hit로 post-save가 생략됐지만 여러 profile/feature의 rhwp 컴파일은 반복됐다. 캐시 hit를 컴파일 재사용과 동일시하지 않는다. Tauri beforeBuild의 두 번째 thumbnail 빌드는 1초 미만이어서 우선 병목으로 취급하지 않는다.

비교 때 runner image/CPU 편차, toolchain, Cargo lock, feature/profile/target, cache restored key와 cold/warm 여부를 기록한다. core CLI host release와 desktop target release, debug test, protocol-only 조합을 근거 없이 하나로 합치지 않는다. 단계 누락으로 줄어든 시간과 동일 workload의 개선을 구분한다.

### Cargo 경계

source 다운로드 cache와 compiled target cache를 분리한다. source cache는 lock 변경 시에도 같은 OS/architecture prefix에서 다운로드 자료를 복원한다. target restore prefix는 OS/architecture/workload/target/rustc -vV/manifest·lock fingerprint를 포함하고 primary key는 실제 checkout SHA를 추가한다. 새 source의 성공 build는 새 cache를 저장하므로 오래된 lock-only exact hit에 계속 고정되지 않는다. target은 다른 compiler/lock/workload로 fallback하지 않는다. source 다운로드 cache에는 compiled target을 포함하지 않는다. 기존 동일 SHA warm 측정은 lock 변경 fallback의 성능 측정이 아니다.

ordinary desktop 검사는 `CARGO_BUILD_TARGET`을 해당 matrix target으로 고정하여 implicit host debug와 explicit target debug를 불필요하게 나누지 않는다. core는 별도 runner/cache에서 host release probe를 유지한다. protocol-only와 render, desktop/worker feature 조합에 필요한 컴파일은 제거하지 않는다. cache를 삭제하거나 기존 cache를 덮어쓰는 작업은 수행하지 않는다.

warm 측정 전에는 해당 branch의 exact target key와 source cache가 실제로 남아 있는지,
크기·생성/마지막 접근 시각과 저장소 총 사용량을 확인한다. GitHub의
[보존·용량 정책](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching)에
따르면 설정된 한도에 도달할 때 오래 접근하지 않은 cache부터 제거될 수 있다. 서로 다른
branch와 source SHA의 큰 target cache가 같은 저장소 용량을 사용하므로 key를 정확히
구성해도 보존이 보장되지는 않는다. 개별 삭제 이력이 없으면 원인을 확정하지 않는다.

동일 SHA/workflow/플랫폼/검증 범위의 성공 run을 재실행하고 실제 restore key·bytes·hit,
compiler/image, 복원·컴파일·package lifecycle·post-save 및 job wall 시간을 따로 기록한다.
cache miss 재실행은 cold 결과로 분류한다. hit여도 필요한 workspace/feature 재컴파일이
남을 수 있으므로 시간을 실측한다. 부분 profile의 native job 비교를 전체 run 단축으로 확대하지 않는다.
재실행 전에 이전 attempt metadata를 보존하거나 API의 `attempts/{attempt}/jobs`를 사용한다.
보고서에는 attempt 번호와 해당 job URL을 고정해 다음 재실행이 과거 근거를 혼동시키지 않게 한다.

GitHub의 [reusable workflow 계약](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows)과 [cache 전략](https://github.com/actions/cache/blob/main/caching-strategies.md)을 따른다. 같은 저장소의 상대 workflow 호출은 caller commit의 정의를 사용하며 checkout source와 별도로 기록한다.
