#!/usr/bin/env bash
#
# Copyright (c) 2026 Lean FRO LLC. All rights reserved.
# Released under Apache 2.0 license as described in the file LICENSE.
# Author: Emilio J. Gallego Arias

set -euo pipefail

cd "$(dirname "$0")/.."

out="build/lean-lib"
lean_lib="$(lean --print-prefix)/lib/lean"
mkdir -p "$out/Lean/Vir"

for entry in "$lean_lib"/*; do
  base="$(basename "$entry")"
  if [ "$base" = "Lean" ]; then
    continue
  fi
  if [ ! -e "$out/$base" ]; then
    ln -s "$entry" "$out/$base"
  fi
done

for entry in "$lean_lib/Lean"/*; do
  base="$(basename "$entry")"
  if [ "$base" = "Vir" ]; then
    continue
  fi
  if [ ! -e "$out/Lean/$base" ]; then
    ln -s "$entry" "$out/Lean/$base"
  fi
done

build_module() {
  local source="$1"
  local module="${source%.lean}"
  local olean="$out/$module.olean"
  local ilean="$out/$module.ilean"
  mkdir -p "$(dirname "$olean")"
  if [ ! -f "$olean" ] || [ "$source" -nt "$olean" ]; then
    echo "compile $source"
    LEAN_PATH="$out${LEAN_PATH:+:$LEAN_PATH}" lean -o "$olean" -i "$ilean" "$source"
  fi
}

build_module Lean/Vir/Host.lean
build_module Lean/Vir/Common.lean
build_module Lean/Vir/Browser.lean
