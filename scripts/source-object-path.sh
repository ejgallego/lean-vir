#!/usr/bin/env bash
#
# Copyright (c) 2026 Lean FRO LLC. All rights reserved.
# Released under Apache 2.0 license as described in the file LICENSE.
# Author: Emilio J. Gallego Arias

# Return a stable object path without embedding an absolute source path in one
# filesystem component. Repository-owned Lean and VIR sources retain their
# relative directory structure for build diagnostics. Arbitrary client and
# external providers use a full SHA-256 identity in one bounded basename.
vir_object_path_for_source() {
  local obj_dir="$1"
  local lean_source_root="${2%/}"
  local vir_source_root="${3%/}"
  local client_source_root="${4%/}"
  local source="$5"
  local relative

  if [[ "$source" == "$lean_source_root/"* ]]; then
    relative="${source#"$lean_source_root/"}"
    printf '%s/lean/%s.o\n' "$obj_dir" "$relative"
  elif [[ "$source" == "$vir_source_root/"* ]]; then
    relative="${source#"$vir_source_root/"}"
    printf '%s/vir/%s.o\n' "$obj_dir" "$relative"
  elif [ -n "$client_source_root" ] && [[ "$source" == "$client_source_root/"* ]]; then
    vir_hashed_object_path "$obj_dir" "client:${source#"$client_source_root/"}"
  elif [[ "$source" == /* ]]; then
    vir_hashed_object_path "$obj_dir" "external:$source"
  else
    relative="${source#./}"
    printf '%s/vir/%s.o\n' "$obj_dir" "$relative"
  fi
}

vir_hashed_object_path() {
  local obj_dir="$1"
  local identity="$2"
  local digest
  digest="$(printf '%s' "$identity" | sha256sum)"
  digest="${digest%% *}"
  printf '%s/source-%s.o\n' "$obj_dir" "$digest"
}
