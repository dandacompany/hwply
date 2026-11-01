#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/update-upstream.sh --tag <vX.Y.Z> --commit <40-char-sha> [--run-checks]

Updates third_party/rhwp to an immutable Stable release tag and its verified
resolved commit. Branches, floating refs, and legacy UPSTREAM_* environment
variables are not supported.
USAGE
}

usage_error() {
  echo "error: $*" >&2
  usage >&2
  exit 2
}

release_tag=""
expected_commit=""
run_checks=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag)
      [[ $# -ge 2 && "$2" != --* ]] || usage_error "--tag requires a value."
      [[ -z "$release_tag" ]] || usage_error "--tag may only be specified once."
      release_tag="$2"
      shift 2
      ;;
    --commit)
      [[ $# -ge 2 && "$2" != --* ]] || usage_error "--commit requires a value."
      [[ -z "$expected_commit" ]] || usage_error "--commit may only be specified once."
      expected_commit="$2"
      shift 2
      ;;
    --run-checks)
      [[ "$run_checks" == "0" ]] || usage_error "--run-checks may only be specified once."
      run_checks=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage_error "unknown option or positional ref: $1"
      ;;
  esac
done

[[ ${UPSTREAM_BRANCH+x} != x ]] || usage_error "UPSTREAM_BRANCH is no longer supported."
[[ ${UPSTREAM_REMOTE+x} != x ]] || usage_error "UPSTREAM_REMOTE is no longer supported."
[[ ${UPSTREAM_REF+x} != x ]] || usage_error "UPSTREAM_REF is no longer supported."
[[ ${RUN_CHECKS+x} != x ]] || usage_error "RUN_CHECKS is no longer supported; use --run-checks."

[[ -n "$release_tag" ]] || usage_error "--tag is required."
[[ -n "$expected_commit" ]] || usage_error "--commit is required."
[[ "$release_tag" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] \
  || usage_error "--tag must be a Stable release tag in vX.Y.Z form."
[[ ${#expected_commit} -eq 40 && "$expected_commit" =~ ^[0-9a-f]+$ ]] \
  || usage_error "--commit must be a lowercase 40-character SHA."

repo_root="$(git rev-parse --show-toplevel)"
submodule_dir="$repo_root/third_party/rhwp"
vendor_dir="$repo_root/apps/studio-host/vendor/rhwp-core"
wasm_pack_version="0.15.0"
initial_commit=""
failure_step="preflight"
staging_dir=""

cleanup_staging() {
  if [[ -z "$staging_dir" ]]; then
    return
  fi

  case "$staging_dir" in
    "$submodule_dir"/.hwply-wasm-build.*)
      rm -rf -- "$staging_dir"
      staging_dir=""
      ;;
    *)
      echo "Refusing to remove an unexpected staging path: $staging_dir" >&2
      ;;
  esac
}

report_failure() {
  local status=$?
  trap - ERR
  cleanup_staging
  echo "Stable upstream update failed during: $failure_step" >&2
  if [[ -n "$initial_commit" ]]; then
    echo "Starting submodule commit: $initial_commit" >&2
  fi
  echo "No automatic reset was performed. Review git status and use the documented rollback procedure." >&2
  exit "$status"
}

if [[ ! -d "$submodule_dir/.git" && ! -f "$submodule_dir/.git" ]]; then
  echo "Missing upstream submodule at third_party/rhwp." >&2
  echo "Run: git submodule update --init --recursive" >&2
  exit 1
fi

initial_commit="$(git -C "$submodule_dir" rev-parse HEAD)"
trap cleanup_staging EXIT
trap report_failure ERR

if [[ -n "$(git -C "$submodule_dir" status --porcelain --untracked-files=all)" ]]; then
  echo "Upstream submodule has local changes. Commit or discard them before updating." >&2
  false
fi

configured_origin="$(
  git -C "$repo_root" config -f .gitmodules \
    --get submodule.third_party/rhwp.url || true
)"
actual_origin="$(git -C "$submodule_dir" remote get-url origin)"
if [[ -z "$configured_origin" || "$actual_origin" != "$configured_origin" ]]; then
  echo "Upstream submodule origin does not match .gitmodules." >&2
  echo "Configured: ${configured_origin:-<missing>}" >&2
  echo "Actual: $actual_origin" >&2
  false
fi

for command_name in cargo node wasm-pack; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command is missing: $command_name" >&2
    false
  fi
done
if [[ "$run_checks" == "1" ]] && ! command -v pnpm >/dev/null 2>&1; then
  echo "Required command is missing: pnpm" >&2
  false
fi

failure_step="wasm-pack version preflight"
actual_wasm_pack_version="$(wasm-pack --version)"
if [[ "$actual_wasm_pack_version" != "wasm-pack $wasm_pack_version" ]]; then
  echo "wasm-pack version mismatch." >&2
  echo "Expected: wasm-pack $wasm_pack_version" >&2
  echo "Actual: $actual_wasm_pack_version" >&2
  false
fi

failure_step="release tag fetch"
git -C "$submodule_dir" fetch --no-tags origin \
  "refs/tags/$release_tag:refs/tags/$release_tag"

resolved_commit="$(
  git -C "$submodule_dir" rev-parse --verify "refs/tags/$release_tag^{commit}"
)"

if [[ "$resolved_commit" != "$expected_commit" ]]; then
  echo "Release tag and expected commit do not match." >&2
  echo "Tag: $release_tag" >&2
  echo "Resolved: $resolved_commit" >&2
  echo "Expected: $expected_commit" >&2
  false
fi

failure_step="source checkout"
git -C "$submodule_dir" checkout --detach "$expected_commit"

actual_commit="$(git -C "$submodule_dir" rev-parse HEAD)"
if [[ "$actual_commit" != "$expected_commit" ]]; then
  echo "Upstream checkout did not land on the expected commit." >&2
  echo "Actual: $actual_commit" >&2
  echo "Expected: $expected_commit" >&2
  false
fi

for manifest in \
  apps/desktop/src-tauri/Cargo.toml; do
  failure_step="$manifest Cargo.lock update"
  (cd "$repo_root" && cargo update --manifest-path "$manifest" -p rhwp)
done

failure_step="fresh WASM staging setup"
staging_dir="$(mktemp -d "$submodule_dir/.hwply-wasm-build.XXXXXX")"
case "$staging_dir" in
  "$submodule_dir"/.hwply-wasm-build.*) ;;
  *)
    echo "Unexpected WASM staging path: $staging_dir" >&2
    false
    ;;
