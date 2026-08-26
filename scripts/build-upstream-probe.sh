#!/usr/bin/env bash
#
# Copyright (c) 2026 Lean FRO LLC. All rights reserved.
# Released under Apache 2.0 license as described in the file LICENSE.
# Author: Emilio J. Gallego Arias

set -euo pipefail

cd "$(dirname "$0")/.."
source scripts/source-object-path.sh
script_start=$SECONDS

out="build/upstream-probe"
mkdir -p "$out"

effective_tools_tmp="$out/effective-wasm-tools.tmp"
if ! node scripts/wasm-build-identity.mjs --print-tools0 > "$effective_tools_tmp"; then
  rm -f "$effective_tools_tmp"
  exit 1
fi
mapfile -d '' -t effective_wasm_tools < "$effective_tools_tmp"
rm -f "$effective_tools_tmp"
if [ "${#effective_wasm_tools[@]}" -ne 7 ]; then
  echo "error: effective Wasm tool resolver returned ${#effective_wasm_tools[@]} fields; expected 7" >&2
  exit 1
fi

src="${effective_wasm_tools[0]}"
resolved_wasi_sdk="${effective_wasm_tools[1]}"
cxx="${effective_wasm_tools[2]}"
wasm_ld="${effective_wasm_tools[3]}"
llvm_nm="${effective_wasm_tools[4]}"
lean_prefix="${effective_wasm_tools[5]}"
llvm_objcopy="${effective_wasm_tools[6]}"

if [ -n "$resolved_wasi_sdk" ]; then
  export WASI_SDK_PATH="$resolved_wasi_sdk"
  export PATH="$WASI_SDK_PATH/bin:$PATH"
else
  unset WASI_SDK_PATH
fi
export LEAN4_SRC="$src"
export CXX="$cxx"
export WASM_LD="$wasm_ld"
export LLVM_NM="$llvm_nm"
export LEAN_PREFIX="$lean_prefix"

if [ ! -f "$src/src/library/ir_interpreter.cpp" ]; then
  echo "error: Lean source not found at $src; run npm run fetch:lean first" >&2
  exit 1
fi

target="${WASI_TARGET:-wasm32-wasip1}"
wasm_opt_level="${VIR_WASM_OPT_LEVEL:--O3}"
wasm_profile="${VIR_WASM_PROFILE:-dev}"
wasm_initial_memory="${VIR_WASM_INITIAL_MEMORY:-4194304}"
wasm_stack_size="${VIR_WASM_STACK_SIZE:-1048576}"
upstream="$src/src/library/ir_interpreter.cpp"
upstream_session="wasm/upstream_shim/interpreter/persistent_ir_interpreter.cpp"
overlay_include="$out/include"
obj_dir="$out/obj"
generated_dir="$out/generated"
generated_native_wrappers="$generated_dir/native_wrappers.cpp"
generated_native_registry="$generated_dir/native_wrappers_registry.inc"
generated_native_provider_sources="$generated_dir/native-provider-sources.txt"
generated_native_provider_symbols="$generated_dir/native-provider-symbols.tsv"
wasm="$out/ir_interpreter.allow-undefined.wasm"
strict_wasm="$out/ir_interpreter.strict.wasm"
demo_wasm="web/public/vir-upstream.wasm"
demo_dev_wasm="web/public/vir-upstream.dev.wasm"
demo_wasm_stamp="$out/demo-wasm-profile.stamp"
demo_dev_wasm_stamp="$out/demo-wasm-dev.stamp"
wasm_build_identity="$out/wasm-build-identity.json"
wasm_build_identity_tmp="$wasm_build_identity.tmp"
node scripts/wasm-build-identity.mjs --print-identity > "$wasm_build_identity_tmp"
if ! cmp -s "$wasm_build_identity_tmp" "$wasm_build_identity"; then
  mv "$wasm_build_identity_tmp" "$wasm_build_identity"
else
  rm "$wasm_build_identity_tmp"
fi
strict_log="$out/strict-link.log"
link_map="$out/link.map"
import_section="$out/import-section.txt"
env_imports="$out/env-imports.txt"
wasi_imports="$out/wasi-imports.txt"
unresolved="$out/unresolved-symbols.txt"
allowed_undefined="$out/allowed-js-imports.txt"
report="$out/boundary.md"
mapfile -t browser_packages < <(
  node -e 'const cfg = require("./fixtures/browser-packages.json"); for (const pkg of cfg.packages ?? []) console.log(pkg.file)'
)

case "$wasm_profile" in
  dev)
    wasm_output_profile=dev
    ;;
  dist | production | release)
    wasm_output_profile=release
    ;;
  *)
    echo "error: unsupported VIR_WASM_PROFILE '$wasm_profile'; expected dev, dist, release, or production" >&2
    exit 1
    ;;
esac

mkdir -p "$out"
mkdir -p "$obj_dir"
mkdir -p "$generated_dir"
mkdir -p "$overlay_include/lean"
mkdir -p web/public

npm run --silent generate:ir-codec-tags
npm run --silent generate:boundary-registry

