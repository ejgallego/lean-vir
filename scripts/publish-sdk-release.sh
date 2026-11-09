#!/usr/bin/env bash
# Copyright (c) 2026 Lean FRO LLC. All rights reserved.
# Released under Apache 2.0 license as described in the file LICENSE.
# Author: Emilio J. Gallego Arias

# Run from the checkout after local runtime/SDK qualification. The workflow owns
# the tag; this script never creates, changes or deletes tags.
set -eEuo pipefail

if [[ $# != 4 ]]; then
  echo "usage: bash scripts/publish-sdk-release.sh TAG RUNTIME_PACK SDK_ARCHIVE STALE_FIXTURE" >&2
  exit 2
fi
tag=$1 runtime_pack=$2 sdk_archive=$3 stale_fixture=$4
for path in "$runtime_pack" "$sdk_archive" "$stale_fixture"; do
  test -f "$path"
done

# A failed public probe must not leave a newly published release advertised.
# Preserve visibility of releases that were already public before this attempt.
owned_draft=false
on_failure() {
  local status=$?
  trap - ERR
  if [[ $owned_draft == true ]]; then
    if ! gh release edit "$tag" --draft --latest=false; then
      echo "RELEASE_RECOVERY_FAILED: manually return $tag to draft; publication qualification failed" >&2
    fi
  fi
  exit "$status"
}
trap on_failure ERR

if draft=$(gh release view "$tag" --json isDraft --jq .isDraft); then
  case $draft in
    true) owned_draft=true ;;
    false) ;;
    *) echo "unexpected release draft state: $draft" >&2; exit 1 ;;
  esac
else
  release_args=(--verify-tag --generate-notes --draft)
  if [[ $tag == *-rc* ]]; then
    release_args+=(--prerelease --latest=false)
  fi
  gh release create "$tag" "${release_args[@]}"
  owned_draft=true
fi
# Verify/reuse identical source-addressed runtime assets; never replace them.
node scripts/resources/publish-runtime.mjs "$tag" "$runtime_pack"
# SDK upload retry policy is unchanged by the runtime-selection repair.
gh release upload "$tag" "$sdk_archive" --clobber
gh release edit "$tag" --draft=false

# The produced pack is an assertion, never an acquisition override. The fresh
# ordinary dependency must acquire its source's public asset and execute it.
unset VIR_RUNTIME_PACK
npm run test:resources:published -- --expect-runtime-pack "$runtime_pack" --stale-runtime-pack "$stale_fixture"
revision=$(git rev-parse HEAD)
curl -fsSL "https://github.com/$GITHUB_REPOSITORY/releases/download/$tag/runtime-$revision.virres" -o build/public-runtime.virres
cmp build/public-runtime.virres "$runtime_pack"
lake build :virSdk
cmp .lake/build/vir/sdk/wasm/vir-upstream.wasm web/public/vir-upstream.wasm
