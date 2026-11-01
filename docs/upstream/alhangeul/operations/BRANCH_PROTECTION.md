# devel 보호와 PR 수용

공개 기본 브랜치는 `main`, 일반 기여·upstream 후보·Pages 운영은 `devel`이다.
이 정책의 실제 보호 대상은 `devel`이며 main 승격·Release/Pages 공개 승인은 별도다.
설정 payload의 진실 원천은 [.github/protection/devel.json](../../.github/protection/devel.json),
자동 검증은 [pr-acceptance.yml](../../.github/workflows/pr-acceptance.yml)이다.

## 필수 수용 경로

- devel 변경은 PR을 사용한다. 관리자에게도 적용하며 force push와 삭제를 허용하지 않는다.
- 필수 check는 **Alhangeul PR required**, 발급 App은 GitHub Actions(`app_id=15368`)다.
  최신 base를 요구한다(`strict=true`). 다른 App의 같은 이름이나 수동 status로 대체하지 않는다.
- PR opened/synchronize/reopened/ready_for_review/converted_to_draft에서 자동 실행한다.
  draft도 검사한다. 경로별 skip이 없으며 fork에는 `contents:read`만 제공한다.
  draft 상태는 `isDraft`를 함께 확인한다. 검사 성공 후 `mergeStateStatus=CLEAN`과
  `isDraft=true`를 관측할 수 있으며, 병합 단계에는 ready 전환이 필요하다.
  [GitHub draft 정책](https://docs.github.com/en/pull-requests/reference/pull-requests#draft-pull-requests)을 따른다.
- `github.sha`의 merge candidate에서 기존 Linux Node/Studio·Windows PowerShell fast 검사를
  수행한다. 최종 check는 `always()`로 실행하고 두 job을 포함한 reusable 결과가 `success`일
  때만 성공한다. 누락·실패·취소·skipped는 merge gate 성공으로 처리하지 않는다.
- 개인 저장소의 단일 maintainer 운영에 맞춰 GitHub 필수 승인 수는 0이다. PR과 checks는
  필수이고 작업지시자의 리뷰/병합 승인·실제 코드 리뷰 기록은 계속 남긴다. 자기 PR에 GitHub
  APPROVED review를 제출할 수 없으므로 COMMENT와 실제 검증을 남긴다. 2인 승인을 보장하지 않는다.
- review conversation을 해결하고 승인된 변경 영향 검증을 완료한 뒤 일반 merge commit으로
  병합한다. `--admin`, force push, bot 자동 승인/merge는 정상 수용 경로가 아니다.

PR fast 성공은 native/package/GUI/updater/공개 릴리즈 성공이 아니다. 추가 검증은
[CI 선택 계약](CI_VALIDATION.md)의 profile와 task 계획을 따른다.

## committed rhwp 기본 검사

```sh
pnpm run check:committed-rhwp
pnpm run test:automation
```

lock의 tag/commit, HEAD에 기록한 lock·gitlink, Git index gitlink, submodule HEAD와 실제 Studio
entry를 대조한다. lock·submodule만 앞선 상태와 index까지 앞섰지만 HEAD가 이전인 상태를
거부한다. 지원 Windows/Linux의 `pnpm test`에도 이 검사와 automation을 포함한다.

이 strict 검사는 committed source의 PR/local 수용 경계다. upstream sync의 post-update 또는
pre-commit `test:upstream`에 넣지 않는다. 해당 시점에는 superproject HEAD/index가 이전 pin인
것이 정상이다. App은 최소 contents/pull_requests 권한으로 feature branch와 draft PR을 만들고,
기본 GitHub token만으로 자동 approve/merge하지 않는다. App token으로 만든 PR은 일반 PR
event 검사를 받고 draft 상태에서는 병합할 수 없다.

## 최초 적용과 확인

1. 현재 보호와 repository capability를 읽고 기존 payload를 안전한 작업 파일에 보존한다.
2. PR에서 자동 check의 실제 이름·App·merge candidate SHA와 성공을 확인한다. 이름만 정하고
   아직 실행하지 않은 check를 required로 등록하지 않는다.
3. task의 구체 payload·실행 승인 기록과 함께 보호 API를 적용한다.

   필수 검사는 App을 지정한 `checks`만 보낸다. legacy `contexts`를 함께 보내면 API
   스키마에서 거부될 수 있다. GET 응답의 정규화된 `contexts`와 생략된 null 필드는 정책
   의미로 대조하고, App/context·strict·관리자·force/delete 필드는 실제 값으로 확인한다.

```sh
gh api --method PUT repos/postmelee/alhangeul-tauri/branches/devel/protection \
  --input .github/protection/devel.json
gh api repos/postmelee/alhangeul-tauri/branches/devel/protection
```

4. read-back에서 PR 요구·App/context·strict/admin·force/delete·review 정책이 payload와 같은지
   대조한다. pending/실패 check의 PR이 `BLOCKED`이고 수정 후 필수 check가 성공하는지 확인한다.
   검증용 실패 fixture는 devel에 병합하지 않고 임시 PR·branch를 정리한다.
5. 사용자 승인·code review와 실제 check 성공 뒤 normal merge를 수행한다. 신규 bot token
   발급이나 다음 scheduled upstream run은 별도 실제 실행 근거 없이 완료로 주장하지 않는다.

## 비상 복구

check 실패는 먼저 exact SHA·run·첫 실패를 조사해 source/workflow PR로 고친다. 정상 PR이
차단되었다고 보호부터 끄지 않는다. 설정 변경이 필요한 경우 owner에게 사유·최소 변경·기간·
복원 payload를 제시해 명시 승인받는다. 보존한 직전 payload와 현재 read-back을 비교하고
승인한 필드만 바꾼 뒤 복구 종료 시 원래 정책을 복원·재조회한다. 영구 bypass·상시 admin
예외·tag 이동·강제 history rewrite를 추가하지 않는다.

첫 적용 전 보호가 없었던 경우 승인된 rollback은 해당 branch protection DELETE다.
DELETE는 보호 전체를 제거하므로 실제 실행 전에 별도 승인을 받아야 한다. 정책 문서가
실행 승인을 제공하지 않는다. main의 required check는 workflow 정의를 main에 승격하고
실제 PR 결과를 확인하는 별도 작업 없이 설정하지 않는다.

근거: [GitHub branch protection REST](https://docs.github.com/en/rest/branches/branch-protection),
[protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).
