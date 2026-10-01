#!/usr/bin/env bash
# Copyright (c) 2026 Lean FRO LLC. All rights reserved.
# Released under Apache 2.0 license as described in the file LICENSE.
# Author: Emilio J. Gallego Arias

set -euo pipefail
cd "$(dirname "$0")/../.."
out="build/resource-roots"
mkdir -p "$out"
wasi_sdk="${WASI_SDK_PATH:-$PWD/.tools/wasi-sdk}"
"$wasi_sdk/bin/clang++" --target=wasm32-wasip1 -std=c++20 -O2 -mexec-model=reactor \
  tests/native/resource-roots.cpp -Wl,--gc-sections \
  -Wl,--export=vir_resource_root -Wl,--export=vir_resource_get -Wl,--export=vir_resource_release \
  -Wl,--export=vir_resource_roots_clear -Wl,--export=vir_resource_roots_active \
  -Wl,--export=vir_resource_roots_capacity -Wl,--export=vir_resource_roots_reusable \
  -Wl,--export=test_fail_metadata -Wl,--export=test_fail_growth -Wl,--export=test_trap \
  -o "$out/allocator.wasm"
node tests/native/resource-roots.mjs "$out/allocator.wasm"
