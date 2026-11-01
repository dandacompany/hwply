#!/bin/bash
# 초안 릴리스(v<버전>)에 macOS 산출물·latest.json·SHA256SUMS 를 올린다. 게시(초안 해제)는 하지 않는다.
# 순서: 태그 push → release.yml 이 Windows 설치 파일을 초안에 올림 → macos.sh → 이 스크립트.
#   bash scripts/release/publish-draft.sh 0.1.0 [notes.md]
set -euo pipefail

VERSION="${1:?사용법: publish-draft.sh <버전> [노트 파일]}"
NOTES="${2:-}"
TAG="v$VERSION"
REPO_ROOT="$(git rev-parse --show-toplevel)"
OUT="$REPO_ROOT/dist/release/$VERSION"

fail() { echo "publish-draft.sh: $*" >&2; exit 1; }

[ "$(gh release view "$TAG" --json isDraft -q .isDraft 2>/dev/null)" = "true" ] \
  || fail "$TAG 초안 릴리스가 없습니다(태그를 push 해 release.yml 이 먼저 만들어야 한다)"
[ -d "$OUT" ] || fail "$OUT 이 없습니다(scripts/release/macos.sh $VERSION 먼저)"

gh release download "$TAG" --pattern "hwply_${VERSION}_x64-setup.exe*" --dir "$OUT" --clobber
node "$REPO_ROOT/scripts/release/assemble.mjs" --version "$VERSION" --dir "$OUT" ${NOTES:+--notes "$NOTES"}

gh release upload "$TAG" \
  "$OUT/hwply_${VERSION}_aarch64.dmg" "$OUT/hwply_${VERSION}_x64.dmg" \
  "$OUT/hwply_${VERSION}_aarch64.app.tar.gz" "$OUT/hwply_${VERSION}_aarch64.app.tar.gz.sig" \
  "$OUT/hwply_${VERSION}_x64.app.tar.gz" "$OUT/hwply_${VERSION}_x64.app.tar.gz.sig" \
  "$OUT/latest.json" "$OUT/SHA256SUMS" --clobber

gh release view "$TAG" --json assets -q '.assets[].name'
echo "초안 $TAG 에 업로드 완료. 게시는 확인 뒤 gh release edit $TAG --draft=false"
