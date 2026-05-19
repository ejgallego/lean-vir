#!/usr/bin/env bash
#
# Copyright (c) 2026 Lean FRO LLC. All rights reserved.
# Released under Apache 2.0 license as described in the file LICENSE.
# Author: Emilio J. Gallego Arias

set -euo pipefail

cd "$(dirname "$0")/.."

src="${LEAN4_SRC:-third_party/lean4-src}"
out="build/upstream-probe"
obj_dir="$out/obj"
objects_file="$out/objects.txt"
demo_package="web/public/vir-demo.irpkg"
package_header="$out/vir_demo_package.inc"
bench_source="wasm/upstream_shim/engine_bench.cpp"
bench_object="$obj_dir/wasm_upstream_shim_engine_bench.o"
bench_wasm="$out/vir-engine-bench.wasm"

bash scripts/build-upstream-probe.sh

local_wasi_sdk="$PWD/.tools/wasi-sdk"
if [ -z "${WASI_SDK_PATH:-}" ] && [ -x "$local_wasi_sdk/bin/clang++" ]; then
  export WASI_SDK_PATH="$local_wasi_sdk"
fi

if [ -n "${WASI_SDK_PATH:-}" ] && [ -x "$WASI_SDK_PATH/bin/clang++" ]; then
  export PATH="$WASI_SDK_PATH/bin:$PATH"
  cxx="${CXX:-$WASI_SDK_PATH/bin/clang++}"
elif [ -n "${CXX:-}" ]; then
  cxx="$CXX"
else
  echo "error: clang++ not found. Run npm run install:wasi or set WASI_SDK_PATH." >&2
  exit 1
fi

if ! command -v xxd >/dev/null 2>&1; then
  echo "error: xxd is required to embed $demo_package" >&2
  exit 1
fi

lean_prefix="${LEAN_PREFIX:-$(lean --print-prefix)}"
target="${WASI_TARGET:-wasm32-wasip1}"
wasm_opt_level="${VIR_WASM_OPT_LEVEL:--O3}"
wasm_initial_memory="${VIR_WASM_INITIAL_MEMORY:-4194304}"
wasm_stack_size="${VIR_WASM_STACK_SIZE:-1048576}"
overlay_include="$out/include"

package_header_tmp="$package_header.tmp"
xxd -i -n vir_demo_ir_package "$demo_package" > "$package_header_tmp"
if ! cmp -s "$package_header_tmp" "$package_header"; then
  mv "$package_header_tmp" "$package_header"
else
  rm "$package_header_tmp"
fi

common_flags=(
  "--target=$target"
  -std=c++20
  -DNDEBUG
  "$wasm_opt_level"
  -DLEAN_DEFAULT_INTERPRETER_PREFER_NATIVE=false
  "-I$overlay_include"
  "-I$src/src/include"
  "-I$lean_prefix/include"
  "-I$src/src"
  -Iwasm/upstream_shim
  "-I$out"
  -ffunction-sections
  -fdata-sections
)

if [ ! -f "$bench_object" ] || [ "$bench_source" -nt "$bench_object" ] || [ "$package_header" -nt "$bench_object" ]; then
  echo "compile $bench_source"
  "$cxx" "${common_flags[@]}" -c "$bench_source" -o "$bench_object"
fi

mapfile -t link_objects < "$objects_file"
needs_link=0
if [ ! -f "$bench_wasm" ] || [ "$bench_object" -nt "$bench_wasm" ]; then
  needs_link=1
else
  for object in "${link_objects[@]}"; do
    if [ "$object" -nt "$bench_wasm" ]; then
      needs_link=1
      break
    fi
  done
fi

if [ "$needs_link" = "1" ]; then
  echo "link $bench_wasm"
  "$cxx" "--target=$target" "${link_objects[@]}" "$bench_object" \
    -Wl,--gc-sections \
    "-Wl,--initial-memory=$wasm_initial_memory" \
    "-Wl,-z,stack-size=$wasm_stack_size" \
    -o "$bench_wasm"
fi

echo "wrote $bench_wasm"