cat > "$allowed_undefined" <<'EOF'
vir_js_call_objects
vir_resource_get
vir_resource_is_owned
vir_resource_release
vir_resource_root
EOF

package_start=$SECONDS
skip_packages="${VIR_SKIP_PACKAGES:-0}"
case "$skip_packages" in
  0)
    npm run --silent generate:package
    for package in "${browser_packages[@]}"; do
      generated_package="build/generated/$package"
      demo_package="web/public/$package"
      if ! cmp -s "$generated_package" "$demo_package"; then
        cp "$generated_package" "$demo_package"
      fi
    done
    ;;
  1)
    echo "skip browser package generation (VIR_SKIP_PACKAGES=1)"
    ;;
  *)
    echo "error: VIR_SKIP_PACKAGES must be 0 or 1, got '$skip_packages'" >&2
    exit 1
    ;;
esac
package_seconds=$((SECONDS - package_start))

wrapper_generation_start=$SECONDS
lake build vir_native_wrappers
native_extern_extras_file="${VIR_NATIVE_EXTERN_EXTRAS_FILE:-}"
client_native_extern_manifest="${VIR_NATIVE_EXTERN_MANIFEST:-}"
if [ -n "$native_extern_extras_file" ] && [ -n "$client_native_extern_manifest" ]; then
  echo "error: VIR_NATIVE_EXTERN_EXTRAS_FILE and VIR_NATIVE_EXTERN_MANIFEST are mutually exclusive" >&2
  exit 1
fi
client_native_provider_sources=()
client_native_provider_names=()
client_native_provider_symbols=()
client_native_project=""
: > "$generated_native_provider_sources"
: > "$generated_native_provider_symbols"
if [ -n "$client_native_extern_manifest" ]; then
  if [ ! -f "$client_native_extern_manifest" ]; then
    echo "error: client-native extern manifest not found: $client_native_extern_manifest" >&2
    exit 1
  fi
  client_native_extern_manifest="$(realpath "$client_native_extern_manifest")"
  client_native_project="$(dirname "$client_native_extern_manifest")"
  client_native_lean_path="$(lake -d "$client_native_project" env printenv LEAN_PATH)"
  vir_lean_path="$PWD/.lake/build/lib/lean"
  LEAN_PATH="$vir_lean_path${client_native_lean_path:+:$client_native_lean_path}" \
    .lake/build/bin/vir_native_wrappers \
    --manifest "$client_native_extern_manifest" \
    "$generated_native_wrappers" \
    "$generated_native_registry" \
    "$generated_native_provider_sources" \
    "$generated_native_provider_symbols"
  mapfile -t client_native_provider_sources < "$generated_native_provider_sources"
  while IFS=$'\t' read -r lean_name symbol; do
    if [ -z "$lean_name" ] || [ -z "$symbol" ]; then
      echo "error: malformed generated client-native provider symbol row" >&2
      exit 1
    fi
    client_native_provider_names+=("$lean_name")
    client_native_provider_symbols+=("$symbol")
  done < "$generated_native_provider_symbols"
elif [ -n "$native_extern_extras_file" ]; then
  lake env .lake/build/bin/vir_native_wrappers \
    --extras "$native_extern_extras_file" \
    "$generated_native_wrappers" \
    "$generated_native_registry"
else
  lake env .lake/build/bin/vir_native_wrappers \
    "$generated_native_wrappers" \
    "$generated_native_registry"
fi
wrapper_generation_seconds=$((SECONDS - wrapper_generation_start))

src_commit="unknown"
if git -C "$src" rev-parse HEAD >/dev/null 2>&1; then
  src_commit="$(git -C "$src" rev-parse HEAD)"
fi

config_h="$overlay_include/lean/config.h"
config_tmp="$config_h.tmp"
cat > "$config_tmp" <<'EOF'
/*
Generated by scripts/build-upstream-probe.sh.

The installed Lean host headers enable LEAN_MIMALLOC, but the pinned Lean
source checkout does not vendor mimalloc sources for a WASI rebuild. For the
probe we compile the real Lean runtime sources through their non-mimalloc
allocator path.
*/
#pragma once
#include <lean/version.h>

#define LEAN_IS_STAGE0 0
EOF
if ! cmp -s "$config_tmp" "$config_h"; then
  mv "$config_tmp" "$config_h"
else
  rm "$config_tmp"
fi

githash_h="$overlay_include/githash.h"
githash_tmp="$githash_h.tmp"
cat > "$githash_tmp" <<EOF
/* Generated by scripts/build-upstream-probe.sh. */
#pragma once
#define LEAN_GITHASH "$src_commit"
EOF
if ! cmp -s "$githash_tmp" "$githash_h"; then
  mv "$githash_tmp" "$githash_h"
else
  rm "$githash_tmp"
fi

runtime_sources=(
  "$src/src/runtime/alloc.cpp"
  "$src/src/runtime/apply.cpp"
  "$src/src/runtime/exception.cpp"
  "$src/src/runtime/hash.cpp"
  "$src/src/runtime/mpn.cpp"
  "$src/src/runtime/mpz.cpp"
  "$src/src/runtime/object.cpp"
  "$src/src/runtime/object_ref.cpp"
  "$src/src/runtime/platform.cpp"
  "$src/src/runtime/utf8.cpp"
)

