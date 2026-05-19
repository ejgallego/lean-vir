#!/usr/bin/env bash
#
# Copyright (c) 2026 Lean FRO LLC. All rights reserved.
# Released under Apache 2.0 license as described in the file LICENSE.
# Author: Emilio J. Gallego Arias

set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p third_party

if [ -d third_party/lean4-src/.git ]; then
  git -C third_party/lean4-src fetch --depth 1 origin v4.30.0-rc2
  git -C third_party/lean4-src checkout 3dc1a088b6d2d8eafe25a7cd7ec7b58d731bd7cc
else
  git clone --depth 1 --branch v4.30.0-rc2 https://github.com/leanprover/lean4.git third_party/lean4-src
fi

echo "Lean source ready at third_party/lean4-src"