esac
staging_name="$(basename "$staging_dir")"

build_source_commit="$(git -C "$submodule_dir" rev-parse HEAD)"
if [[ "$build_source_commit" != "$expected_commit" ]]; then
  echo "WASM build source changed before the build." >&2
  echo "Actual: $build_source_commit" >&2
  echo "Expected: $expected_commit" >&2
  false
fi

failure_step="fresh WASM build"
(cd "$submodule_dir" && wasm-pack build \
  --target web \
  --release \
  --out-dir "$staging_name")

build_result_commit="$(git -C "$submodule_dir" rev-parse HEAD)"
if [[ "$build_result_commit" != "$expected_commit" ]]; then
  echo "WASM build source changed during the build." >&2
  echo "Actual: $build_result_commit" >&2
  echo "Expected: $expected_commit" >&2
  false
fi

generated_artifacts=(
  package.json
  rhwp.js
  rhwp.d.ts
  rhwp_bg.wasm
  rhwp_bg.wasm.d.ts
)
for artifact in "${generated_artifacts[@]}"; do
  if [[ ! -s "$staging_dir/$artifact" ]]; then
    echo "Fresh WASM build is missing a required artifact: $artifact" >&2
    false
  fi
done
if [[ ! -s "$submodule_dir/LICENSE" ]]; then
  echo "Upstream source is missing LICENSE." >&2
  false
fi

failure_step="vendored WASM synchronization"
mkdir -p "$vendor_dir"
for artifact in "${generated_artifacts[@]}"; do
  cp "$staging_dir/$artifact" "$vendor_dir/$artifact"
done
cp "$submodule_dir/LICENSE" "$vendor_dir/LICENSE"
cleanup_staging

if [[ -n "$(git -C "$submodule_dir" status --porcelain --untracked-files=all)" ]]; then
  echo "WASM build changed tracked or untracked upstream source content." >&2
  false
fi

failure_step="upstream rhwp CLI checksums"
# 앱 번들에 넣는 상류 rhwp CLI 바이너리의 아카이브 SHA 를 같은 태그의 릴리스에서 가져온다.
cli_sums_file="$(mktemp)"
gh release download "$release_tag" --repo edwardkim/rhwp --pattern SHA256SUMS.txt \
  --output "$cli_sums_file" --clobber

failure_step="rhwp-core.lock write"
(cd "$repo_root" && node scripts/write-rhwp-pin.mjs \
  --tag "$release_tag" \
  --commit "$expected_commit" \
  --wasm-pack-version "$wasm_pack_version" \
  --cli-sums "$cli_sums_file")
rm -f -- "$cli_sums_file"

failure_step="rhwp pin verification"
(cd "$repo_root" && node scripts/verify-rhwp-pin.mjs)

if [[ "$run_checks" == "1" ]]; then
  failure_step="platform-neutral checks"
  (cd "$repo_root" && pnpm install --frozen-lockfile)
  (cd "$repo_root" && pnpm run check:rhwp-pin)
  (cd "$repo_root" && pnpm run check:product-boundary)
  (cd "$repo_root" && pnpm run test:upstream)
  (cd "$repo_root" && pnpm run test:studio)
  (cd "$repo_root" && pnpm run build:studio)
  (cd "$repo_root" && cargo metadata \
    --manifest-path apps/desktop/src-tauri/Cargo.toml \
    --locked \
    --offline \
    --no-deps)
  (cd "$repo_root" && cargo fmt \
    --manifest-path apps/desktop/src-tauri/Cargo.toml \
    --all \
    -- \
    --check)
fi

cat <<EOF
Stable upstream pin updated and verified.

Path: third_party/rhwp
Release tag: $release_tag
Resolved commit: $resolved_commit
WASM build: wasm-pack $wasm_pack_version (--target web --release)
Provenance: rhwp-core.lock
EOF
