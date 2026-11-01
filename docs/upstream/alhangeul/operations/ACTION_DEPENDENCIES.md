# GitHub Actions 의존성 고정 정책

외부 Action의 진실 원천은 [.github/action-pins.json](../../.github/action-pins.json)이다.
workflow와 repository-owned composite action은 같은 Action에 같은 full commit SHA를 사용하고
`# vX.Y.Z` 주석으로 승인 release를 표시한다. local `./.github/` action·workflow는 현재 source의
일부이므로 외부 SHA로 변환하지 않는다.

## 검토와 검사

```sh
pnpm install --frozen-lockfile
pnpm run check:action-pins
pnpm run test:automation
```

`test:automation`은 YAML 구조를 읽어 모든 workflow와 nested composite의 `uses`를 검사한다.
major tag·branch·축약 SHA·표현식·unknown SHA·잘못된 version 주석은 실패한다. quoted key와
flow 문법도 같은 검사 대상이다. 외부 reusable workflow를 추가하면 전체 경로를 inventory에
등록한다. 현재 Docker Action은 승인 inventory가 없으므로 digest 여부와 관계없이 거부한다.

inventory에는 Action 경로, release/ref, resolved commit, 공식 repository 출처와 위험 역할을
기록한다. artifact 생성/소비, cache, token 발급, Pages/OIDC 권한은 각 workflow가 계속 소유한다.
SHA 검사 성공은 Action 내용의 안전성이나 실제 Windows/Linux 실행 성공을 대신하지 않는다.

## 갱신 절차

1. 전용 Issue·계획에서 목적·대상 version·검증 범위를 확정한다. upstream 공식 release와
   `git/ref/tags/<tag>`를 조회하고 annotated tag를 commit까지 해제한다. repository의 commit이
   존재하는지 확인한다. fork 또는 major tag의 현재 값만으로 출처를 확정하지 않는다.
2. 변경 commit의 `action.yml`, runtime, inputs/outputs, permissions와 release notes를 읽는다.
   token Action은 발급 권한·repository 범위, artifact Action은 전달·digest·압축 계약도 확인한다.
3. inventory와 해당 Action의 모든 workflow/composite 참조·version 주석을 함께 바꾼다.
   기존 contract test의 입력·권한·job 목적을 보존한다. package parser 변경은 pnpm lock도 함께 검토한다.
4. 정적/회귀·actionlint 후 [CI 검증 계약](CI_VALIDATION.md)에 따른 영향 profile을 실행한다.
   전체 workflow 정렬은 Windows/Linux `full`을 사용한다. live signing·Release·Pages 배포는
   pin 갱신만으로 승인되지 않으며 별도 실행 지시를 따른다.
5. PR에서 exact source/run·upstream provenance와 실패·미실행 범위를 리뷰한 뒤 병합한다.
   자동 갱신이나 무승인 PR 병합을 추가하지 않는다.

## Rust stable 예외

`dtolnay/rust-toolchain`은 release tag가 없는 `stable` branch의 확인된 commit snapshot을
full SHA로 고정한다. 주석 `# stable`과 inventory의 `refs/heads/stable`은 출처 설명이며
workflow가 가변 branch를 실행한다는 뜻이 아니다. 고정된 Action의 `toolchain` 기본값은
`stable`이다. 설치 compiler는 기존 Rust stable 정책을 따르며 Action SHA 고정으로 compiler
version까지 고정됐다고 주장하지 않는다. snapshot 갱신도 위 검토·검증 절차를 따른다.

## 복구

실행 실패 시 run·exact SHA·입력·최초 실패 job을 기록하고 관련 Action의 이전 승인 SHA와
inventory·주석을 함께 되돌리는 새 PR을 만든다. upstream tag 이동, 강제 push나 권한 확대를
복구 수단으로 사용하지 않는다. 제품 bytes가 달라졌다면 과거 설치 근거를 재사용하지 않는다.

근거: [GitHub Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use#using-third-party-actions).
