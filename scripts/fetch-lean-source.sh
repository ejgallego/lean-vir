#!/usr/bin/env bash
#
# Copyright (c) 2026 Lean FRO LLC. All rights reserved.
# Released under Apache 2.0 license as described in the file LICENSE.
# Author: Emilio J. Gallego Arias

set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p third_party

LEAN_TOOLCHAIN="$(< lean-toolchain)"
case "${LEAN_TOOLCHAIN}" in
  leanprover/lean4:v*)
    LEAN_VERSION="${LEAN_TOOLCHAIN#leanprover/lean4:}"
    LEAN_REPO="https://github.com/leanprover/lean4.git"
    ;;
  leanprover/lean4-nightly:nightly-????-??-??)
    LEAN_VERSION="${LEAN_TOOLCHAIN#leanprover/lean4-nightly:}"
    LEAN_REPO="https://github.com/leanprover/lean4-nightly.git"
    ;;
  *)
    echo "unsupported Lean toolchain: ${LEAN_TOOLCHAIN}" >&2
    exit 1
    ;;
esac

if [ -d third_party/lean4-src/.git ]; then
  git -C third_party/lean4-src fetch --depth 1 "${LEAN_REPO}" "${LEAN_VERSION}"
  git -C third_party/lean4-src checkout --detach FETCH_HEAD
else
  git clone --depth 1 --branch "${LEAN_VERSION}" "${LEAN_REPO}" third_party/lean4-src
fi

LEAN_SOURCE_REVISION="$(git -C third_party/lean4-src rev-parse HEAD)"
LEAN_COMPILER_REVISION="$(lean --githash)"
if [ "${LEAN_SOURCE_REVISION}" != "${LEAN_COMPILER_REVISION}" ]; then
  echo "Lean source does not match the pinned compiler revision" >&2
  exit 1
fi

echo "Lean source ready at third_party/lean4-src"