support_sources=(
  "$src/src/util/name.cpp"
  "$src/src/util/kvmap.cpp"
  "$src/src/kernel/level.cpp"
  "$src/src/kernel/expr.cpp"
  "$src/src/kernel/expr_eq_fn.cpp"
  "$src/stage0/stdlib/Lean/Data/KVMap.c"
)

lean_stage0_support_root="$src/stage0/stdlib/Init"
lean_stage0_support_manifest="wasm/upstream_shim/native-support-sources.txt"
lean_stage0_support_sources=()
while IFS= read -r relative_path; do
  case "$relative_path" in
    "" | \#*) continue ;;
  esac
  source="$lean_stage0_support_root/$relative_path"
  if [ ! -f "$source" ]; then
    echo "error: native support source not found: $source" >&2
    exit 1
  fi
  lean_stage0_support_sources+=("$source")
done < "$lean_stage0_support_manifest"

local_native_support_sources=(
  "wasm/upstream_shim/runtime/lean_object_constructors.cpp"
  "wasm/upstream_shim/runtime/native_symbols.cpp"
)

shim_sources=(
  "wasm/upstream_shim/abi/resource_abi.cpp"
  "wasm/upstream_shim/interpreter/interpreter_bridge.cpp"
  "wasm/upstream_shim/abi/call_abi.cpp"
  "wasm/upstream_shim/runtime/name_utils.cpp"
  "wasm/upstream_shim/abi/object_abi.cpp"
  "wasm/upstream_shim/abi/object_expr_abi.cpp"
  "wasm/upstream_shim/abi/closure_abi.cpp"
  "wasm/upstream_shim/package/host_import_trampolines.cpp"
  "wasm/upstream_shim/runtime/native_symbol_lookup.cpp"
  "wasm/upstream_shim/runtime/runtime_environment_stubs.cpp"
  "wasm/upstream_shim/package/package_init_bridge.cpp"
  "wasm/upstream_shim/package/package_loader_abi.cpp"
  "wasm/upstream_shim/runtime/runtime_value_stubs.cpp"
  "wasm/upstream_shim/runtime/io_stubs.cpp"
  "wasm/upstream_shim/package/package_ir_builders.cpp"
  "wasm/upstream_shim/package/package_section_directory.cpp"
  "wasm/upstream_shim/package/package_ir_decoder.cpp"
  "wasm/upstream_shim/package/package_decl_provider.cpp"
)

shim_deps=(
  "wasm/upstream_shim/package/decl_provider.h"
  "wasm/upstream_shim/interpreter/interpreter_bridge.h"
  "wasm/upstream_shim/package/package_binary_reader.h"
  "wasm/upstream_shim/package/package_decl_provider_types.h"
  "wasm/upstream_shim/package/package_ir_builders.h"
  "build/generated/wasm/package/package_ir_tags.h"
  "wasm/upstream_shim/package/package_section_directory.h"
  "wasm/upstream_shim/runtime/name_utils.h"
  "wasm/upstream_shim/abi/resource_abi.h"
)

native_symbol_lookup_deps=(
  "build/generated/wasm/runtime/native_symbols_registry.inc"
  "$generated_native_registry"
)

common_flags=(
  "--target=$target"
  -DNDEBUG
  -DLEAN_BUILD_TYPE=Release
  -DVIR_USE_UPSTREAM_KERNEL_EXPR_DATA=1
  "$wasm_opt_level"
  -DLEAN_DEFAULT_INTERPRETER_PREFER_NATIVE=false
  "-I$overlay_include"
  "-I$src/src/include"
  "-I$lean_prefix/include"
  "-I$src/src"
  "-I$generated_dir"
  -Ibuild/generated/wasm/package
  -Ibuild/generated/wasm/runtime
  -Iwasm/upstream_shim
  -ffunction-sections
  -fdata-sections
)

compile_stamp="$obj_dir/compile-flags.stamp"
compile_stamp_tmp="$compile_stamp.tmp"
{
  printf 'compiler=%s\n' "$cxx"
  printf 'lean_prefix=%s\n' "$lean_prefix"
  printf 'lean_source_commit=%s\n' "$src_commit"
  printf 'build_identity='
  cat "$wasm_build_identity"
  printf 'wasi_target=%s\n' "$target"
  printf 'opt_level=%s\n' "$wasm_opt_level"
  printf 'cpp_standard=%s\n' c++20
  printf 'client_c_standard=%s\n' c11
  printf 'flag=%s\n' "${common_flags[@]}"
} > "$compile_stamp_tmp"
if ! cmp -s "$compile_stamp_tmp" "$compile_stamp"; then
  mv "$compile_stamp_tmp" "$compile_stamp"
else
  rm "$compile_stamp_tmp"
fi

object_for_source() {
  local source="$1"
  vir_object_path_for_source "$obj_dir" "$src" "$PWD" "$client_native_project" "$source"
}

