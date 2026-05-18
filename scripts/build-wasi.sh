#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f build/generated/fib_ir_fixture.h ]; then
  python3 scripts/export_ir.py
fi

local_wasi_sdk="$PWD/.tools/wasi-sdk"

if [ -z "${WASI_SDK_PATH:-}" ] && [ -x "$local_wasi_sdk/bin/clang" ]; then
  export WASI_SDK_PATH="$local_wasi_sdk"
fi

if [ -n "${WASI_SDK_PATH:-}" ] && [ -x "$WASI_SDK_PATH/bin/clang" ]; then
  export PATH="$WASI_SDK_PATH/bin:$PATH"
  clang="${CLANG:-$WASI_SDK_PATH/bin/clang}"
elif [ -n "${CLANG:-}" ]; then
  clang="$CLANG"
else
  lean_prefix="$(lean --print-prefix)"
  clang="$lean_prefix/bin/clang"
fi

if ! command -v wasm-ld >/dev/null 2>&1 && [ ! -x "${WASI_SDK_PATH:-}/bin/wasm-ld" ]; then
  echo "error: wasm-ld not found. Run npm run install:wasi or set WASI_SDK_PATH." >&2
  exit 1
fi

mkdir -p web/public

target="${WASI_TARGET:-wasm32-wasip1}"

"$clang" \
  "--target=${target}" \
  -O2 \
  -nostdlib \
  -Ibuild/generated \
  -Wl,--allow-undefined \
  -Wl,--no-entry \
  -Wl,--export=_start \
  -Wl,--export=vir_fib \
  -Wl,--export=vir_target_pointer_bytes \
  -Wl,--export=vir_target_size_t_bytes \
  -Wl,--export=vir_target_layout_ok \
  wasm/runner.c \
  -o web/public/vir.wasm

echo "wrote web/public/vir.wasm"
