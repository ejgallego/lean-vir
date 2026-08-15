#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
lean_src="${LEAN4_SRC:-$repo_root/third_party/lean4-src}"
lean_prefix="$(lean --print-prefix)"

if [[ ! -f "$lean_src/src/library/ir_types.h" ]]; then
  echo "error: Lean source not found at $lean_src; run npm run fetch:lean first" >&2
  exit 1
fi

test_dir="$(mktemp -d /tmp/vir-package-ir-builders.XXXXXX)"
trap 'rm -rf "$test_dir"' EXIT

"${CXX:-c++}" \
  -std=c++20 \
  -O2 \
  -I"$lean_src/src" \
  -I"$lean_prefix/include" \
  -I"$repo_root/wasm/upstream_shim" \
  "$repo_root/wasm/upstream_shim/package/package_ir_builders.cpp" \
  "$repo_root/wasm/upstream_shim/package/package_ir_builders_test.cpp" \
  -L"$lean_prefix/lib/lean" \
  "-Wl,-rpath,$lean_prefix/lib/lean" \
  -lleanshared \
  -o "$test_dir/package-ir-builders-test"

"$test_dir/package-ir-builders-test"
