#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f build/generated/fib_ir_tree_fixture.h ]; then
  python3 scripts/export_ir.py
fi

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

if ! command -v wasm-ld >/dev/null 2>&1 && [ ! -x "${WASI_SDK_PATH:-}/bin/wasm-ld" ]; then
  echo "error: wasm-ld not found. Run npm run install:wasi or set WASI_SDK_PATH." >&2
  exit 1
fi

mkdir -p web/public

target="${WASI_TARGET:-wasm32-wasip1}"

"$cxx" \
  "--target=${target}" \
  -O2 \
  -fno-exceptions \
  -fno-rtti \
  -nostdlib \
  -Ibuild/generated \
  -Iwasm/interpreter_port \
  -Wl,--allow-undefined \
  -Wl,--no-entry \
  -Wl,--export=_start \
  -Wl,--export=vir_fib \
  -Wl,--export=vir_target_pointer_bytes \
  -Wl,--export=vir_target_size_t_bytes \
  -Wl,--export=vir_target_layout_ok \
  -Wl,--export=vir_interpreter_port_enabled \
  wasm/interpreter_port/port.cpp \
  -o web/public/vir.wasm

echo "wrote web/public/vir.wasm"