compile_one() {
  local source="$1"
  local object="$2"
  shift 2
  local needs_compile=0
  if [ ! -f "$object" ] || [ "$source" -nt "$object" ] || [ "$config_h" -nt "$object" ] || [ "$compile_stamp" -nt "$object" ]; then
    needs_compile=1
  else
    for dep in "$@"; do
      if [ "$dep" -nt "$object" ]; then
        needs_compile=1
        break
      fi
    done
  fi
  if [ "$needs_compile" = "1" ]; then
    local language_flags=(-std=c++20)
    if [[ "$source" == *.c ]]; then
      local is_client_provider=0
      for provider_source in "${client_native_provider_sources[@]}"; do
        if [ "$source" = "$provider_source" ]; then
          is_client_provider=1
          break
        fi
      done
      if [ "$is_client_provider" = "1" ]; then
        language_flags=(-x c -std=c11)
      else
        language_flags=(-x c++ -std=c++20)
      fi
    fi
    mkdir -p "$(dirname "$object")"
    echo "compile $source"
    compiled_count=$((compiled_count + 1))
    "$cxx" "${common_flags[@]}" "${language_flags[@]}" -c "$source" -o "$object"
  fi
}

compiled_count=0
compile_start=$SECONDS
upstream_obj="$obj_dir/ir_interpreter.o"
object_files=("$upstream_obj")
compile_one "$upstream_session" "$upstream_obj" "$upstream" \
  "wasm/upstream_shim/interpreter/interpreter_bridge.h"

