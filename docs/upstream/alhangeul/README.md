# Alhangeul 문서

이 디렉터리는 Alhangeul의 개발, 아키텍처·운영 기준과 버전별 공개 기록을 둔다.

## 시작 위치

- 설치·사용: [사용자 README](../README.md), [다운로드](https://postmelee.github.io/alhangeul-tauri/), [설치 안내·업데이트](https://postmelee.github.io/alhangeul-tauri/updates/)
- 문의·참여: [문의·제보](https://postmelee.github.io/alhangeul-tauri/feedback/), [기여 안내](../CONTRIBUTING.md), [행동 강령](../CODE_OF_CONDUCT.md), [보안 정책](../SECURITY.md)
- 개발: [개발 안내](DEVELOPMENT.md), [upstream 경계](architecture/UPSTREAM.md)
- PR 검증·브랜치 보호: [devel 보호 정책](operations/BRANCH_PROTECTION.md)
- Action 의존성 갱신·고정: [Action 정책](operations/ACTION_DEPENDENCIES.md)
- native UI·Actions 테스트 작성/진단: [Native UI 테스트 가이드](operations/NATIVE_UI_TESTING.md)
- 릴리즈 준비: [정책](operations/DESKTOP_RELEASE.md) → [실행 가이드](operations/PUBLIC_RELEASE_RUNBOOK.md) → [최소 체크리스트](operations/RELEASE_CHECKLIST.md)
- 실제 공개 상태·근거: [릴리즈 기록 인덱스](releases/README.md), [v0.1.1 공개와 남은 검증](releases/v0.1.1.md)
- 다음 버전 기록 작성: [중앙 기록 템플릿](../mydocs/_templates/release_record.md), [본문·웹 생성과 검사](releases/README.md#작성과-생성-및-검사)
- 업데이트 동작·신뢰 경계: [updater 아키텍처](architecture/UPDATER.md)

현재 공개 버전과 설치 파일은 사용자 README·다운로드 페이지를, 실제 검증 범위는 버전별 기록의
최신 절을 우선한다. 개별 개발·아키텍처 문서의 과거 준비 상태가 현재 공개 상태를 뜻하지는 않는다.

## 구성

```text
docs/
  DEVELOPMENT.md             로컬 개발 환경과 주요 명령
  KEYBOARD_SHORTCUTS.md      Windows/Linux 키보드 단축키
  architecture/
    LOCAL_FONTS.md           로컬 폰트 해석과 라이선스 경계
    LINUX_THUMBNAILS.md      Linux 파일 관리자 thumbnail 처리와 package 경계
    PROVENANCE.md            초기 코드와 제품 자산 출처
    UPDATER.md               MSI/NSIS·AppImage updater와 서명 신뢰 경계
    UPSTREAM.md              upstream rhwp 경계와 고정 정책
    WINDOWS_THUMBNAILS.md    Windows Explorer thumbnail 처리와 등록 경계
  operations/
    DESKTOP_RELEASE.md       지원·서명·승인·검증·복구 정책
    NATIVE_UI_TESTING.md     대화상자 자동화의 작성·실패 축소·회귀 연결
    PUBLIC_RELEASE_RUNBOOK.md 입력·실행·중단·재개 순서
    RELEASE_CHECKLIST.md     변경 영향별 최소 검증 선택
  releases/
    README.md                준비/공개 상태 인덱스
    v0.1.0.md                첫 공개 준비·검증 근거·후속 인계
    v0.1.1.md                GitHub 공개·Pages/실제 upgrade 상태와 근거
    v0.1.1.notes.json        사용자 문구·metadata 생성 원문
```

## 작성 규칙

- 사용자·기여자에게 유효한 현재 상태만 기록한다.
- 기능 스펙은 `docs/specs/<topic>/`, 공통 아키텍처 결정은 `docs/architecture/`에 둔다.
- 빌드, 배포와 유지보수 절차는 `docs/operations/`에 둔다.
- 버전별 identity·검증·승인·공개 결과는 `docs/releases/v<version>.md`에 기록한다.
- 사용자 릴리즈 노트는 `docs/releases/v<version>.notes.json`에서 GitHub 전체 본문·`site/updates/v<version>.html`·짧은 updater 요약을 생성한다. 운영 근거는 버전 기록으로 구분한다.
- 작업 계획과 단계 보고서는 공식 문서가 아닌 `mydocs/`에 둔다.
- Alhangeul이 소유하는 동작은 `apps/desktop` 또는 `apps/studio-host`에 두며 `third_party/rhwp`를 제품 코드처럼 직접 수정하지 않는다.
- 아직 제공하지 않는 설치 파일, 릴리스와 자동 업데이트를 사용할 수 있다고 설명하지 않는다.
