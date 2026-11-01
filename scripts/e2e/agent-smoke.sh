#!/usr/bin/env bash
# 실제 hwply 앱(디버그 번들) + hwply CLI 종단 스모크. macOS 로컬 전용(CI 에서 돌리지 않음).
# 스펙 §2 의 장면 1·2 와 충돌·저장 거절을 확인한다. 장면 3(사람 리터치)은 수동 확인 항목.
#
#   pnpm --filter hwply-desktop exec tauri build --debug --bundles app
#   (cd apps/cli && cargo build)
#   bash scripts/e2e/agent-smoke.sh
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP="${HWPLY_SMOKE_APP:-$ROOT/apps/desktop/src-tauri/target/debug/bundle/macos/hwply.app}"
HWPLY="${HWPLY_SMOKE_CLI:-$ROOT/apps/cli/target/debug/hwply}"
SAMPLES="$ROOT/third_party/rhwp/rhwp-studio/public/samples"
AGENT_FILE="$HOME/Library/Application Support/com.dante-labs.hwply/agent.json"
export HWPLY_APP="$APP/Contents/MacOS/hwply"

[ -x "$HWPLY_APP" ] || { echo "앱 번들이 없습니다: $APP"; exit 2; }
[ -x "$HWPLY" ] || { echo "CLI 가 없습니다: $HWPLY"; exit 2; }
command -v rhwp >/dev/null || { echo "PATH 에 rhwp 가 없습니다"; exit 2; }
if pgrep -f 'hwply.app/Contents/MacOS/hwply' >/dev/null; then
  echo "hwply 가 이미 실행 중입니다. 종료한 뒤 다시 실행하세요."; exit 2
fi

WORK="$(mktemp -d)"
cp "$SAMPLES/field-01.hwp" "$WORK/field.hwp"
cp "$SAMPLES/biz_plan.hwp" "$WORK/biz.hwp"
passed=0; failed=0

step() { echo "== $*"; }
ok() { echo "OK   $*"; }
check() { # check <설명> <명령…>: 명령이 성공하면 OK
  local what="$1"; shift
  if "$@"; then ok "$what"; return 0; else echo "FAIL $what"; return 1; fi
}
expect_code() { # expect_code <코드> <명령…>
  local want="$1"; shift
  "$@" >/dev/null 2>&1; local got=$?
  [ "$got" = "$want" ] || { echo "     기대 종료 코드 $want, 실제 $got: $*"; return 1; }
}
score() { if [ "$1" = 0 ]; then passed=$((passed + 1)); else failed=$((failed + 1)); fi; }

cleanup() {
  osascript -e 'quit app "hwply"' >/dev/null 2>&1 || true
  sleep 2
  pkill -f 'hwply.app/Contents/MacOS/hwply' 2>/dev/null || true
}
trap cleanup EXIT

step "장면 1: 공문 서식 채우기 (앱이 꺼져 있으면 hwply open 이 띄운다)"
s=0
FIELD_ID="$("$HWPLY" open "$WORK/field.hwp" 2>&1)" || { echo "FAIL open: $FIELD_ID"; s=1; }
if [ "$s" = 0 ]; then
  NAME="$("$HWPLY" read "$FIELD_ID" -- fields --json | jq -r '.fields[0].name')"
  DATA="$(jq -cn --arg k "$NAME" '{($k): "테스트 값"}')"
  check "누름틀 '$NAME' 채우기 (edit)" "$HWPLY" edit "$FIELD_ID" -- edit fill-fields --data "$DATA" || s=1
  check "채운 값이 읽힌다" bash -c "\"$HWPLY\" read \"$FIELD_ID\" -- fields --json | jq -e --arg k \"$NAME\" '.fields[] | select(.name == \$k) | .value == \"테스트 값\"' >/dev/null" || s=1
  check "docs 에 dirty:true" bash -c "\"$HWPLY\" docs --json | jq -e --arg id \"$FIELD_ID\" '.docs[] | select(.id == \$id) | .dirty' >/dev/null" || s=1
fi
score $s

step "장면 2: 밖에서 문단 고치기 (set-text, focus)"
s=0
BIZ_ID="$("$HWPLY" open "$WORK/biz.hwp")" || s=1
PARA="$(rhwp dump "$WORK/biz.hwp" | grep -E '^--- 문단 0\.[0-9]+ --- .*text_len=[1-9][0-9]*, controls=0' | head -1 | sed -E 's/^--- 문단 0\.([0-9]+).*/\1/')"
check "문단 0.$PARA 바꾸기" "$HWPLY" set-text "$WORK/biz.hwp" 0 "$PARA" "에이전트가 고친 문단" || s=1
check "바뀐 텍스트가 읽힌다" bash -c "\"$HWPLY\" paragraph \"$BIZ_ID\" 0 \"$PARA\" --json | jq -e '.text == \"에이전트가 고친 문단\"' >/dev/null" || s=1
check "focus" "$HWPLY" focus "$BIZ_ID" 0 "$PARA" --json || s=1
score $s

step "충돌: 체크아웃 뒤 문서가 바뀌면 체크인은 exit 3"
s=0
check "checkout" "$HWPLY" checkout "$BIZ_ID" "$WORK/co.hwp" || s=1
check "그 사이 실시간 편집" "$HWPLY" set-text "$BIZ_ID" 0 "$PARA" "사람이 그 사이 고침" || s=1
check "checkin → exit 3" expect_code 3 "$HWPLY" checkin "$BIZ_ID" "$WORK/co.hwp" || s=1
check "문서는 그대로" bash -c "\"$HWPLY\" paragraph \"$BIZ_ID\" 0 \"$PARA\" --json | jq -e '.text == \"사람이 그 사이 고침\"' >/dev/null" || s=1
score $s

step "저장: 디스크 반영, 밖에서 바뀐 파일은 --force 로만"
s=0
check "save" "$HWPLY" save "$FIELD_ID" || s=1
check "디스크 파일에 값이 있다" bash -c "rhwp fields \"$WORK/field.hwp\" --json | jq -e '.fields[] | select(.value == \"테스트 값\")' >/dev/null" || s=1
sleep 1
cp "$SAMPLES/field-01.hwp" "$WORK/field.hwp"
check "밖에서 바뀐 뒤 save → exit 3" expect_code 3 "$HWPLY" save "$FIELD_ID" || s=1
check "save --force" "$HWPLY" save "$FIELD_ID" --force || s=1
score $s

step "종료: agent.json 정리"
s=0
"$HWPLY" save "$BIZ_ID" >/dev/null 2>&1 || true
osascript -e 'quit app "hwply"' >/dev/null 2>&1
for _ in $(seq 1 10); do [ -f "$AGENT_FILE" ] || break; sleep 1; done
check "정상 종료 뒤 agent.json 이 없다" test ! -f "$AGENT_FILE" || s=1
check "앱 없을 때 status → exit 4" expect_code 4 "$HWPLY" status || s=1
score $s

echo "smoke: $passed/$((passed + failed)) passed"
[ "$failed" = 0 ]
