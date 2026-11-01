# Native UI 자동화 작성·진단 가이드

Windows/Linux의 대화상자·메시지·버튼 조작을 포함하는 테스트나 Actions를 만들거나
고칠 때 먼저 읽는다. 목표는 모든 OS 변형을 미리 지원하는 것이 아니라, 알려진 가정을
검사하고 새 실패를 작은 재현으로 축소하는 것이다. 제품 지원 범위와 릴리즈 승인 기준은
[개발 안내](../DEVELOPMENT.md)와 [릴리즈 체크리스트](RELEASE_CHECKLIST.md)를 따른다.

## 먼저 확인할 것

- [ ] 기존 helper·판정 함수·[사건 기록](../../mydocs/troubleshootings/task_m010_19_windows_pdf_automation.md)의 지원/미해결 상태를 읽었다.
- [ ] 제품 실패, 자동화 실패, 환경/설치 실패, 증거 누락을 구분할 관측 지점을 정했다.
- [ ] 대상 OS·runner image·아키텍처·언어·WebView/driver 버전과 제품/harness SHA를 기록한다.
- [ ] 열기·새 파일 저장·기존 파일 덮어쓰기·취소·예상 밖 확인창을 구분했다.
- [ ] 알려진 미지원 경로가 있으면 전체 성공을 기대하는 실행 전에 해당 경로부터 다룬다.
- [ ] 변경 영향에 맞는 가장 작은 검증과 이후 전체 검증의 진입 조건을 계획에서 승인받았다.

원격 실행은 관측할 가설, 예상 결과, 실패 시 남길 증거를 적은 뒤 수행한다. 하나를
고칠 때마다 제품을 다시 빌드하거나 전체 suite를 반복하는 것을 기본 절차로 삼지 않는다.

## 검증 계층과 보장 범위

| 계층 | 확인하는 것 | 대신할 수 없는 것 |
|---|---|---|
| 구문·타입·정적 계약 | 구문/타입 오류, 필수 guard·workflow 권한의 누락 | 실제 대상 선택·메시지 전달·클릭 |
| 순수 판단 함수의 동작 테스트 | 입력 구조에 따른 선택·거부·성공 판정 | OS가 그 구조를 실제로 노출하는지 |
| 대상 OS의 작은 통합 검증 | 실제 포커스·입력·선택·확인창·종료 후 상태 | 전체 문서/PDF 품질 |
| 기존 설치본의 end-to-end | 문서 identity·편집·저장·원본 보존·재실행 | 미실행 OS/IME/인쇄 환경, 모든 OS 변형 |

