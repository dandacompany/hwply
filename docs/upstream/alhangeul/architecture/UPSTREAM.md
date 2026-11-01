# upstream `rhwp` 경계

Alhangeul의 유일한 지속 upstream은 [`edwardkim/rhwp`](https://github.com/edwardkim/rhwp)다.

## 현재 고정 상태

- upstream URL: `https://github.com/edwardkim/rhwp.git`
- Stable release tag: `v0.8.7`
- resolved commit: `1a76570e833917d15817415a53c09ad61ab3203f`
- 읽기 전용 source submodule: `third_party/rhwp`
- 기계 검증 가능한 출처 lock: `rhwp-core.lock`
- bundled WASM: `apps/studio-host/vendor/rhwp-core`
- native Rust lockfile: `apps/desktop/src-tauri/Cargo.lock`, `crates/document-preview/Cargo.lock`,
  `apps/thumbnail-worker/Cargo.lock`, `apps/linux-thumbnailer/Cargo.lock`
- WASM 생성 도구: `wasm-pack 0.15.0`
- WASM 생성 profile: `wasm-pack build --target web --release`

`rhwp-core.lock`은 repository, ref kind, release tag, resolved commit, upstream `Cargo.lock` SHA-256, WASM 도구·profile과 관리 artifact의 경로·크기·SHA-256을 기록한다. 관리 artifact는 `package.json`, JavaScript·TypeScript binding, WASM binary와 type declaration, upstream `LICENSE`다.

## Stable pin 정책

의존성 갱신은 Stable `rhwp` release tag와 그 tag가 가리키는 resolved commit을 함께 입력해야 한다. 같은 release 기준으로 다음 경계를 원자적으로 맞춘다.

1. `third_party/rhwp` source submodule
2. desktop·document-preview·Windows worker·Linux thumbnailer의 네 native Cargo lock
3. 같은 source commit에서 새로 생성한 bundled WASM package
4. 위 출처와 artifact hash를 기록하는 `rhwp-core.lock`

branch, 이동 가능한 floating ref, tag 없이 전달된 commit은 Stable 갱신 입력으로 사용하지 않는다. preview 검증이 필요하면 Stable pin을 바꾸는 흐름과 분리된 별도 Issue에서 범위와 복구 기준을 먼저 정한다.

## 코드 소유권

`third_party/rhwp`는 vendor source로 취급하고 Alhangeul 기능을 구현하기 위해 직접 수정하지 않는다.

- `apps/desktop/`: Tauri shell, native document session, 저장·내보내기, 필요한 인쇄 창 host, 창 관리, 파일 연결과 packaging
- `apps/studio-host/`: exact upstream Studio entry를 쓰는 Vite host, Tauri bridge와 desktop event·command·font leaf adapter, 최소 제품 UX 보정
- `assets/`, `docs/`, `scripts/`: 제품 자산, 공식 문서와 운영 자동화

studio host의 실제 Vite root와 entry는 각각 `third_party/rhwp/rhwp-studio`, 그 아래 `index.html`과 `src/main.ts`다. local `index.html`, `src/main.ts`, Toolbar, CanvasView, Ruler, renderer와 범용 dialog·style 복제본은 허용하지 않는다. 제품 title·접근성 label·새 창·로컬 글꼴 설정 항목·제품 style/icon을 최소 HTML/entry transform으로 보충하고, upstream import를 대체하는 alias는 native host·font policy·제품 정보에 필요한 12개 leaf adapter로 제한한다.

`apps/studio-host/alhangeul-overrides.ts`가 adapter owner와 disposition의 진실 원천이다. `apps/studio-host/src/core/upstream-boundary.test.ts`는 12개 alias, `legacy-upstream-copy` 0개, 금지 entry와 제거된 shadow의 물리적 부재, adapter 300 LOC 상한을 검사한다. `tests/rhwp-baseline.test.mjs`는 exact entry, upstream 메뉴 command와 HWPX/PDF 실행 경계를 함께 고정한다. engine API나 renderer bug는 먼저 upstream에서 해결하고, 데스크톱 통합 차이는 이 경계 안의 leaf adapter에 둔다.

`apps/studio-host/local-font-overrides.ts`는 위 alias를 우회하는 상대 import 다섯 곳을 같은
`core/local-fonts` adapter로 연결한다. 대상은 pinned Studio의 `core/document-font-status.ts`,
`core/font-substitution.ts`, `core/host-font-requests.ts`, `core/host-canvas-fonts.ts`,
`core/wasm-bridge.ts`가 읽는 `./local-fonts.ts` 또는 `./local-fonts`뿐이다. Vite와 Vitest는
동일 resolver를 사용하며 12개 alias 목록, upstream source와 renderer는 유지한다.
실제 상태 분석·표시 글꼴 체인과 새 renderer 공급 회귀 및 dev/build module 검증으로 별도
upstream 글꼴 캐시가 섞이지 않는지 확인한다. 이 연결의 성공은 사용 선택의 영속 저장이나
모든 renderer의 글꼴 적용 성공을 뜻하지 않는다.

`apps/studio-host/product-shell-entry.ts`는 exact main의 title import와 `initI18n()` 호출만
연결한다. `ui/product-shell.ts`는 Tauri에서 기존 DesktopHost의 session·dirty title 소유권을
유지하고 browser에서는 파일명·display-mode 변경을 Alhangeul 제목에 반영한다. upstream
초기화 결과 뒤 접근성 h1을 ko/en 제품 문구로 정렬하며 번역 catalog나 renderer를 복제하지 않는다.
단일 marker·label이 누락/중복되면 거부한다. 정적 HTML title/label도 첫 표시를 위해 유지한다.

`apps/studio-host/local-font-entry-hooks.ts`는 exact `main.ts`의 `initializeDocument`와
`promptLocalFontsIfNeeded` 시작점만 연결한다. 전자는 native 사용 선택 복원과 catalog 준비를
문서 초기화보다 먼저 수행하고, 후자는 Tauri에서 제품 설정 안내를 처리해 upstream의 고정
저장 성공 문구를 실행하지 않는다. 일반 browser는 upstream 안내를 유지한다. 두 함수 서명과
설정 메뉴 marker는 단일 일치를 요구하며 변경되면 build를 실패시킨다. upstream 파일은 수정하지 않는다.

`apps/studio-host/desktop-startup-entry.ts`는 현재 pinned Studio의 `openBlankDocumentIfIdle` 시작점에서
Tauri의 자동 빈 문서 생성만 생략한다. Alhangeul은 기존 idle 화면에서 시작하며
`파일 → 새로 만들기`가 Rust native 세션을 먼저 만든다. browser의 자동 생성은 보존한다.
이 경계 없이 upstream이 직접 만든 WASM 문서는 native 저장 세션이 없어 저장할 수 없다.
함수 marker의 단일 일치를 요구하며 일반 문서 생성·renderer는 수정하지 않는다.

사용 선택은 native 앱 데이터의 version 1 설정에만 저장한다. 창은 revision 이벤트와
문서 진입·focus snapshot으로 상태를 맞추며 저장 실패는 해당 창의 임시 선택으로 안내한다.
`stored`/`native-preference`는 사용 선택이 저장되었다는 뜻이며 글꼴 목록·bytes 저장이나
화면 적용의 증거가 아니다. 제품 설정 화면은 upstream `ModalDialog`를 상속하고, 변경 시
기존 renderer session 무효화·CanvasView 재준비 callback을 사용한다. 재준비가 끝난 뒤
현재 CanvasKit renderer에 필요한 로컬 글꼴을 다시 공급하고 완료 후 보기만 갱신한다.
문서 generation과 view/session/renderer·decisionKey가 바뀐 경우 오래된 작업은 화면을
갱신하지 않는다. 문서의 dirty와 원본 글꼴 데이터는 변경하지 않으며 실제 renderer별
공급·표시 수용은 별도로 검증한다.

제품 font provider는 자신이 등록한 FontFace와 bytes·실패 cache를 세대별로 회수한다.
문서 전환에서는 필요한 bytes를 다시 확인하고, 재감지·미사용 전환에서는 기존 공개
`RendererSession.invalidateDocument()`가 CanvasKit의 `resetDocumentResources()`를
호출하게 한다. private renderer map이나 추가 renderer transform은 사용하지 않는다.
자세한 선택·공급 한계와 실제 수용 범위는 [LOCAL_FONTS.md](LOCAL_FONTS.md)를 따른다.

## Windows thumbnail parse·render 경계

Windows Explorer thumbnail은 현재 Stable pin의 native `rhwp`를 사용하지만 COM DLL에 engine을 직접 link하지 않는다.

- `crates/document-preview`는 bytes-only 첫 페이지 render, embedded preview 검증, raster와 공통 resource/protocol bounds를 소유한다.
- `apps/desktop`은 같은 crate의 direct SVG adapter를 사용해 기존 document preview command를 유지한다.
- `apps/thumbnail-worker`는 crate의 render feature와 native `rhwp`를 사용해 별도 process에서 first-page BGRA를 만든다.
- `apps/thumbnail-handler`는 render feature 없이 protocol과 bounds만 사용하며 Shell COM, process 격리와 `HBITMAP` 반환만 소유한다.

Stable pin 갱신은 desktop preview와 worker render를 함께 바꾸므로 새 exact SHA에서 Windows native test, thumbnail binary·artifact inventory, installer 등록·rollback과 Explorer UI 수용을 반복한다. process와 installer의 전체 계약은 [WINDOWS_THUMBNAILS.md](WINDOWS_THUMBNAILS.md)를 따른다.

## Linux thumbnail parse·render 경계

Linux 파일 관리자 thumbnail도 같은 Stable pin과 `crates/document-preview`를 사용하지만 Tauri 앱이나 Windows worker를 호출하지 않는다.

- `apps/linux-thumbnailer`의 public process는 Freedesktop `%i %o %s` CLI, Linux child supervision, deadline, `RLIMIT_AS`와 PNG 게시만 소유한다.
- 같은 ELF의 private worker는 `document-preview`와 native `rhwp`로 첫 페이지를 직접 render하고 실패할 때만 제한된 embedded preview를 사용한다.
- `apps/desktop/src-tauri/linux/alhangeul.thumbnailer`와 DEB/RPM custom files가 절대 helper 경로와 HWP/HWPX MIME registration을 연결한다.
- persistent cache, cache invalidation과 icon fallback은 Nautilus·Thunar/Tumbler가 소유한다.

Stable pin 갱신은 Linux helper의 direct render도 바꾸므로 새 exact SHA에서 x64·arm64 helper test/Clippy/build, DEB/RPM package lifecycle과 x64 Nautilus·Thunar의 공개 실사용 HWP/HWPX 첫 페이지를 다시 수용한다. 전체 CLI, resource, PNG, package와 cache 계약은 [LINUX_THUMBNAILS.md](LINUX_THUMBNAILS.md)를 따른다.

## 문서 저장, PDF와 실제 인쇄 경계

upstream embed runtime을 상속하는 local leaf wrapper는 active registration과 `waitForDesktopStudioHandlers()` 비동기 acquisition을 통해 `loadFile`, `pageCount`, `getPageSvg`, `exportHwp`, `exportHwpx`, `notifySaved`만 native host에 노출한다. registration 교체·종료는 자신이 소유한 미완료 waiter와 timer를 함께 회수하고 stale cleanup이 최신 handler를 제거하지 못하게 한다. Studio WebView의 Windows/Linux 판정은 navigator를 읽는 `detectDesktopPlatform()` leaf adapter가 소유하며 native IPC나 override cache를 두지 않는다. HWP/HWPX source save는 현재 형식에 맞는 exporter bytes를 chunk staging하고 Rust에서 요청 형식·확장자·parser 결과가 일치한 뒤 원자적으로 교체한다. native commit 성공 뒤에만 `notifySaved`로 upstream dirty/recovery 상태를 정리한다.

PDF command는 upstream `file:print-to-pdf` 메뉴 위치와 활성 규칙을 유지하되 실행만 Alhangeul이 소유한다. save target을 확정한 뒤 active handler의 현재 HWP/HWPX exporter를 한 번 호출하고 별도 product `WasmBridge`에 다시 로드한 immutable snapshot의 page count와 SVG만 native PDF job에 전달한다. live `pageCount`·`getPageSvg`를 직접 읽거나 native session revision을 snapshot token으로 재사용하지 않으며, snapshot UUID를 begin·append·commit·abort 전체에 결속한다. capture 2분, 전체 pipeline 10분과 native page·byte·job·TTL 제한을 넘기면 fail-closed로 회수하고 startup에서는 안전성이 확인된 오래된 product temp만 제한적으로 정리한다. PDF 성공·실패·취소는 source path·format·revision·dirty·recent와 upstream recovery draft를 바꾸지 않고 `notifySaved`를 호출하지 않는다.

실제 인쇄 `file:print`의 페이지 pagination, 모든 페이지의 `profile=print` SVG, print stylesheet와 page DOM primitive는 upstream이 소유한다. 일반 browser는 upstream execute와 visible `print.html` preview를 그대로 사용한다. Tauri에서는 local leaf adapter가 upstream `createPrintSurface`, `createPrintPage`, `buildPrintStyleText`, `appendSvgPage`, `waitForPrintSurfaceReady`를 조합해 hidden same-origin surface를 만들고 그 surface의 `window.print()`를 호출하여 별도 Alhangeul preview 없이 system print dialog로 진입한다. Tauri asset CSP의 nonce를 유지하기 위해 정적 `print.html` style element의 내용만 교체하며, 이 element가 누락되면 CSP에서 차단되는 동적 style로 fallback하지 않고 인쇄 준비를 실패시킨다. Linux WebKitGTK의 default page context와 1px tolerance는 모든 쪽의 물리 크기가 같은 문서에만 적용하고, 혼합 크기 문서는 upstream stylesheet를 그대로 유지한다. `frame-ancestors 'self'`는 외부 origin이 아닌 동일 bundle iframe만 허용한다. local 책임은 Tauri command 분기, 명시적 출력 전 pagination flush, 진행 상태와 surface lifecycle로 제한한다. editor Studio WebView 전체를 직접 인쇄하거나 Rust `WebviewWindow::print`, direct PDF pipeline을 실제 인쇄 대신 사용하는 것은 허용하지 않는다.

## 갱신 자동화 경계

`scripts/update-upstream.sh`는 승인된 의존성 갱신 작업에서만 실행한다. 입력은 Stable tag와 resolved commit이며, 둘이 같은 commit을 가리키는지 fetch 후 검증한다.

현재 pin을 재현하는 명령은 다음과 같다.

```sh
scripts/update-upstream.sh \
  --tag v0.8.7 \
  --commit 1a76570e833917d15817415a53c09ad61ab3203f \
  --run-checks
```

script는 dirty upstream source와 origin 불일치를 먼저 거부하고, source checkout → native Cargo lock 갱신 → 임시 경로의 fresh WASM build → managed artifact 동기화 → `rhwp-core.lock` 작성 → read-only 검증 순서로 처리한다. lock writer는 갱신 흐름에서만 사용하고 `pnpm run check:rhwp-pin`의 verifier는 파일을 수정하지 않는다.

실패 시 자동 reset을 하지 않으며 시작 commit과 실패 단계를 출력한다. 운영자는 `git status --short`와 `git diff --submodule=log`로 범위를 확인한 뒤 [DEVELOPMENT.md](../DEVELOPMENT.md)의 명시적 경로 rollback 절차를 사용한다.

### Stable 감시와 candidate PR 경계

`.github/workflows/rhwp-upstream-sync.yml`은 공개 GitHub Release metadata와 Git tag를 함께 확인한다. target을 명시하지 않으면 release 목록 순서가 아니라 exact `vX.Y.Z` 형식이고 `draft=false`, `prerelease=false`인 공개 release의 semver 최댓값을 Stable 후보로 선택한다. annotated tag는 peeled commit을, lightweight tag는 tag commit을 resolved commit으로 사용한다. 현재 `rhwp-core.lock`, gitlink, submodule HEAD와 exact Studio entry가 서로 다르거나 이미 고정한 tag가 다른 commit을 가리키면 후보를 만들지 않는다. 자동 선택한 최대 Stable이 current pin보다 낮으면 `upstream_behind_current` 정상 no-op으로 기록하지만, 사람이 명시한 낮은 target은 거부한다.

판정 job은 read-only token으로 `current`, `upstream_behind_current`, `dry_run`, `existing_pr`, `candidate_blocker`, `branch_blocker`, `create_candidate`를 구분한다. `current`, `upstream_behind_current`, `dry_run`, 동일 tag의 기존 PR과 다른 tag의 candidate blocker는 repository를 쓰지 않고 끝난다. 열린 자동 candidate는 base branch별로 하나만 유지하며 다른 tag candidate가 있으면 먼저 수용·종료한 뒤 새 후보를 만든다. PR 없는 automation branch는 사람이 만든 상태일 수 있으므로 삭제·reset·force push하지 않는다. writer 비활성 중에는 summary 경고로 남기고, writer 활성 중에만 blocker로 실패한다.

base branch는 workflow top-level `BASE_BRANCH`가 단일 진실 원천이다. 검증된 값을 release helper의 candidate 조회·구조화 출력, checkout, candidate 본문과 `gh pr create` 모두에 전달한다.

candidate는 clean `devel` checkout에서 다음 순서를 지킨다.

1. frozen pnpm 의존성과 clean-base automation contract를 확인한다.
2. 허용된 current-pin 관리 참조를 새 pin으로 맞춘다. Windows·Linux thumbnail fixture 정의의
   `rhwpSha`·`RHWP_SHA`도 포함하며 fixture hash·size와 preview 기대값은 보존한다.
3. `scripts/update-upstream.sh`로 source, 네 native Cargo lock, fresh WASM과 provenance를 갱신한다.
4. 플랫폼 중립 gate, Ubuntu desktop Rust test·Clippy preflight와 changed-path allowlist를 검증한다.
5. 현재 repository에 한정된 GitHub App token을 발급하고, `scripts/rhwp-sync-publisher.sh commit`이
   explicit allowlist만 stage해 local candidate commit을 만든다.
6. commit 이후 `check:committed-rhwp`와 `test:automation`으로 target pin·HEAD·index·submodule과
   fixture 참조 정합성을 확인한다. 실패하면 push와 PR 게시를 실행하지 않는다.
7. `scripts/rhwp-sync-publisher.sh publish`가 remote branch 부재를 다시 확인하고 non-force push와
   `devel` 대상 draft PR 생성을 수행한다.

token은 `contents: write`와 `pull-requests: write`만 요청하며 auto approval·merge, release/tag, issue close, package publish와 Pages deploy에는 사용하지 않는다. 후보 본문은 old/new tag·commit, Stable release URL, 변경 경로와 자동 검증을 기록한다.

자동 candidate는 Ubuntu에서 새 pin의 desktop Rust test와 Clippy를 통과한 갱신 제안일 뿐 native 수용 결과가 아니다. Windows native와 Linux Tauri build, GUI와 packaging은 target release를 명시한 별도 Hyper-Waterfall Issue에서 검토하고 candidate 본문은 이 검증이 미실행임을 유지한다. 최초 `v0.8.4` candidate의 수용은 [Issue #24](https://github.com/postmelee/alhangeul-tauri/issues/24)에서 수행하며, 자동화는 특정 수용 Issue를 PR 본문에 하드코딩하거나 자동 종료·merge하지 않는다.

known issue 기록은 current pin 참조가 아니다. 자동 관리 참조 갱신은 승인된 marker와 경로만 바꾸고, 특정 release의 known issue 이름·원인·추적 링크를 새 release 정보로 치환하지 않는다. 새 release에서 같은 실패가 보여도 아래 분류 기준에 따라 재현 조건과 실패 지점을 다시 확인한다.

workflow를 default branch에 merge하면 read-only daily 판정은 시작되지만 candidate writer는 `ALHANGEUL_UPSTREAM_SYNC_ENABLED`가 정확히 `true`일 때만 활성화된다. task PR merge 뒤 GitHub App installation과 credential을 별도 승인으로 준비하고 활성화 variable을 마지막으로 켠다. 명시 tag의 실제 dispatch와 동일 입력 재실행으로 candidate·멱등성을 확인한 뒤에만 Task #23 close gate를 통과한다. 운영 입력과 복구 절차는 [DEVELOPMENT.md](../DEVELOPMENT.md)를 따른다.

## 플랫폼 중립 수용 기준

- tag와 resolved commit 출처가 기록되어 있다.
- source submodule, native Cargo lock, bundled WASM과 `rhwp-core.lock`이 같은 `rhwp` release를 가리킨다.
- `pnpm install --frozen-lockfile`이 통과한다.
- `pnpm run check:product-boundary`, `pnpm run check:product-version`, `pnpm run check:rhwp-pin`, `pnpm run check:release-metadata`가 통과한다.
- `pnpm run test:automation`이 통과한다.
- `pnpm run test:upstream`, `pnpm run test:studio`, `pnpm run build:studio`가 통과한다.
- candidate Ubuntu runner에서 `pnpm run test:desktop`, `pnpm run clippy:desktop`이 통과한다.

Windows native와 Linux Tauri build·GUI·packaging은 승인된 후속 플랫폼 작업에서 검증한다. Ubuntu Rust preflight와 플랫폼 중립 수용 결과만으로 native 배포 준비가 완료되었다고 판단하지 않는다.

## `v0.8.6` 설치본 수용 범위

Task #76에서 writer를 활성화하고 실제 후보 생성·반복 입력의 멱등성을 검증했다.
제품 `02388f59e88efbf37514894a28a69466bcde9a8b`의 Windows x64·Linux x64/arm64
full CI와 동일 DEB의 Linux x64 전체 GUI·로컬 글꼴 검증을 완료했다.
Windows 최종 사용자 점검은 아직 대기이며 NSIS hosted thumbnail과 MSI 재부팅 후 확인의
원시 제한을 유지한다. 후보 자동 merge와 공개 release는 수행하지 않는다.
실행·artifact·hash·한계는 [Task #76 보고서](../../mydocs/report/task_m010_76_report.md),
사용자 점검은 [Windows 안내](../operations/WINDOWS_FONT_ACCEPTANCE.md)를 따른다.

## `v0.8.4` native 수용 기준선

Task #24는 `v0.8.4` / `496333b27d21ddb9114ba9ae340bcb895870c9a7`의 source,
native Cargo lock, bundled WASM과 전체 Studio bundle을 exact Alhangeul commit
`88baa5666ec55bf043844bae01ec4d422278851c`에서 함께 검증했다. 플랫폼 중립 CI와
Windows x64·Linux x64·Linux arm64 native build, inventory, Windows installer smoke는
같은 SHA에서 성공했다. Windows x64와 Linux x64에서는 대표 HWP/HWPX의 열기·저장·재열기,
searchable PDF 직접 저장, system print dialog와 전체 페이지 출력까지 수동 수용했다.

이 결과는 Alhangeul에서 당시 고정한 upstream release와 leaf adapter 경계의 native 수용
기준선이다. Linux arm64는 hosted runner의 DEB build·inventory까지만 확인했고 실제 arm64
GUI를 실행하지 않았다. GitHub Release, tag, 서명, package 게시, 고정 다운로드 URL과
updater는 이 기준선에 포함되지 않는다. 상세 run, artifact와 플랫폼별 제한은
[DESKTOP_RELEASE.md](../operations/DESKTOP_RELEASE.md)의 Task #24 절을 따른다.

## `v0.8.2` known issue 분류

upstream `v0.8.2` changelog에는 다음 두 Studio E2E 실패가 known issue로 기록되어 있다.

- `print-pdf-issue3126`: PDF 안내 modal assertion 실패. 인쇄 surface 자체는 수동 확인되었으나 원인은 아직 확정되지 않았다. upstream #3450에서 추적한다.
- `issue-2214`: 페이지 로컬 repaint 계약 실패가 `v0.8.1`부터 이어진다. 회귀 여부는 확정되지 않았으며 upstream #3412에서 추적한다.

known issue는 성공으로 간주하는 예외 목록이 아니다. pinned source commit에서 같은 upstream E2E와 같은 재현 조건·실패 지점이 확인될 때만 upstream known issue로 분류한다. Alhangeul adapter test/build에서만 발생하거나 실패 지점이 달라진 경우에는 Alhangeul 회귀 후보로 두고 원인을 조사한다. 이 작업에서는 upstream source를 backport하거나 두 known issue를 임의로 보정하지 않는다.
