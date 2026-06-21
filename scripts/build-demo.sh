#!/usr/bin/env bash
#
# Copyright (c) 2026 Lean FRO LLC. All rights reserved.
# Released under Apache 2.0 license as described in the file LICENSE.
# Author: Emilio J. Gallego Arias

set -euo pipefail

cd "$(dirname "$0")/.."

npm run build:infoview

# Vir.Infoview embeds the generated JavaScript bundle with `include_str`.
# Lake does not currently rebuild this module just because that included file
# changed, so refresh only the generated artifacts for the embedding module.
rm -f \
  .lake/build/lib/lean/Vir/Infoview.olean \
  .lake/build/lib/lean/Vir/Infoview.olean.hash \
  .lake/build/lib/lean/Vir/Infoview.ilean \
  .lake/build/lib/lean/Vir/Infoview.ilean.hash \
  .lake/build/lib/lean/Vir/Infoview.trace \
  .lake/build/ir/Vir/Infoview.c \
  .lake/build/ir/Vir/Infoview.c.hash \
  .lake/build/ir/Vir/Infoview.setup.json

lake build Vir
npm run probe:upstream