문자열을 찾는 `assert.match(source, ...)`는 정적 계약이다. PowerShell 코드를 실행한
것으로 세지 않는다. 정적 분석기는 별도 도구이며, 현재 Node 계약 suite에 포함된 것으로
설명하지 않는다. [PSScriptAnalyzer](https://learn.microsoft.com/en-us/powershell/utility-modules/psscriptanalyzer/overview?view=ps-modules)
역시 코드 규칙 검사이지 Windows UI 동작의 증명은 아니다.

## 선택·실행·결과 판정을 분리한다

### 선택: 모호하면 클릭하지 않는다

- 앱 process와 대상 dialog/container 범위를 먼저 확정한다. 재조회 때 다른 창으로 바뀌지 않았는지 확인한다.
- ID 하나가 아니라 부모/소유 관계, 컨트롤 class·역할, 사용 가능 상태를 함께 본다.
- 후보 없음·중복·사라진 요소를 명시적으로 처리한다. 첫 번째 후보를 임의로 선택하지 않는다.
- UI tree의 한 숫자 ID나 class는 **관측 환경의 adapter 조건**이다. 모든 OS에서의 영구 계약이 아니다.
- Windows `AutomationId`는 전체 트리에서 유일하지 않으므로 container와 탐색 범위가 필요하다.
  [Microsoft 설명](https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/use-the-automationid-property)
- 표시된 ControlType만 보고 지원 메서드를 가정하지 않는다. 실제 pattern/capability를 확인한다.
  지원 pattern은 상태에 따라 바뀔 수 있다. [Control Patterns](https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/ui-automation-control-patterns-overview)
- UIA `ClassName`과 native `GetClassName(HWND)`는 따로 관측한다. UIA class는 provider가
  제공하는 값이므로 native class와 같다고 가정해 검사 조건으로 옮기지 않는다.
  [ClassName 계약](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-automation-element-propids)
- UIA command 이름의 숫자를 native control ID로 옮기지 않는다. 실제 제품에서는
  `CommandButton_6/7` 양쪽의 `GetDlgCtrlID` 조회가 0을 반환했다. 0은 실패 반환값이기도 하므로
  오류 정보 없이 유효 ID로 확정하지 않으며, 고유 버튼 선택의 근거로 쓰지 않는다.
  [GetDlgCtrlID 계약](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getdlgctrlid)

### 실행: 안전한 경계 안에서만 조작한다

- 입력 전 focus, 입력 뒤 readback을 확인하되, readback만으로 앱이 변경을 받아들였다고 판정하지 않는다.
- OS 호출 전 process·창/자식 관계·class/ID·enabled를 확인하고 대기 시간을 제한한다.
- 메시지 전송 성공, UIA 호출 성공, 대화상자 닫힘은 각각 중간 관측이다.
- 반환값의 의미는 API별로 확인한다. 전송 성공과 control의 처리 결과를 같은 것으로 취급하지 않는다.
- 동기 호출이 후속 modal에 막히는지, 비동기 호출 후 무엇을 기다려야 하는지 구분한다.
- 좌표·전역 키 입력·무조건 Enter/Yes를 실패 우회용으로 추가하지 않는다.
- 여러 guard를 묶어 검사할 때도 실패한 조건은 식별 가능해야 한다. PID 일치·자식/owner 관계·
  활성 상태·class 일치 여부를 구분하며 임의 예외 메시지나 개인 경로를 진단에 노출하지 않는다.
- 보조 screenshot/tree 수집 실패와 필수 identity·의미 판정 실패를 구분한다. 진단 중 UI 요소가
  사라졌다면 수집 불능을 명시하며, 이를 사용자 작업의 성공이나 잘못된 target 승인으로 바꾸지 않는다.
  desktop 전체 하위 tree 열거 대신 확인된 앱/dialog 범위를 사용한다. `FindAll`의 상위 window
  검색에는 Children 범위가 권고된다. [탐색 범위 계약](https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.automationelement.findall)
- [보조 tree 수집기](../../scripts/windows-pdf-tree-diagnostics.ps1)는 기본 비활성이다. 일반 PDF/Open과
  확인/거절 실행 검증에서는 callback을 호출하지 않고 `disabled`/`diagnostic-mode-only`와 빈 tree를
  기록한다. 기존 `ConfirmationProbe` 관측 전용 모드에서만 이미 확인한 dialog root 안의
  최대 100개 노드를 순회한다. typed `ElementNotAvailableException`만 최대 8단계의
  InnerException에서 식별하여 `treeDiagnostic.status=unavailable`과 고정 reason을 기록하고
  부분 노드는 버린다. 문구 비교/catch-all/클릭 재시도는 하지 않는다. 필수 dialog 탐색과
  의미/대상/owner/identity 판정은 수집기 밖에 두며 오류를 그대로 실패시킨다.
  ControlType은 실제 타입을 확인한 뒤 직렬화하며 null/미지원 값은 `unavailable`로 기록한다.
  수집 전 snapshot을 비워 오류가 이전 available로 보이지 않게 한다.
  [PS 회귀](../../tests/windows-pdf-tree-diagnostics.test.ps1)는 같은 wrapper의 합성 예외,
  비활성 callback 미호출과 실제 ControlType 직렬화 함수의 정상/누락/다른 타입을 검사한다.
  실제 UI 전환 재현과 구분하며 모든 PDF mode의 Windows 설치 전 검사에 연결한다.
  이는 보조 수집 분리이지 필수 탐색/안전 guard의 생략이 아니다.

### 덮어쓰기와 취소

기존 테스트 target의 존재, Save 의도, 제출한 경로, 앱/저장창과 확인창의 소유 관계,
확인창 의미와 대상이 맞는지 검증한 뒤에만 승인한다. Yes/No 형태나 IDYES만으로는
덮어쓰기인지 알 수 없다. 본문 확인이 필요한 경우 승인된 fixture의 예상 값과 메모리에서
비교하고, 원문 대신 `promptMatchesExpectedTarget` 같은 판정값만 진단에 남긴다.

예상 밖 확인창은 증거와 함께 실패한다. 취소를 지원하는 시나리오는 출력/원본이 바뀌지
않았는지, modal이 끝나고 편집기로 돌아왔는지까지 확인한다. 취소를 확인하지 않은 테스트를
취소 수용으로 보고하지 않는다.

### 결과: 사용자 작업의 사후 조건을 검사한다

- 열기: generic 완료 메시지 대신 정확한 문서 identity와 로드된 내용을 확인한다.
- 저장: 예상 경로의 파일, source hash·dirty 상태, 형식과 필요한 출력 내용을 확인한다.
- 덮어쓰기: 확인창 처리뿐 아니라 사전 파일과 사후 결과를 비교한다. 동일 내용의 재저장은
  같은 hash일 수 있으므로 hash가 달라야 한다는 조건만으로 판정하지 않는다.
- PDF: UI의 쪽 수와 생성 PDF의 쪽 수·검증 문구·빈 페이지 검사·필요한 시각 판독을 구분한다.
- open-only, 일부 fixture 성공, helper 성공을 전체 PDF 수용으로 승격하지 않는다.

## 실패 한 건을 재사용 가능한 테스트로 바꾸는 순서

1. **증거 보존**: run URL, 제품/harness SHA, 설치 artifact identity, 환경, 실패 stage와
   결과를 기록한다. 제품과 자동화 코드가 달라졌는지부터 구분한다.
2. **작은 재현**: 비밀·개인 경로·본문을 제거한 입력/관측 데이터를 저장하고 실제 판단 함수에
   재생한다. 테스트 안에 구현을 복제한 가짜 selector를 만들어 통과시키지 않는다.
3. **회귀 범위 확인**: 정상 입력 외에도 중복 ID, wrong document, disabled/ambiguous control,
   예상 밖 modal, 취소, 누락/부분 증거를 다룬다. 해당 없는 항목은 이유를 남긴다.
4. **작은 OS 검증**: 순수 함수로 확인할 수 없는 부분만 대상 Windows/Linux에서 검증한다.
   필요하면 별도 승인을 받아 대화상자 단독 검증을 만든다. 별도 앱의 dialog 성공은
   Alhangeul 설치본 통합 성공과 구분한다.
5. **전체 통합 확인**: 알려진 차단 원인이 해소된 뒤 같은 설치 bytes로 전체 경로를 확인한다.
   변경 없는 재실행은 일시 장애라는 근거가 있을 때만 승인받아 수행한다.

workflow 실행 이력만 보존하지 않는다. Actions artifact는 만료되므로 최소 재현 데이터와
원인·해결·검증 한계를 저장소에 남긴다. 원본에서 무엇을 제거/가공했는지 명시하고, 합성
정상 사례를 실제 Windows 성공 증거로 설명하지 않는다. raw screenshot/PDF/tree를 통째로
커밋하지 않는다. 원본을 볼 수 없는 항목은 미확정으로 남긴다.

## 이 저장소의 현재 진입점과 공백

빠른 Windows PDF 계약·판정 회귀(플랫폼 중립):

```sh
pnpm run test:gui:windows:contracts
pnpm run typecheck:gui
```

이 계약 suite는 `pnpm run test:automation`에도 포함된다. 테스트 수를 보고할 때 정적
계약과 실행 가능한 판정 회귀를 구분한다. 이 명령은 Windows UI나 PDF 렌더러를 실행하지 않는다.

| 대상 | 실제 코드 / 검사 | 현재 한계 |
|---|---|---|
| 문서 identity | [함수](../../tests/gui/support/document-identity.ts), [재현 테스트](../../tests/windows-pdf-regressions.test.mjs) | title 경계 검사이며 실제 클릭·본문 렌더링은 아님 |
| PDF 결과 판정 | [분석기](../../tests/gui/windows-pdf/analyze.mjs), [기존 계약](../../tests/windows-pdf-workflow.test.mjs), [재현 데이터](../../tests/fixtures/windows-pdf-regressions.json) | mock PDF 분석을 쓰는 단위 테스트는 실제 PDF 품질 증거가 아님 |
| Windows dialog 판단 | [순수 정책](../../scripts/windows-pdf-dialog-policy.ps1), [실제 함수 테스트](../../tests/windows-pdf-dialog-policy.test.ps1), [UIA 관측](../../scripts/windows-pdf-dialog-observation.ps1) | 실제 helper가 같은 함수를 사용. 합성 PID/HWND·의미 입력은 native 성공 증거가 아님 |
| Windows 작은 OS 관측 | [probe](../../tests/gui/windows-dialog/probe.ps1), [workflow](../../.github/workflows/alhangeul-windows-dialog.yml), [메시지 adapter](../../scripts/windows-pdf-win32.ps1) | 제어된 WinForms 저장창의 확인창까지 관측하며 Yes는 실행하지 않음. 실제 앱·PDF·overwrite 수용과 별개 |
| Windows 작은 통합 | [확인창 adapter](../../scripts/windows-pdf-confirmation.ps1), [integration](../../tests/gui/windows-dialog/integration.ps1) | 실제 helper와 같은 확인창 처리를 사용. 공개 sentinel의 열기·새 저장·overwrite·거절/취소·잘못된 target 거부를 검사하며 제품/PDF 수용은 아님 |
| Windows 실제 설치본 | [spec](../../tests/gui/specs/windows-pdf.e2e.ts), [workflow](../../.github/workflows/alhangeul-windows-pdf.yml) | HWP/HWPX fresh/restart와 네 PDF 분석 통과. No/잘못된 target 거부는 이전 제한 실행 근거. 조판 전체 동등성·동시 편집/reload/TTL/physical IME 수용은 별도 |
| Linux native UI | [AT-SPI adapter](../../tests/gui/linux/native-ui/atspi.mjs), [사후 조건](../../tests/gui/linux/native-ui/action-postcondition.mjs), [spec](../../tests/gui/specs/linux-native.e2e.ts) | Windows ID/class 가정을 Linux에 이식하지 않음; 각 테스트의 실행 환경을 확인 |

Windows PowerShell 5.1의 순수 함수 테스트 진입점은 `pnpm run test:gui:windows:policy`다.
로컬 결과 JSON은 `windows-dialog-policy-result.json`에 생성하며 검토 후 커밋하지 않는다.
작은 OS 관측은 승인된 harness branch에서 Desktop dispatcher의 `windows-dialog-probe`로
실행한다. 설치 artifact 입력·제품 build가 필요 없다. policy 실패 시 OS 관측은 건너뛴다.
지원 pattern ID/name, HWND 소유 관계, 공개 fixture prompt의 정규화 결과만 artifact에 보존하며
실제 경로가 든 cleanup state는 업로드하지 않는다. 항상 실행되는 cleanup은 PID/시작 시각과
유일한 임시 디렉터리를 검증한 뒤 자기 자원만 정리한다.

작은 통합은 같은 dispatcher의 `windows-dialog-verify`로 실행한다. policy 검사 후 위 다섯
사례를 실행하며 관측-only probe는 중복 실행하지 않는다. host는 OK 및 선택 경로를 검증한
경우에만 지정 sentinel을 쓴다. No 후 저장창 복귀·Cancel 결과와 세 파일의 보존을 별도 검사한다.
현재 제어된 WinForms fixture의 다섯 사례와 cleanup은 모두 통과했다. UIA/native class를
동일시한 검사 오류를 진단하고 native 기대값을 관측된 `Button`으로 보정한 결과다.
UIA `CCPushButton` 조건과 다른 안전장치는 유지한다. 후속 실제 Alhangeul 검증에서는 같은
UIA class/command ID가 Pane으로 노출되고 지원 pattern 목록이 비어 있어 overwrite가 중단됐다.
작은 host의 성공을 실제 앱의 capability 지원으로 일반화하지 않는다. 이 차이가 해소되기 전
동일 전체 PDF 실행을 반복하지 않고 실제 앱의 해당 확인창으로 진단 범위를 좁힌다.

native 재검증 오류의 `nativeFailure`는 실제 승인 판정에 쓴 snapshot에서 나온다.
`checks`/`failedChecks`와 `classes.nativeButtonClass`를 보고, UIA 관측의 `class`와 구분한다.
미관측·타입 오류는 true로 보충하지 않는다. 추출기는 알려진 boolean과 제한된 class 문자열만
보존한다. [진단 테스트](../../tests/windows-pdf-native-diagnostics.test.ps1)는 실제 native 판정 함수의
합성 조건·실패 추출과 HWND 0의 거부를 검사하며, 실제 버튼 호출 검증을 대체하지 않는다.

확인창 adapter는 관측된 영문 대체 질문·정확한 파일명·저장창 owner·PID·enabled·유일한
UIA `CCPushButton`·native `Button`을 검사한다. 호출 전에 실제 Invoke 지원 여부로 경로를
선택한다. Invoke를 지원하면 기존 경로를 쓰고, 두 command가 관측된 Pane/Invoke 미지원 형태일
때만 native HWND 경로를 선택한다. 두 nonzero HWND의 구별·재조회 동일성과 각각의 native
guard·활성 dialog를 추가 검사한다. 다른 형태/언어와 모호한 identity는 명시적으로 실패한다.
파일명의 공백/구두점을 바꾸어 다른 파일과 일치시키지 않는다. legacy 숫자 ID나 호출 실패 뒤
다른 API로 fallback하지 않는다. 호출 성공 뒤에도 파일·창 상태를
검증한다. 공급자에 따라 호출이 차단될 수 있어 helper/step 상한과 독립 cleanup을 유지한다.
([Microsoft Invoke 계약](https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.invokepattern.invoke))
최신 실행 결과는 [사건 기록](../../mydocs/troubleshootings/task_m010_19_windows_pdf_automation.md)에 둔다.
Pester/PSScriptAnalyzer는 설치하지 않는다. Node 소스 계약을 PS 실행으로 세지 않는다.

실제 앱 확인창만 관측하려면 승인된 Desktop dispatcher의 `windows-pdf-dialog-probe`를 쓴다.
기존 exact 제품 SHA와 native run ID를 전달하며 설치·driver 준비는 기존 경로를 재사용한다.
공개 HWP 한 개와 고유 시험 target을 사용해 Save 확인창까지 도달하되 Yes/No는 누르지 않는다.
`confirmation-probe-Save.json`의 `confirmationObservation.buttons`에서 UIA type/pattern과
native class/control ID·dialog 활성 상태·guard 관측을 따로 확인한다. `observed`는 관측 완료이며
버튼 실행·PDF·취소 수용이 아니다. 앱 정리 뒤 별도 hash 검사로 두 파일의 보존을 확인한다.
이 mode는 HWPX/restart/전체 PDF 분석을 실행하지 않는다. 미지원 확인창을 바로 승인하는
fallback은 추가하지 않으며 관측 뒤 사용할 API와 안전 조건을 별도 승인받는다.

실제 앱 관측 run `34051827068`에서는 두 command 모두 native `Button`, 13개 guard true,
활성 dialog였지만 UIA Invoke는 여전히 없고 native ID 조회는 0이었다. source/target 보존과
cleanup은 통과했다. raw 수치 HWND와 상호 동일성은 진단에 없으므로 두 command가 별개의
native control인지까지 입증한 것은 아니다. 이 관측만으로 클릭 지원을 선언하지 않는다.
후속 승인으로 HWND 대상 `BM_CLICK` 경로와 실제 앱 제한 검증을 구현했다.
정확한 UIA command와 현재 HWND의 대응·두 command의 구별·의미/owner·
활성 상태를 검증한다. 메시지 자체에는 반환값이 없으므로 전달 결과와 파일/창의 사후 조건을
구분한다. 비활성 창 강제 활성화·다른 API 연쇄 시도는 하지 않는다.
([BM_CLICK 계약](https://learn.microsoft.com/en-us/windows/win32/controls/bm-click))

실제 앱 제한 호출 검증은 `windows-pdf-dialog-verify`다. 같은 exact SHA/native run 입력과
기존 설치 경로를 쓰며 공개 HWP 하나로 Decline, WrongTarget 거부 후 Decline, Confirm을
실행한다. 앞선 두 사례는 저장창 복귀·Cancel·이전 앱 상태 메시지 복구·세 파일 보존, 마지막은
sentinel의 PDF 교체·저장 완료·원본/다른 target 보존을 검사한다. source/target/other hash를
앱 cleanup 뒤 다시 확인한다. `confirmation-verify.json`과 각 helper JSON, cleanup JSON을
함께 읽는다. PDF header/EOF 검사는 형식의 최소 확인이며 쪽 수·검색·시각 품질 수용이 아니다.
이 mode는 HWPX/restart/전체 PDF 분석을 실행하지 않으며 기존 관측-only mode와 중복 선택할 수 없다.

`confirmation_cases`의 기본값은 `all`이다. 이전 거절 경로 통과 근거가 있고 남은 확인만 검증하도록
승인받았다면 같은 mode에 `confirmation_cases=confirm-only`를 전달한다. 다른 PDF mode와의 조합은
거부한다. `confirmation-verify.json`의 `selectedCases`와 실제 `cases`, cleanup의 선택 범위가
정확히 일치해야 통과한다. 단일 Confirm 결과를 세 사례 일괄 통과 또는 전체 PDF 수용으로 해석하지
않는다. 서로 다른 실행을 재사용할 때는 각각의 harness SHA/제품 bytes와 변경 경계를 기록한다.

실제 run `34053001644`에서 No·저장창 복귀·Cancel·파일 보존과 wrong-target 호출 전 거부가
통과했다. Confirm은 기존 보조 `Read-AppTree`의 `FindAll`에서 `ElementNotAvailableException`이
발생해 호출 전에 중단됐다. 이 예외는 더 이상 사용할 수 없는 UI 요소 접근을 뜻하며 정확히
어느 요소인지까지 이번 자료가 식별하지는 않는다.
([예외 계약](https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.elementnotavailableexception))
후속 승인으로 위 보조 진단 격리와 Confirm-only 선택을 구현했다. run `34055921568`은 실제
Confirm·PDF 교체·source/다른 target 보존·cleanup을 통과했다. PS5.1의 합성 예외 회귀 10개도
통과했다. 앞선 두 거절과 이번 확인은 서로 다른 harness 실행의 부분별 증거다. 두 harness 사이의
필수 판정/클릭 adapter와 제품 bytes는 동일하지만 이번에 세 사례를 일괄 재검증한 것은 아니다.
이번 최종 tree 진단은 available이며 실제 UI 전환에서 같은 예외가 발생·포착됐다는 증거는 아니다.
[4.21 보고서](../../mydocs/working/task_m010_19_stage4.21.md)에 출처와 한계를 기록한다.
기존 실패 run이나 미실행인 HWPX/restart/전체 PDF 수용을 통과로 소급하지 않는다.

전체 재개 run `34056914386`은 HWP/HWPX fresh 저장을 통과했지만 HWP restart에서 위 보조
metadata 오류로 확인 adapter 호출 전에 실패했다. HWPX restart와 원격 분석은 미실행이다.
원본/기존 target 보존과 fresh 두 PDF의 별도 분석은 전체 수용과 구분한다. 실패 JSON의
`available` 같은 상태도 현재 수집 실패 전 snapshot일 수 있으므로 stage/예외/사후 조건과
함께 판독한다. 선택적 수집의 입력 계약을 검사할 때는 예외 wrapper뿐 아니라 실제 직렬화의
속성 누락·타입 불일치를 포함한다. 후속 승인으로 위 비활성 기본값/직렬화/설치 전 검사를
보정했으며 실제 Windows 결과는 사건 기록에서 확인한다. 이전 실패를 통과로 소급하지 않는다.

후속 run `34058443345`는 PS 정책 62개/native 진단 50개/tree 16개와 HWP/HWPX fresh/restart,
원본/dirty 보존·cleanup 및 네 PDF 원격 분석을 통과했다. Open/Save 8개 helper evidence는 모두
`treeDiagnostic.status=disabled`/빈 tree이며 실제 확인·덮어쓰기는 필수 판정으로 수행됐다.
32쪽 렌더는 이전 검토 결과와 동일하다. 기존 HWPX 셀 경계 관측과 #19의 별도 수용 공백은
[4.19 보고서](../../mydocs/working/task_m010_19_stage4.19.md)에 남긴다. 같은 전체 실행을 재시도하지 않는다.

## 새 helper·Action 변경의 완료 기준

- [ ] 실패 사례와 정상/거부 조건이 재현 데이터·실제 함수 테스트에 연결되거나 공백이 명시됐다.
- [ ] OS adapter 변경은 해당 OS의 최소 통합 결과가 있다. 정적 검사만 통과했다면 미검증으로 남긴다.
- [ ] 검증 명령이 기존 실행 진입점에서 호출되며, 새 workflow는 중복 suite가 아닌지 확인했다.
- [ ] 코드·가이드의 지원 범위·사건 기록의 상태를 같은 변경에서 갱신했다.
- [ ] 기존 설치본/증거 재사용 조건과 cleanup·실패 업로드가 확인됐다.
- [ ] 수동 통과, 자동 통과, 미실행, 승인된 위험 수용을 섞지 않았다.

이 가이드는 릴리즈 gate를 추가하거나 해제하지 않는다. 자동화 실패가 제품 실패를 뜻하지는
않지만, 필수 gate를 임의로 생략할 권한도 아니다. 후보와 연결된 수동 근거의 수용 여부 및
후속 자동화 범위는 [릴리즈 정책](DESKTOP_RELEASE.md)과 작업지시자 승인을 따른다.
