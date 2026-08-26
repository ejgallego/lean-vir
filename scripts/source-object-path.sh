#!/usr/bin/env bash
#
# Copyright (c) 2026 Lean FRO LLC. All rights reserved.
# Released under Apache 2.0 license as described in the file LICENSE.
# Author: Emilio J. Gallego Arias

# Return a stable object path without embedding an absolute source path in one
# filesystem component. Known source roots use relative identities so moving a
# checkout or SDK cache does not invalidate otherwise identical object names.
vir_object_path_for_source() {
  local obj_dir="$1"
  local lean_source_root="${2%/}"
  local vir_source_root="${3%/}"
  local client_source_root="${4%/}"
  local source="$5"
  local identity

  if [[ "$source" == "$lean_source_root/"* ]]; then
    identity="lean:${source#"$lean_source_root/"}"
  elif [[ "$source" == "$vir_source_root/"* ]]; then
    identity="vir:${source#"$vir_source_root/"}"
  elif [ -n "$client_source_root" ] && [[ "$source" == "$client_source_root/"* ]]; then
    identity="client:${source#"$client_source_root/"}"
  elif [[ "$source" == /* ]]; then
    identity="external:$source"
  else
    identity="vir:${source#./}"
  fi

  local digest
  digest="$(printf '%s' "$identity" | sha256sum)"
  digest="${digest%% *}"
  printf '%s/source-%s.o\n' "$obj_dir" "$digest"
}
