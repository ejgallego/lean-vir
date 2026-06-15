#!/usr/bin/env bash
#
# Copyright (c) 2026 Lean FRO LLC. All rights reserved.
# Released under Apache 2.0 license as described in the file LICENSE.
# Author: Emilio J. Gallego Arias

set -euo pipefail

cd "$(dirname "$0")/.."

out="build/lean-lib"
lean_lib="$(lean --print-prefix)/lib/lean"
toolchain_id="$(lean --version)"
toolchain_stamp="$out/.lean-toolchain-version"
rebuild_all=0

if [ ! -f "$toolchain_stamp" ] || [ "$(cat "$toolchain_stamp")" != "$toolchain_id" ]; then
  rebuild_all=1
fi

# Drop stale project-owned module outputs from superseded import layouts.
stale_namespace_root="Lean"
stale_module_root="Vir"
stale_flat_root="${stale_namespace_root}${stale_module_root}"
stale_layouts=(
  "$out/$stale_flat_root"
  "$out/$stale_flat_root.olean"
  "$out/$stale_flat_root.ilean"
  "$out/$stale_namespace_root/$stale_module_root"
)
rm -rf \
  "${stale_layouts[@]}"

mkdir -p "$out/Lean"

for entry in "$lean_lib"/*; do
  base="$(basename "$entry")"
  if [ "$base" = "Lean" ]; then
    continue
  fi
  ln -sfn "$entry" "$out/$base"
done

for entry in "$lean_lib/Lean"/*; do
  base="$(basename "$entry")"
  ln -sfn "$entry" "$out/Lean/$base"
done

build_module() {
  local source="$1"
  local module="${source%.lean}"
  local olean="$out/$module.olean"
  local ilean="$out/$module.ilean"
  mkdir -p "$(dirname "$olean")"
  if [ "$rebuild_all" = 1 ] || [ ! -f "$olean" ] || [ "$source" -nt "$olean" ]; then
    echo "compile $source"
    LEAN_PATH="$out${LEAN_PATH:+:$LEAN_PATH}" lean -o "$olean" -i "$ilean" "$source"
    rebuild_all=1
  fi
}

build_module Vir/Host.lean
build_module Vir/Js.lean
build_module Vir/Common.lean
build_module Vir/Browser.lean
build_module Vir/React.lean
build_module Vir/GeneratePackage.lean
build_module Vir.lean

for stale in "${stale_layouts[@]}"; do
  if [ -e "$stale" ]; then
    echo "stale Lean library output remains: $stale" >&2
    exit 1
  fi
done

printf '%s\n' "$toolchain_id" > "$toolchain_stamp"
