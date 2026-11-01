#!/usr/bin/env bash
# third_party/rhwp 를 rhwp-core.lock 의 release tag·commit 으로 얕게(sparse, blob 지연) 가져온다.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOCK="$ROOT/rhwp-core.lock"
URL="$(sed -n 's/^rhwp_repo = "\(.*\)"/\1/p' "$LOCK")"
TAG="$(sed -n 's/^rhwp_release_tag = "\(.*\)"/\1/p' "$LOCK")"
COMMIT="$(sed -n 's/^rhwp_commit = "\(.*\)"/\1/p' "$LOCK")"
DEST="$ROOT/third_party/rhwp"
# Studio·WASM·네이티브 rhwp 크레이트 빌드에 필요한 최소 집합 (2026-10-30 검증한 sparse 집합)
SPARSE_DIRS=(assets bindings/Native crates npm rhwp-desk rhwp-shared rhwp-studio saved scripts src
  tools/batch-convert tools/llm_verifier/claim_bind tools/llm_verifier/criteria_decomp tools/llm_verifier/verdict_protocol
  tools/rhwp-subsecond ttfs vendor)

if [ -z "$URL" ] || [ -z "$TAG" ] || [ -z "$COMMIT" ]; then
  echo "rhwp-core.lock 에서 rhwp_repo/rhwp_release_tag/rhwp_commit 을 읽지 못했습니다." >&2; exit 1
fi

if [ ! -e "$DEST/.git" ]; then
  echo "third_party/rhwp 를 $TAG ($COMMIT) 로 가져옵니다…"
  rm -rf "$DEST"
  # Windows 러너는 core.autocrlf=true 라 상류 소스가 CRLF 로 풀린다 → 엔트리 변환 플러그인의 여러 줄 마커가 안 맞는다(2026-10-30 CI 실측). LF 로 고정한다.
  git clone --quiet -c core.autocrlf=false -c core.eol=lf --filter=blob:none --no-checkout --depth 1 --branch "$TAG" "$URL" "$DEST"
  git -C "$DEST" sparse-checkout set --cone "${SPARSE_DIRS[@]}"
  git -C "$DEST" checkout --quiet "$COMMIT"
  git -C "$ROOT" submodule init --quiet 2>/dev/null || true
  git -C "$ROOT" submodule absorbgitdirs 2>/dev/null || true
fi

ACTUAL="$(git -C "$DEST" rev-parse HEAD)"
if [ "$ACTUAL" != "$COMMIT" ]; then
  echo "third_party/rhwp HEAD($ACTUAL) 가 lock 의 commit($COMMIT) 과 다릅니다." >&2; exit 1
fi
echo "third_party/rhwp @ $ACTUAL ($TAG)"
