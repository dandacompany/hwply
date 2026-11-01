# 코드와 자산 출처

이 문서는 Alhangeul이 독립 제품으로 소유하는 코드와 초기 출처를 구분한다. 과거 출처는 지속 upstream 관계를 뜻하지 않는다.

## HOP 기반 코드

- 초기 저장소: [`golbin/hop`](https://github.com/golbin/hop)
- 기준 commit: `bbd6bf69db05f275d714e7c61cef58b662809c6a`
- 적용 방식: 기준 commit의 Git 이력을 보존한 새 저장소에서 제품명, 지원 플랫폼과 배포 경계를 단계적으로 독립화
- upstream 정책: HOP remote를 fetch·merge·release source로 사용하지 않음

기준 commit 이후의 Alhangeul 제품 코드, issue, release와 운영 자동화는 `postmelee/alhangeul-tauri`가 독립적으로 소유한다. HOP의 이후 변경을 자동으로 가져오지 않는다.

## 제품 version 계보

HOP 기준 commit에 기록된 `0.3.1`은 HOP의 release 계보에 속한다. Alhangeul은 제품명, package·crate 이름, Tauri identifier와 release channel을 분리했고, 독립 저장소에는 이를 계승한 공식 release, tag나 updater가 없다. M010에서 독립 제품의 첫 source 기준선을 `0.1.0`으로 승인했다.

- Alhangeul 제품 SemVer 계보는 `0.1.0`부터 시작한다.
- HOP `0.1.x`–`0.3.1` 이력과 Task #5의 `0.3.1` native build smoke는 출처와 과거 검증 증적으로 보존하며 Alhangeul release로 재분류하지 않는다.
- root `package.json`을 source version의 기준으로 삼고 desktop package, Cargo manifest·lock과 Tauri 설정의 일치는 `pnpm run check:product-version`으로 검증한다.
- `0.1.0`의 공식 release와 tag 생성은 별도 작업과 승인이 필요한 배포 단계다.

## 지속 upstream

문서 engine과 renderer의 유일한 지속 upstream은 [`edwardkim/rhwp`](https://github.com/edwardkim/rhwp)다. 현재 고정 상태와 후속 Stable release pin 정책은 [UPSTREAM.md](UPSTREAM.md)에 기록한다.

## 라이선스

초기 코드의 MIT 라이선스와 copyright notice를 저장소의 `LICENSE`에 보존한다. Alhangeul의 변경도 같은 MIT 라이선스로 배포한다. `rhwp`와 bundled font 등 제3자 구성요소는 각 원본의 라이선스와 notice를 따른다.

## Alhangeul icon

- source 저장소: [`postmelee/alhangeul-macos`](https://github.com/postmelee/alhangeul-macos)
- source commit: `dcef80cae43195a3e353de084f7246614da924be`
- source 경로: `assets/logo-256@2x.png`
- 저장 경로: `assets/logo/logo-source.png`
- SHA-256: `cc8b326aa54bff659689222fca317b561c7984d86c479b61b534bf4fddec3cd5`

Windows/Linux PNG·ICO와 studio favicon은 이 source를 기계적으로 resize·변환한 산출물이다. 새로운 그림을 합성하거나 원본 디자인을 변경하지 않았다.

## 릴리즈 안내 형식 참조

Task #102는 같은 제품군 저장소의 GitHub 본문 제목 순서와 짧은 웹 안내 구조를 참고했다.
이는 제품 upstream 추가나 해당 플랫폼 코드·빌드·배포의 도입이 아니다.

- 참조 저장소: [postmelee/alhangeul-macos](https://github.com/postmelee/alhangeul-macos)
- main 고정 commit: `43b4e998b93032b62bcb0517fb9c894de3dc8ae1`; v0.2.2 tag resolved commit: `64ed89f881438efdbaec8bb33a6b52d66b83746d`.
- 본문 참고: [write-release-notes.sh](https://github.com/postmelee/alhangeul-macos/blob/43b4e998b93032b62bcb0517fb9c894de3dc8ae1/scripts/ci/write-release-notes.sh), [check-release-notes-template.sh](https://github.com/postmelee/alhangeul-macos/blob/43b4e998b93032b62bcb0517fb9c894de3dc8ae1/scripts/ci/check-release-notes-template.sh).
- 웹 참고: [v0.2.2 안내](https://github.com/postmelee/alhangeul-macos/blob/43b4e998b93032b62bcb0517fb9c894de3dc8ae1/docs/updates/v0.2.2.html), [updates.js](https://github.com/postmelee/alhangeul-macos/blob/43b4e998b93032b62bcb0517fb9c894de3dc8ae1/docs/updates.js).
- 적용: 주요 변경을 먼저 두는 본문 16개 heading, 앱/rhwp 변화·해결/참고 Issue 분리, 웹 5개 구역·실제 공개일·버전 고정 다운로드. 해당 저장소 전용 설치 subsection은 제외했다.
- 구현: 원본 Bash·웹 script·HTML/CSS의 코드를 직접 복사하지 않았다. 이 저장소의 기존 site 구조와 Node/Tauri 계약에 맞춰 `scripts/releases/`·중앙 템플릿을 작성했다. 최신 표시도 실제 공개 release data를 사용한다.
- 라이선스: [고정 원본 LICENSE](https://github.com/postmelee/alhangeul-macos/blob/43b4e998b93032b62bcb0517fb9c894de3dc8ae1/LICENSE)는 MIT, `Copyright (c) 2025-2026 Taegyu Lee`다. 이번 산출물은 형식 참조이며 원본 코드의 복사·substantial portion을 포함하지 않는다. 후속 직접 차용 시 원본 copyright와 MIT notice를 함께 보존한다.

Windows/Linux의 6개 설치 파일·3개 updater target·공식 기록 위치는 이 저장소가 소유한다.
실제 원문·생성·검사 절차는 [릴리즈 인덱스](../releases/README.md#작성과-생성-및-검사)를 따른다.

## 독립 remote 원칙

- 기본 remote는 `postmelee/alhangeul-tauri`만 제품 개발과 게시 대상으로 사용한다.
- HOP remote는 설정하지 않으며 역사 확인은 보존된 Git commit과 이 문서를 기준으로 한다.
- `rhwp` 갱신은 HOP가 아닌 `edwardkim/rhwp`의 명시적인 release와 resolved commit만 기준으로 한다.
- 출처 기록을 제품 다운로드, 업데이트 endpoint 또는 자동 동기화 계약으로 해석하지 않는다.
