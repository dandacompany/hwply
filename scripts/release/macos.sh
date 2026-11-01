#!/bin/bash
# macOS 릴리스 빌드: aarch64·x86_64 두 대상을 Developer ID 로 서명하고 공증·staple 한다(이 맥의 로그인 키체인 필요).
# 산출물: dist/release/<버전>/ 에 dmg 2개, 업데이터용 .app.tar.gz 2개와 .sig.
#   bash scripts/release/macos.sh 0.1.0
# 비밀 값(공증 Issuer, 업데이터 서명 키)은 bws 에서 환경변수로만 읽고 출력하지 않는다. set -x 를 쓰지 않는다.
set -euo pipefail

VERSION="${1:?사용법: macos.sh <버전>}"
REPO="$(git rev-parse --show-toplevel)"

# 서명 identity·공증 키·bws 비밀 ID 는 저장소 밖 설정에 둔다(gitignore). 예시: scripts/release/macos.local.env.example
LOCAL_ENV="$REPO/scripts/release/macos.local.env"
[ -f "$LOCAL_ENV" ] || { echo "macos.sh: $LOCAL_ENV 가 없습니다(macos.local.env.example 을 복사해 채우세요)" >&2; exit 1; }
# shellcheck disable=SC1090
. "$LOCAL_ENV"
for name in SIGNING_IDENTITY NOTARY_KEY_ID NOTARY_KEY_PATH BWS_TOKEN_FILE BWS_ISSUER_ID BWS_UPDATER_KEY_ID BWS_UPDATER_PW_ID; do
  [ -n "${!name:-}" ] || { echo "macos.sh: $LOCAL_ENV 에 $name 이 없습니다" >&2; exit 1; }
done

fail() { echo "macos.sh: $*" >&2; exit 1; }

cd "$REPO"

# 사전 점검
[ -z "$(git status --porcelain)" ] || fail "작업 트리가 깨끗하지 않습니다(커밋한 상태로만 릴리스를 만든다)"
CONF_VERSION="$(node -p "require('./apps/desktop/src-tauri/tauri.conf.json').version")"
[ "$CONF_VERSION" = "$VERSION" ] || fail "tauri.conf.json 버전($CONF_VERSION)이 인자($VERSION)와 다릅니다"
security find-identity -v -p codesigning | grep -qF "\"$SIGNING_IDENTITY\"" || fail "키체인에 서명 인증서가 없습니다: $SIGNING_IDENTITY"
[ -f "$NOTARY_KEY_PATH" ] || fail "공증 API 키 파일이 없습니다: $NOTARY_KEY_PATH"

# 비밀 값: bws → 이 스크립트의 변수(화면에 내지 않는다). 토큰은 파일을 정본으로 다시 읽되 export 하지 않는다 —
# 빌드(cargo build.rs, pnpm 스크립트)에 bws 프로젝트 전체를 여는 토큰을 넘기지 않는다.
BWS_TOKEN="$(. "$BWS_TOKEN_FILE" >/dev/null 2>&1; printf '%s' "${BWS_ACCESS_TOKEN:-}")"
[ -n "$BWS_TOKEN" ] || fail "bws 토큰 파일을 읽지 못했습니다"
unset BWS_ACCESS_TOKEN
bwsv() { BWS_ACCESS_TOKEN="$BWS_TOKEN" bws secret get "$1" 2>/dev/null | python3 -c 'import sys,json;sys.stdout.write(json.load(sys.stdin)["value"])'; }
APPLE_API_ISSUER="$(bwsv "$BWS_ISSUER_ID")"
TAURI_SIGNING_PRIVATE_KEY="$(bwsv "$BWS_UPDATER_KEY_ID")"
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(bwsv "$BWS_UPDATER_PW_ID")"
for name in APPLE_API_ISSUER TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD; do
  [ -n "${!name}" ] || fail "bws 에서 $name 을 읽지 못했습니다"
done
unset BWS_TOKEN BWS_ACCESS_TOKEN
# Tauri 가 읽는 이름(APPLE_SIGNING_IDENTITY, APPLE_API_KEY, APPLE_API_KEY_PATH)으로 넘긴다.
export APPLE_SIGNING_IDENTITY="$SIGNING_IDENTITY" APPLE_API_KEY_PATH="$NOTARY_KEY_PATH"
printf -v APPLE_API_KEY '%s' "$NOTARY_KEY_ID"
export APPLE_API_KEY
export APPLE_API_ISSUER TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD

OUT="$REPO/dist/release/$VERSION"
mkdir -p "$OUT"

for pair in "aarch64-apple-darwin:aarch64" "x86_64-apple-darwin:x64"; do
  TRIPLE="${pair%%:*}"; ARCH="${pair##*:}"
  echo "== $TRIPLE"
  rustup target add "$TRIPLE" >/dev/null
  node scripts/prepare-sidecars.mjs --target "$TRIPLE" --profile release
  # CI=true: dmg 창 꾸미기(Finder AppleScript)를 건너뛴다. 터미널에 Finder 제어 권한이 없으면 -1712 로 실패한다.
  # Applications 링크와 볼륨 아이콘은 그대로 들어간다.
  CI=true pnpm --filter hwply-desktop exec tauri build --target "$TRIPLE" --bundles app,dmg \
    --config src-tauri/tauri.bundle.conf.json --config src-tauri/tauri.updater.conf.json

  BUNDLE="apps/desktop/src-tauri/target/$TRIPLE/release/bundle"
  APP="$BUNDLE/macos/hwply.app"
  DMG="$BUNDLE/dmg/hwply_${VERSION}_${ARCH}.dmg"
  TARBALL="$BUNDLE/macos/hwply.app.tar.gz"
  for f in "$APP" "$DMG" "$TARBALL" "$TARBALL.sig"; do [ -e "$f" ] || fail "산출물이 없습니다: $f"; done
  node scripts/check-bundle-sidecars.mjs --app "$APP"

  codesign --verify --deep --strict "$APP" || fail "서명 검증 실패: $APP"
  spctl -a -vvv -t install "$APP" 2>&1 | grep -q "source=Notarized Developer ID" || fail "앱이 공증되지 않았습니다: $APP"

  # dmg 자체도 공증·staple 한다(내려받은 dmg 를 열 때 Gatekeeper 가 확인).
  RESULT="$(xcrun notarytool submit "$DMG" --key "$NOTARY_KEY_PATH" --key-id "$NOTARY_KEY_ID" --issuer "$APPLE_API_ISSUER" --wait --output-format json)"
  echo "$RESULT" | python3 -c 'import sys,json;d=json.load(sys.stdin);print("notarytool:",d.get("status"),d.get("id"));sys.exit(0 if d.get("status")=="Accepted" else 1)' \
    || fail "dmg 공증 실패: $DMG"
  xcrun stapler staple "$DMG" >/dev/null
  xcrun stapler validate "$DMG"

  cp "$DMG" "$OUT/"
  cp "$TARBALL" "$OUT/hwply_${VERSION}_${ARCH}.app.tar.gz"
  cp "$TARBALL.sig" "$OUT/hwply_${VERSION}_${ARCH}.app.tar.gz.sig"
done

ls -l "$OUT"
echo "macOS 릴리스 산출물 준비 완료: $OUT"
