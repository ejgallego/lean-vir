#!/usr/bin/env bash
#
# Copyright (c) 2026 Lean FRO LLC. All rights reserved.
# Released under Apache 2.0 license as described in the file LICENSE.
# Author: Emilio J. Gallego Arias

set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p third_party

LEAN_VERSION=v4.32.0-rc1

if [ -d third_party/lean4-src/.git ]; then
  git -C third_party/lean4-src fetch --depth 1 origin "${LEAN_VERSION}"
else
  git clone --depth 1 --branch "${LEAN_VERSION}" https://github.com/leanprover/lean4.git third_party/lean4-src
fi

git -C third_party/lean4-src checkout b4812ae53eea93439ad5dce5a5c26591c31cb697

echo "Lean source ready at third_party/lean4-src"