for source in "${runtime_sources[@]}" "${support_sources[@]}" "${shim_sources[@]}"; do
  object="$(object_for_source "$source")"
  if [ "$source" = "wasm/upstream_shim/runtime/native_symbol_lookup.cpp" ]; then
    compile_one "$source" "$object" "${shim_deps[@]}" "${native_symbol_lookup_deps[@]}"
  elif [[ "$source" == wasm/upstream_shim/* ]]; then
    compile_one "$source" "$object" "${shim_deps[@]}"
  else
    compile_one "$source" "$object"
  fi
  object_files+=("$object")
done

native_support_objects=()
client_native_provider_objects=()
for source in "${local_native_support_sources[@]}" "$generated_native_wrappers" \
    "${client_native_provider_sources[@]}" "${lean_stage0_support_sources[@]}"; do
  object="$(object_for_source "$source")"
  if [[ "$source" == wasm/upstream_shim/* ]]; then
    compile_one "$source" "$object" "${shim_deps[@]}"
  else
    compile_one "$source" "$object"
  fi
  native_support_objects+=("$object")
  for provider_source in "${client_native_provider_sources[@]}"; do
    if [ "$source" = "$provider_source" ]; then
      client_native_provider_objects+=("$object")
      break
    fi
  done
done

client_native_missing_provider_symbols="$obj_dir/client-native-missing-provider-symbols.txt"
: > "$client_native_missing_provider_symbols"
for index in "${!client_native_provider_symbols[@]}"; do
  symbol="${client_native_provider_symbols[$index]}"
  found=0
  for object in "${client_native_provider_objects[@]}"; do
    if "$llvm_nm" --format=posix --defined-only --extern-only "$object" |
        awk -v expected="$symbol" 'NF >= 2 && $1 == expected { found = 1 } END { exit !found }'; then
      found=1
      break
    fi
  done
  if [ "$found" = "0" ]; then
    printf '%s\t%s\n' "${client_native_provider_names[$index]}" "$symbol" \
      >> "$client_native_missing_provider_symbols"
  fi
done
if [ -s "$client_native_missing_provider_symbols" ]; then
  echo "error: client-native provider sources do not define required raw symbols:" >&2
  while IFS=$'\t' read -r lean_name symbol; do
    printf '  - %s (%s)\n' "$lean_name" "$symbol" >&2
  done < "$client_native_missing_provider_symbols"
  exit 1
fi

native_support_duplicate_symbols="$obj_dir/native-support-duplicate-symbols.txt"
native_support_allowed_duplicates="$obj_dir/native-support-allowed-duplicates.txt"
native_support_unexpected_duplicates="$obj_dir/native-support-unexpected-duplicates.txt"
{
  printf '%s\n' l_ByteArray_empty lean_name_mk_numeral lean_name_mk_string
  "$llvm_nm" --format=posix --defined-only --extern-only \
    "$(object_for_source "$generated_native_wrappers")" | awk 'NF >= 2 { print $1 }'
} | sort -u > "$native_support_allowed_duplicates"
{
  for object in "${native_support_objects[@]}"; do
    "$llvm_nm" --format=posix --defined-only --extern-only "$object"
  done
} | awk 'NF >= 2 { print $1 }' | sort | uniq -d > "$native_support_duplicate_symbols"
comm -23 "$native_support_duplicate_symbols" "$native_support_allowed_duplicates" \
  > "$native_support_unexpected_duplicates"
if [ -s "$native_support_unexpected_duplicates" ]; then
  echo "error: unexpected duplicate symbols in native support bundle:" >&2
  sed 's/^/  /' "$native_support_unexpected_duplicates" >&2
  exit 1
fi

native_support_bundle="$obj_dir/native_support.o"
native_support_link_stamp="$obj_dir/native-support-link.stamp"
native_support_link_stamp_tmp="$native_support_link_stamp.tmp"
{
  printf 'wasm_ld=%s\n' "$wasm_ld"
  printf 'build_identity='
  cat "$wasm_build_identity"
  printf 'link_flag=%s\n' --relocatable --allow-undefined --allow-multiple-definition
  printf 'input=%s\n' "${native_support_objects[@]}"
} > "$native_support_link_stamp_tmp"
if ! cmp -s "$native_support_link_stamp_tmp" "$native_support_link_stamp"; then
  mv "$native_support_link_stamp_tmp" "$native_support_link_stamp"
else
  rm "$native_support_link_stamp_tmp"
fi

needs_native_support_link=0
if [ ! -f "$native_support_bundle" ] || [ "$native_support_link_stamp" -nt "$native_support_bundle" ]; then
  needs_native_support_link=1
else
  for object in "${native_support_objects[@]}"; do
    if [ "$object" -nt "$native_support_bundle" ]; then
      needs_native_support_link=1
      break
    fi
  done
fi
if [ "$needs_native_support_link" = "1" ]; then
  echo "link $native_support_bundle"
  # Keep duplicate tolerance inside this bundle. Local exceptions come first,
  # then generated wrappers, then pinned stage0 modules that provide raw bodies.
  "$wasm_ld" \
    --relocatable \
    --allow-undefined \
    --allow-multiple-definition \
    -o "$native_support_bundle" \
    "${native_support_objects[@]}"
fi
object_files+=("$native_support_bundle")
compile_seconds=$((SECONDS - compile_start))
printf '%s\n' "${object_files[@]}" > "$out/objects.txt"

link_objects=(
  "${object_files[@]}"
)

link_flags=(
  -Wl,--no-entry
  -Wl,--gc-sections
  -Wl,--export-memory
  "-Wl,--initial-memory=$wasm_initial_memory"
  "-Wl,-z,stack-size=$wasm_stack_size"
)

exports=(
  -Wl,--export=lean_eval_const
  -Wl,--export=lean_run_init
  -Wl,--export=lean_run_mod_init_core
  -Wl,--export=vir_upstream_target_pointer_bytes
  -Wl,--export=vir_alloc_bytes
  -Wl,--export=vir_free_bytes
  -Wl,--export=vir_begin_ir_package_set
  -Wl,--export=vir_append_ir_package
  -Wl,--export=vir_finish_ir_package_set
  -Wl,--export=vir_last_package_error
  -Wl,--export=vir_last_package_error_size
  -Wl,--export=vir_package_interface_manifest
  -Wl,--export=vir_package_interface_manifest_size
  -Wl,--export=vir_package_decl_count
)

object_abi_export_flags="$obj_dir/object-abi-export-flags.txt"
node scripts/native/object-abi-linker-flags.mjs > "$object_abi_export_flags"
while IFS= read -r export_flag; do
  if [[ -n "$export_flag" ]]; then
    exports+=("$export_flag")
  fi
done < "$object_abi_export_flags"

link_stamp="$obj_dir/link-flags.stamp"
link_stamp_tmp="$link_stamp.tmp"
{
  printf 'wasi_target=%s\n' "$target"
  printf 'initial_memory=%s\n' "$wasm_initial_memory"
  printf 'stack_size=%s\n' "$wasm_stack_size"
  printf 'link_flag=%s\n' "${link_flags[@]}"
  printf 'export=%s\n' "${exports[@]}"
  printf 'allowed_undefined=%s\n' "$(cat "$allowed_undefined")"
  printf 'input=%s\n' "${link_objects[@]}"
} > "$link_stamp_tmp"
if ! cmp -s "$link_stamp_tmp" "$link_stamp"; then
  mv "$link_stamp_tmp" "$link_stamp"
else
  rm "$link_stamp_tmp"
fi

needs_link=0
if [ ! -f "$wasm" ] || [ ! -f "$strict_wasm" ] || [ ! -f "$link_map" ] || [ "$link_stamp" -nt "$strict_wasm" ]; then
  needs_link=1
else
  for object in "${link_objects[@]}"; do
    if [ "$object" -nt "$strict_wasm" ]; then
      needs_link=1
      break
    fi
  done
fi

strict_status=0
link_seconds=0
if [ "$needs_link" = "1" ]; then
  link_start=$SECONDS
  echo "link $wasm"
  "$cxx" "--target=$target" "${link_objects[@]}" \
    "${link_flags[@]}" \
    -Wl,--allow-undefined \
    "${exports[@]}" \
    -o "$wasm"

  echo "link $strict_wasm"
  "$cxx" "--target=$target" "${link_objects[@]}" \
    "${link_flags[@]}" \
    "-Wl,--allow-undefined-file=$allowed_undefined" \
    -Wl,--error-limit=0 \
    "-Wl,--Map=$link_map" \
    "${exports[@]}" \
    -o "$strict_wasm" > "$strict_log" 2>&1 || strict_status=$?
  link_seconds=$((SECONDS - link_start))
else
  strict_status=0
fi

copy_profile_wasm_if_needed() {
  local profile="$1"
  local source="$2"
  local dest="$3"
  local stamp="$4"
  local strip_mode="$5"
  local stamp_tmp="$stamp.tmp"
  {
    printf 'profile=%s\n' "$profile"
    printf 'source=%s\n' "$source"
    if [ "$strip_mode" = "strip" ]; then
      printf 'strip_tool=%s\n' "$llvm_objcopy"
      printf 'strip_flag=--strip-all\n'
    fi
  } > "$stamp_tmp"

  local needs_copy=0
  if [ ! -f "$dest" ] || [ "$source" -nt "$dest" ] || [ ! -f "$stamp" ] || ! cmp -s "$stamp_tmp" "$stamp"; then
    needs_copy=1
  fi

  if [ "$needs_copy" = "1" ]; then
    if [ "$strip_mode" = "strip" ]; then
      "$llvm_objcopy" --strip-all "$source" "$dest"
    else
      cp "$source" "$dest"
    fi
    mv "$stamp_tmp" "$stamp"
    return 0
  else
    rm "$stamp_tmp"
    return 1
  fi
}

copied_demo_wasm=0
copied_demo_dev_wasm=0
if [ "$strict_status" = "0" ]; then
  demo_strip_mode=copy
  if [ "$wasm_output_profile" = "release" ]; then
    demo_strip_mode=strip
  fi

  if copy_profile_wasm_if_needed "$wasm_output_profile" "$strict_wasm" "$demo_wasm" "$demo_wasm_stamp" "$demo_strip_mode"; then
    copied_demo_wasm=1
  fi
  if copy_profile_wasm_if_needed "dev" "$strict_wasm" "$demo_dev_wasm" "$demo_dev_wasm_stamp" "copy"; then
    copied_demo_dev_wasm=1
  fi
fi

if command -v wasm-objdump >/dev/null 2>&1; then
  wasm_objdump=wasm-objdump
elif [ -x node_modules/.bin/wasm-objdump ]; then
  wasm_objdump=node_modules/.bin/wasm-objdump
else
  wasm_objdump=
fi

imports_collected=0
if [ -n "$wasm_objdump" ]; then
  imports_collected=1
  "$wasm_objdump" -x "$wasm" | sed -n '/^Import/,/^Function/p' > "$import_section"
  sed -n 's/^ - func.* <- env\.//p' "$import_section" | sort -u > "$env_imports"
  sed -n 's/^ - func.* <- wasi_snapshot_preview1\.//p' "$import_section" | sort -u > "$wasi_imports"
else
  : > "$import_section"
  : > "$env_imports"
  : > "$wasi_imports"
fi

sed -n 's/.*undefined symbol: //p' "$strict_log" \
  | sort -u > "$unresolved" || true

object_bytes=0
for object in "${link_objects[@]}"; do
  object_bytes=$((object_bytes + $(wc -c < "$object" | tr -d ' ')))
done
object_count="${#link_objects[@]}"
wasm_bytes="$(wc -c < "$wasm" | tr -d ' ')"
unresolved_count="$(wc -l < "$unresolved" | tr -d ' ')"
env_import_count="$(wc -l < "$env_imports" | tr -d ' ')"
wasi_import_count="$(wc -l < "$wasi_imports" | tr -d ' ')"
runtime_source_count="${#runtime_sources[@]}"
support_source_count="${#support_sources[@]}"
generated_source_count=1
lean_stage0_support_source_count="${#lean_stage0_support_sources[@]}"
local_native_support_source_count="${#local_native_support_sources[@]}"
native_support_duplicate_count="$(wc -l < "$native_support_duplicate_symbols" | tr -d ' ')"
shim_source_count="${#shim_sources[@]}"
report_total_seconds=$((SECONDS - script_start))
report_start=$SECONDS

{
  echo "# Upstream IR Interpreter WASI Boundary"
  echo
  echo "This report is generated by \`scripts/build-upstream-probe.sh\`."
  echo
  echo "## Inputs"
  echo
  echo "- Lean source: \`$src\`"
  echo "- Lean source commit: \`$src_commit\`"
  echo "- Lean include prefix: \`$lean_prefix\`"
  echo "- Upstream file: \`$upstream\`"
  echo "- WASI target: \`$target\`"
  echo "- WASM optimization level: \`$wasm_opt_level\`"
  echo "- Requested WASM profile: \`$wasm_profile\`"
  echo "- Browser WASM output profile: \`$wasm_output_profile\`"
  echo "- Compiler: \`$cxx\`"
  echo "- Relocatable linker: \`$wasm_ld\`"
  echo "- Native support symbol inspector: \`$llvm_nm\`"
  echo "- Initial wasm memory: $wasm_initial_memory bytes"
  echo "- Wasm stack size: $wasm_stack_size bytes"
  echo "- Generated config overlay: \`$overlay_include/lean/config.h\`"
  echo "- Object cache: \`$obj_dir\`"
  echo "- Browser package generation skipped: $([ "$skip_packages" = "1" ] && echo "yes" || echo "no")"
  if [ -n "$native_extern_extras_file" ]; then
    echo "- Extra native extern names: \`$native_extern_extras_file\`"
  else
    echo "- Extra native extern names: none"
  fi
  if [ -n "$client_native_extern_manifest" ]; then
    echo "- Client-native extern manifest: \`$client_native_extern_manifest\`"
  else
    echo "- Client-native extern manifest: none"
  fi
  echo "- Real Lean runtime sources linked: $runtime_source_count"
  echo "- Lean support sources linked: $support_source_count"
  echo "- Compiler-generated native wrapper sources linked: $generated_source_count"
  echo "- Pinned Lean stage0 support sources linked: $lean_stage0_support_source_count"
  echo "- Local native support sources linked: $local_native_support_source_count"
  echo "- Client-native provider sources linked: ${#client_native_provider_sources[@]}"
  echo "- Audited duplicate native support symbols: $native_support_duplicate_count"
  echo "- Local WASI shim sources linked: $shim_source_count"
  echo "- Generated browser IR packages:"
  for package in "${browser_packages[@]}"; do
    echo "  - \`build/generated/$package\`"
  done
  echo "- Browser demo IR packages:"
  for package in "${browser_packages[@]}"; do
    echo "  - \`web/public/$package\`"
  done
  echo
  echo "## Timing"
  echo
  echo "- Browser package generation: ${package_seconds}s"
  echo "- Native wrapper generation: ${wrapper_generation_seconds}s"
  echo "- Object compile phase: ${compile_seconds}s"
  echo "- Objects compiled in this run: $compiled_count"
  echo "- Link phase: ${link_seconds}s"
  echo "- Total before report write: ${report_total_seconds}s"
  echo
  echo "## Outputs"
  echo
  echo "- Linked objects: $object_count (${object_bytes} bytes total)"
  echo "- Link reused cached wasm: $([ "$needs_link" = "0" ] && echo "yes" || echo "no")"
  echo "- Allow-undefined wasm with runtime: \`$wasm\` (${wasm_bytes} bytes)"
  if [ "$strict_status" = "0" ]; then
    echo "- Browser default wasm: \`$demo_wasm\` ($([ "$wasm_output_profile" = "release" ] && echo "stripped release" || echo "unstripped dev"))"
    echo "- Browser debug wasm: \`$demo_dev_wasm\` (optimized, unstripped)"
  fi
  echo "- Strict link log: \`$strict_log\`"
  echo "- Strict link map: \`$link_map\`"
  echo "- Strict link status: \`$strict_status\`"
  echo
  echo "## Linked Real Runtime Sources"
  echo
  for path in "${runtime_sources[@]}"; do
    printf -- '- `%s`\n' "$path"
  done
  echo
  echo "## Linked Lean Support Sources"
  echo
  for path in "${support_sources[@]}"; do
    printf -- '- `%s`\n' "$path"
  done
  echo
  echo "## Linked Compiler-Generated Native Wrapper Sources"
  echo
  printf -- '- `%s`\n' "$generated_native_wrappers"
  echo
  echo "## Linked Pinned Lean Stage0 Support Sources"
  echo
  for path in "${lean_stage0_support_sources[@]}"; do
    printf -- '- `%s`\n' "$path"
  done
  echo
  echo "## Linked Local Native Support Sources"
  echo
  for path in "${local_native_support_sources[@]}"; do
    printf -- '- `%s`\n' "$path"
  done
  echo
  echo "## Linked Client-Native Provider Sources"
  echo
  if [ "${#client_native_provider_sources[@]}" = "0" ]; then
    echo "None."
  else
    for path in "${client_native_provider_sources[@]}"; do
      printf -- '- `%s`\n' "$path"
    done
  fi
  echo
  echo "## Audited Native Support Duplicate Symbols"
  echo
  while IFS= read -r sym; do
    printf -- '- `%s`\n' "$sym"
  done < "$native_support_duplicate_symbols"
  echo
  echo "## Linked Local Shim Sources"
  echo
  for path in "${shim_sources[@]}"; do
    printf -- '- `%s`\n' "$path"
  done
  echo
  echo "## Runtime Config Overlay"
  echo
  echo "The WASI probe compiles the real Lean runtime source files with a generated"
  echo "\`lean/config.h\` that leaves \`LEAN_MIMALLOC\` disabled. The pinned Lean"
  echo "source checkout provides the runtime source but not a vendored mimalloc source"
  echo "tree suitable for this local WASI rebuild."
  echo
  echo "## Boundary Summary"
  echo
  echo "- Strict unresolved symbols: $unresolved_count"
  if [ "$imports_collected" = "1" ]; then
    echo "- Imported \`env\` symbols in allow-undefined wasm: $env_import_count"
    echo "- Imported WASI symbols in allow-undefined wasm: $wasi_import_count"
  else
    echo "- Allow-undefined import scan: not collected; \`wasm-objdump\` was not available"
  fi
  echo
  echo "## Strict Unresolved Symbols"
  echo
  if [ "$unresolved_count" = "0" ]; then
    echo "None."
  else
    while IFS= read -r sym; do
      printf -- '- `%s`\n' "$sym"
    done < "$unresolved"
  fi
  echo
  echo "## Allow-Undefined \`env\` Imports"
  echo
  if [ "$imports_collected" != "1" ]; then
    echo "Not collected; \`wasm-objdump\` was not available."
  elif [ "$env_import_count" = "0" ]; then
    echo "None."
  else
    while IFS= read -r sym; do
      printf -- '- `%s`\n' "$sym"
    done < "$env_imports"
  fi
  echo
  echo "## Allow-Undefined WASI Imports"
  echo
  if [ "$imports_collected" != "1" ]; then
    echo "Not collected; \`wasm-objdump\` was not available."
  elif [ "$wasi_import_count" = "0" ]; then
    echo "None."
  else
    while IFS= read -r sym; do
      printf -- '- `%s`\n' "$sym"
    done < "$wasi_imports"
  fi
  echo
  echo "## Demo Policy"
  echo
  echo "- Keep \`src/library/ir_interpreter.cpp\` unmodified."
  echo "- Provide real Lean IR declaration objects through \`lean_ir_find_env_decl\`."
  echo "- Stub only runtime/library pieces that the current demo paths do not execute."
  echo "- Keep general native symbol lookup unsupported; register only demo externs explicitly."
  echo
  echo "## Current Shim Scope"
  echo
  echo "\`wasm/upstream_shim/interpreter/persistent_ir_interpreter.cpp\` compiles the"
  echo "untouched pinned interpreter with a package-scoped session."
  echo "\`wasm/upstream_shim/interpreter/interpreter_bridge.cpp\` supplies interpreter"
  echo "initialization and declaration lookup hooks. \`abi/call_abi.cpp\`"
  echo "supplies the package call surface. \`abi/closure_abi.cpp\` supplies Lean"
  echo "closure roots and callback calls. \`package/host_import_trampolines.cpp\` supplies the"
  echo "package-scoped JavaScript host-import trampoline grid."
  echo "\`package/package_decl_provider.cpp\` owns direct package-call summaries,"
  echo "including arity, IO, and boxed-boundary requirements. \`runtime/name_utils.cpp\` contains shared"
  echo "Lean name construction helpers. \`abi/object_abi.cpp\` supplies generic owned"
  echo "Lean object helpers, \`abi/object_expr_abi.cpp\` supplies temporary Level/Expr"
  echo "helpers, and \`abi/resource_abi.cpp\` supplies JavaScript resource helpers used"
  echo "by the runtime object-call path."
  echo "\`wasm/upstream_shim/runtime/native_symbols.cpp\` supplies shim-specific native"
  echo "extern wrappers. \`$generated_native_wrappers\` supplies standard boxed adapters"
  echo "emitted by Lean's compiler. Pinned stage0 sources supply selected Lean-defined raw"
  echo "exports. These inputs are prelinked with audited, bundle-local duplicate handling."
  echo "\`runtime/native_symbol_lookup.cpp\` supplies the registries,"
  echo "include, restricted \`dlsym\` lookup, symbol-stem lookup, and C++ exception"
  echo "stubs. \`runtime/runtime_environment_stubs.cpp\`, \`package/package_init_bridge.cpp\`,"
  echo "\`runtime/runtime_value_stubs.cpp\`, and \`runtime/io_stubs.cpp\` contain the remaining"
  echo "host/platform stubs. \`package/package_loader_abi.cpp\` supplies the package-load"
  echo "WASM exports. \`package/package_section_directory.cpp\` reads the v10"
  echo "package section directory. \`package/package_ir_decoder.cpp\` decodes"
  echo "the \`build/generated/*.irpkg\` packages emitted from typed"
  echo "\`Lean.IR.Decl\` values by \`tools/GeneratePackage.lean\`; \`package/package_ir_builders.cpp\`"
  echo "materializes the decoded IR as Lean objects. \`package/package_decl_provider.cpp\` owns the loaded package state and"
  echo "declaration lookup facade. The browser demos run through the real upstream"
  echo "interpreter."
} > "$report"
report_seconds=$((SECONDS - report_start))

echo "wrote $report"
if [ "$copied_demo_wasm" = "1" ]; then
  echo "wrote $demo_wasm (default, $wasm_output_profile)"
fi
if [ "$copied_demo_dev_wasm" = "1" ]; then
  echo "wrote $demo_dev_wasm (debug, optimized unstripped)"
fi
echo "strict unresolved symbols: $unresolved_count"
echo "upstream probe timing: packages=${package_seconds}s wrappers=${wrapper_generation_seconds}s compile=${compile_seconds}s link=${link_seconds}s report=${report_seconds}s total=$((SECONDS - script_start))s compiled_objects=$compiled_count link_reused=$([ "$needs_link" = "0" ] && echo "yes" || echo "no")"
if [ "$strict_status" != "0" ]; then
  exit "$strict_status"
fi
