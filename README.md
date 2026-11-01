# hwply

**사람과 AI 에이전트가 같은 HWP/HWPX 문서를 함께 작업하는 데스크톱 편집기.**

[![CI](https://github.com/dandacompany/hwply/actions/workflows/ci.yml/badge.svg)](https://github.com/dandacompany/hwply/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![skills.sh](https://img.shields.io/badge/skills.sh-hwply-blue)](https://skills.sh/dandacompany/hwply)
[![bundled rhwp v0.8.7](https://img.shields.io/badge/bundled%20rhwp-v0.8.7%20%C2%B7%201a76570e-5865f2)](https://github.com/edwardkim/rhwp/releases/tag/v0.8.7)

한글 문서를 다루는 AI 도구는 대개 파일을 읽어 새 파일을 만든다. 그 사이 사람이 화면에서 같은 문서를 고치고 있었다면
둘 중 하나는 사라진다. hwply 는 반대로 간다. 사람은 hwply 창에서 문서를 보고 손으로 고치고, 에이전트(Claude Code·Codex 같은
터미널 에이전트)는 `hwply` CLI 로 **지금 그 창에 열려 있는 문서**를 읽고 고치고 저장한다. 사람이 그 사이 고쳤으면 에이전트의
요청은 거절되고, 에이전트는 다시 읽고 다시 보낸다 — 사람이 이긴다.

엔진은 [edwardkim/rhwp](https://github.com/edwardkim/rhwp)(Rust + WASM)이다. 앱에는 같은 버전의 `rhwp` CLI 와 에이전트용 skill 이 함께 들어 있다.

## 설치

공식 배포처는 이 저장소의 Releases 뿐이다: <https://github.com/dandacompany/hwply/releases>

| OS | 파일 | 비고 |
| --- | --- | --- |
| macOS 13 이상 (Apple 실리콘) | `hwply_<버전>_aarch64.dmg` | Developer ID 서명·Apple 공증 |
| macOS 13 이상 (Intel) | `hwply_<버전>_x64.dmg` | Developer ID 서명·Apple 공증 |
| Windows 10/11 (x64) | `hwply_<버전>_x64-setup.exe` | 아직 코드 서명 전 — 아래 참고 |

- **macOS**: dmg 를 열고 hwply 를 「응용 프로그램」 폴더로 끌어다 놓는다. 디스크 이미지 안에서 바로 실행하면 터미널 연결과 자동 업데이트가 꺼진다.
- **Windows**: 설치 파일이 아직 서명되지 않아 SmartScreen 이 「Windows의 PC 보호」를 띄운다. 「추가 정보 → 실행」을 누르면 설치된다. 내려받은 파일은 Releases 의 `SHA256SUMS` 로 확인할 수 있다.
- 설치 뒤에는 앱이 새 버전을 확인해 알려 준다(업데이트 파일은 서명을 확인한 뒤에만 설치한다).

## 첫 실행 — 에이전트 연결 설정

처음 실행하면 「에이전트 연결 설정」 창이 뜬다.

- **터미널에서 `hwply`·`rhwp` 명령 쓰기** — macOS 는 `~/.local/bin` 에 앱 안의 실행 파일을 가리키는 링크를 만든다. Windows 는 `%LOCALAPPDATA%\hwply\bin` 에 복사하고 사용자 PATH 에 더한다.
- **skill 설치** — Claude Code(`~/.claude/skills/hwply`), Codex·기타(`~/.agents/skills/hwply`). 폴더가 있는 쪽만 기본으로 고른다. 복사본으로 설치한다.
  앱 없이 skill 만 받으려면 `skills add dandacompany/hwply@hwply -g --copy -a claude-code` (단, 열린 문서 작업에는 앱의 `hwply` CLI 가 필요하다).

이미 같은 이름의 다른 파일이나 직접 만든 skill 이 있으면 건드리지 않고 건너뛴다. 같은 일은 언제든 터미널에서 다시 할 수 있다.

```bash
hwply setup            # 계획을 보여 주고 묻는다 (--yes, --dry-run, --path, --skills claude,agents, --force, --remove)
hwply doctor           # 앱·설치·PATH·rhwp·skill 점검
```

## 에이전트로 쓰기

hwply 앱이 떠 있으면 어떤 터미널 에이전트든 `hwply` CLI 로 지금 열린 문서를 다룬다. 읽기와 왕복 편집은 함께 설치된 `rhwp` CLI 를 쓴다.

```bash
hwply open 공문.hwp                                          # 앱이 없으면 띄운다. 문서 id 출력
hwply read @active -- fields --json                           # 열린 문서(미저장 편집 포함)에 rhwp 읽기 명령
hwply edit @active -- edit fill-fields --data '{"수신":"○○기관장"}'   # 왕복 편집(rhwp edit 한 번)
hwply set-text @active 0 14 "고친 문단"                        # 실시간 편집(평문 본문 문단 하나)
hwply save @active                                            # 저장. 밖에서 바뀐 파일은 --force 로만
```

`<doc>` 자리에는 문서 id, `@active`(앞에 있는 창), 열린 파일의 경로를 쓴다. `hwply docs` 로 목록을 본다.
여러 편집을 한 번에 하려면 `hwply checkout <doc> 작업.hwp` → `rhwp …` → `hwply checkin <doc> 작업.hwp`.

| 종료 코드 | 뜻 |
| --- | --- |
| 0 | 성공 |
| 2 | 인자 오류(문서를 찾을 수 없음, 실시간으로 바꿀 수 없는 문단 포함) |
| 3 | 그 사이 문서가 바뀜(사람 편집·디스크 변경) — 다시 읽고 다시 보낸다 |
| 4 | hwply 앱에 연결할 수 없음 |
| 5 | rhwp 실패 |

에이전트가 바꾸면 창 오른쪽 위에 "에이전트 변경 N" 배지와 토스트가 뜬다. 왕복 편집은 배지나 토스트의
**되돌리기**로 직전 상태로 돌린다(최대 5개).

### macOS 파일 접근 허용

「문서」·「데스크탑」·「다운로드」 폴더의 파일은 macOS 가 처음 접근할 때 허용을 묻는다. 앱에서 열 때는 hwply 에 대해,
에이전트가 `hwply open`·`rhwp` 로 다룰 때는 그 에이전트를 실행한 터미널 앱에 대해 묻는다. 거절했다면
「시스템 설정 → 개인정보 보호 및 보안 → 파일 및 폴더」에서 다시 켤 수 있다.

## 보안

- 에이전트 브리지는 `127.0.0.1` 에만 열리고, 앱이 실행될 때마다 새로 만드는 토큰(앱 데이터 폴더의 `agent.json`, 소유자만 읽기)으로 인증한다. 브라우저 페이지에서는 부를 수 없다(CORS 없음).
- 에이전트가 넘긴 경로는 열기·저장에만 쓴다. 앱은 그 경로를 실행하지 않는다.
- 같은 사용자 계정으로 실행되는 다른 프로그램은 토큰 파일을 읽을 수 있다. 이 경계를 넘는 보호는 하지 않는다.
- 암호가 걸린 문서는 브리지가 내보내기·저장을 거절한다. 사람이 앱에서 저장한다.

## 엔진과 출처

- 문서 파싱·렌더링·편집 엔진: [edwardkim/rhwp](https://github.com/edwardkim/rhwp) `v0.8.7` (`1a76570e833917d15817415a53c09ad61ab3203f`) — `rhwp-core.lock` 에 WASM 산출물과 CLI 바이너리 SHA 를 고정한다.
- skill 의 참조 문서는 같은 커밋의 상류 실사용 skill 본문이다(`skill/hwply/LICENSE-rhwp`).
- 데스크톱 셸의 출발점: [postmelee/alhangeul-tauri](https://github.com/postmelee/alhangeul-tauri) `v0.1.2` — `PROVENANCE.md`.
- 엔진 결함은 상류에 보고하고, `third_party/rhwp` 는 직접 고치지 않는다.

## 개발

```bash
bash scripts/upstream/init.sh          # third_party/rhwp 를 v0.8.7 로 얕게(sparse) 가져온다
corepack enable && pnpm install --frozen-lockfile
pnpm run build:studio                  # 상류 Studio + hwply 어댑터 → apps/studio-host/dist
node scripts/prepare-sidecars.mjs --target "$(rustc -vV | sed -n 's/^host: //p')"   # 번들에 넣을 hwply-cli·rhwp
pnpm --filter hwply-desktop exec tauri build --debug --bundles app --config src-tauri/tauri.bundle.conf.json
pnpm test                              # 자동화·상류 고정·studio·Rust·CLI 테스트
node scripts/generate-third-party.mjs  # 의존성을 바꾼 뒤 THIRD_PARTY_LICENSES 표 갱신
```

## 라이선스

MIT — [LICENSE](LICENSE). 제3자 구성요소와 글꼴은 `THIRD_PARTY_LICENSES.md`, `assets/fonts/FONTS.md`. 번들 글꼴은 OFL 과 GUST 라이선스뿐이다.

## 고지

- 본 제품은 한글과컴퓨터의 한글 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.
- "한글", "한컴", "HWP", "HWPX"는 주식회사 한글과컴퓨터의 등록 상표이며, 본 프로젝트는 한글과컴퓨터와 제휴·후원·승인 관계가 없습니다.

---
Built by [Dante Labs](https://dante-labs.com) · [YouTube @dante-labs](https://youtube.com/@dante-labs) · [Discord](https://discord.com/invite/rXyy5e9ujs) · [Buy Me a Coffee](https://buymeacoffee.com/dante.labs)
