#!/bin/sh
# 테스트용 rhwp: 받은 인자를 FAKE_RHWP_LOG 에 한 줄씩 적고, 입력 파일을 FAKE_RHWP_COPY 로 복사하고,
# -o 가 있으면 입력 + "EDITED" 를 출력 파일로 쓴다. 종료 코드는 FAKE_RHWP_EXIT(기본 0).
log="${FAKE_RHWP_LOG:?}"
: > "$log"
for a in "$@"; do printf '%s\n' "$a" >> "$log"; done
in=""; out=""; prev=""
for a in "$@"; do
  if [ "$prev" = "-o" ]; then out="$a"; fi
  case "$a" in
    *.hwp|*.hwpx|*.hml) if [ -z "$in" ] && [ -f "$a" ]; then in="$a"; fi ;;
  esac
  prev="$a"
done
if [ -n "$FAKE_RHWP_COPY" ] && [ -n "$in" ]; then cp "$in" "$FAKE_RHWP_COPY"; fi
if [ -n "$out" ] && [ -n "$in" ]; then cp "$in" "$out"; printf 'EDITED' >> "$out"; fi
exit "${FAKE_RHWP_EXIT:-0}"
