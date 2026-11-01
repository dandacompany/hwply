# Windows 최종 설치본·로컬 글꼴 점검

이 절차는 Task #76의 rhwp v0.8.6 통합 후보를 Windows x64에서 점검하기 위한 안내다. 제품 버전은 `0.1.0`이며 이전 v0.8.4 엔진 설치본 결과와 구분해 기록한다.

## 점검할 설치본

- [Windows x64 설치본 ZIP 다운로드](https://github.com/postmelee/alhangeul-tauri/actions/runs/36229142460/artifacts/10902469644) — GitHub 로그인 필요.
- [전체 CI 결과](https://github.com/postmelee/alhangeul-tauri/actions/runs/36229142460): success. 제품 source는 `02388f59e88efbf37514894a28a69466bcde9a8b`다.
- ZIP SHA-256: `420c5b51ca4e38f7eb6010824c4b277aeb3d2396af2184dbcf87aa46e43bd84d`.
- NSIS `nsis/Alhangeul_0.1.0_x64-setup.exe` SHA-256: `ee70185e47ab59a00904e5b9b9bbd97ebb16b85e2dcdf75b7f835b229ea6afb9`.

ZIP과 내부 파일 4개의 해시·inventory·source SHA를 확인했다. 전체 CI 성공은 Windows 실환경의 글꼴 표시 수용을 대신하지 않으므로 아래 점검 결과를 별도로 기록한다.

## 준비

1. 기존 Alhangeul에서 편집 중인 문서를 저장하고 모든 창을 종료한다.
2. 위 **Windows x64 설치본 ZIP**을 내려받아 압축을 푼다. `nsis/Alhangeul_0.1.0_x64-setup.exe`를 실행해 기존 NSIS 설치 환경을 업데이트한다. 이번 점검에서 MSI를 추가로 혼합 설치할 필요는 없다.
3. 파일 이름의 제품 버전은 `0.1.0`으로 같을 수 있다. 설치 파일을 Shift+우클릭해 경로를 복사한 뒤 PowerShell에서 아래 명령을 실행하고 위 NSIS hash와 비교한다.

   ```powershell
   Get-FileHash -Algorithm SHA256 'C:\Users\사용자\Downloads\압축푼폴더\nsis\Alhangeul_0.1.0_x64-setup.exe'
   ```

4. 첫 실행에 **화면 스킨 선택**이 나오면 원하는 스킨(이전 모습은 클래식)을 고르고 **시작하기**를 누른다. 이 안내는 로컬 글꼴 동의 창과 다르다. Alhangeul은 기존 시작 화면을 유지하며 새 문서는 **파일 → 새로 만들기**에서 만든다.
5. 이미 정상 적용을 확인한 **나눔스퀘어와 Abel은 그대로 유지**한다. 이전에 한컴과 비교한 문서는 복사본을 사용한다. 한컴과 Alhangeul에서 동일 파일·동일 글꼴/굵기·동일 배율을 비교한다.

## 무료 글꼴과 공개 문서

| 용도 | 다운로드 | 선택 |
|---|---|---|
| 한글 글꼴 | [네이버 공식 나눔글꼴](https://hangeul.naver.com/font), [나눔스퀘어 ZIP](https://hangeul.naver.com/hangeul_static/webfont/zips/nanum-square.zip) | **나눔스퀘어 TTF**. 나눔스퀘어 네오·라운드와 구분. 기존 비교 문서에 사용한 굵기를 포함해 설치 |
| 영문 글꼴 | [검증에 사용한 Abel-Regular.ttf](https://github.com/postmelee/alhangeul-tauri/raw/174ce569e885dde9f573dcac00feb10757437cbc/tests/gui/local-fonts/Abel-Regular.ttf) | 고정된 SIL OFL 무료 글꼴. [원본/라이선스](https://github.com/google/fonts/tree/b5efa9c32e8f9b63005f5cdb1ad5527a77d2cd04/ofl/abel) |
| 공개 HWP | [abel.hwp](https://github.com/postmelee/alhangeul-tauri/raw/174ce569e885dde9f573dcac00feb10757437cbc/tests/gui/local-fonts/abel.hwp) | 영문 실제 표시·저장 보존 점검 |
| 공개 HWPX | [abel.hwpx](https://github.com/postmelee/alhangeul-tauri/raw/174ce569e885dde9f573dcac00feb10757437cbc/tests/gui/local-fonts/abel.hwpx) | 같은 본문의 HWPX 경로 점검 |

글꼴이 아직 없는 별도 테스트 계정에서 설치 전/후를 비교하려면 먼저 문서를 열어 화면을 캡처한다. TTF 압축을 풀고 글꼴 파일을 우클릭 → **설치**한 다음, 실행 중인 Alhangeul의 **도구 → 로컬 글꼴 설정… → 다시 감지**를 실행한다. 처음 사용하는 계정은 **사용 (감지 허용) → 확인**을 먼저 선택한다. 재감지 직후 결과를 먼저 확인하고 앱 재실행 후 결과도 따로 기록한다. 설치 전 비교를 위해 기존 환경의 글꼴을 지울 필요는 없다.

## 필수 점검

| 순서 | 동작 | 통과 기준 |
|---|---|---|
| 1 | 새 설치본으로 기존 나눔스퀘어 문서와 Abel 문서 열기 | 문서가 정상 열리고 기존 사용 선택을 유지. 로컬 글꼴 동의 창이 자동 반복되지 않음 |
| 2 | 도구 → 로컬 글꼴 설정… → 다시 감지 | 오류 없이 완료. 나눔스퀘어·Abel이 다시 적용되고 문서 본문이 소실되지 않음 |
| 3 | 한컴과 동일 문서 비교 | 나눔스퀘어의 한글 획 모양·굵기 및 `*`, 영문·숫자 확인. Abel은 `Abel`, `WWW`, 숫자의 모양 확인 |
| 4 | 같은 문서를 다시 열고 다른 HWP/HWPX 열기 | 자동 동의 창이 재등장하지 않고 글꼴 적용이 유지됨 |
| 5 | 파일 → 새 창에서 같은 문서 열기 | 새 창도 기존 사용 설정과 글꼴 적용을 이어받음 |
| 6 | Alhangeul의 모든 창을 종료한 뒤 다시 실행 | 사용 설정과 실제 글꼴 적용이 유지됨 |
| 7 | 복사본에 짧은 문장을 추가하고 HWP/HWPX 각각 저장·재열기 | 본문·문서 글꼴명·페이지가 보존됨. 가능하면 한컴에서도 저장본을 열어 확인 |
| 8 | 파일 → 새로 만들기에서 문장을 입력하고 HWP로 저장·재열기 | 새 문서도 오류 없이 저장되고 입력 내용이 보존됨 |
| 9 | PDF로 저장하고 시스템 인쇄 대화상자 열기 | 파일 생성과 대화상자 진입 정상. 생성 PDF의 한글·쪽수·주요 글꼴 모양 확인. 출력까지 테스트했다면 별도 기록 |

**감지 개수나 글꼴 선택 상자에 이름이 있다는 사실만으로 실제 적용을 판정하지 않는다.** 이전에 적용을 확인한 화면과 본문의 글자 모양을 함께 비교한다. Abel은 한글 검증용 글꼴이 아니므로 한글은 나눔스퀘어 문서로 확인한다. Abel `iii`의 유독 두꺼운 표시만으로 로컬 공급 실패를 판정하지 않는다. 해당 폭 보정은 upstream 영역이며 이번 수용의 수정 대상으로 약속하지 않았다.

`사용 안 함`은 제품의 감지·직접 공급을 중지한다. Windows의 자체 글꼴 선택은 계속될 수 있으므로 화면이 즉시 대체 글꼴로 바뀌는 것을 필수 통과 기준으로 삼지 않는다. 이 옵션도 점검한다면 새 창·재실행 후 설정이 유지되는지만 확인하고 마지막에 `사용`으로 복구한다.

## 결과 전달

다음 양식과 필요한 캡처를 전달한다. 문제 문서는 공개해도 되는 복사본만 공유한다.

```text
Windows 버전 / NSIS 설치: 
다운로드 Actions run / 설치 파일 SHA256: 
나눔스퀘어 사용 굵기 / Abel: 
재감지 직후 실제 적용: 통과 / 실패
같은 문서·다른 문서 재열기: 통과 / 실패
새 창 / 모든 창 종료 후 재실행: 통과 / 실패
HWP / HWPX 저장 후 Alhangeul·한컴 재열기: 
새 문서 입력 / HWP 저장·재열기:
PDF 저장 / 시스템 인쇄: 
오류 문구, 실패 단계, 캡처 파일:
```

설치·표시·저장 점검 결과는 공개 릴리즈 승인과 구분한다. Windows Shell 썸네일은 별도 진단 범위이며, 이 글꼴 점검 통과만으로 모든 썸네일 환경을 수용하지 않는다.
