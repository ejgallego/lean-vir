#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f build/generated/fib_ir_fixture.h ]; then
  python3 scripts/export_ir.py
fi

lean_prefix="$(lean --print-prefix)"
clang="${CLANG:-$lean_prefix/bin/clang}"

if command -v wasm-ld >/dev/null 2>&1; then
  :
elif [ -n "${WASI_SDK_PATH:-}" ] && [ -x "$WASI_SDK_PATH/bin/wasm-ld" ]; then
  export PATH="$WASI_SDK_PATH/bin:$PATH"
else
  echo "error: wasm-ld not found. Install WASI SDK or run npm run build:wat for the local fallback." >&2
  exit 1
fi

mkdir -p web/public

"$clang" \
  --target=wasm32-wasi \
  -O2 \
  -nostdlib \
  -Ibuild/generated \
  -Wl,--no-entry \
  -Wl,--export=_start \
  -Wl,--export=vir_fib \
  -Wl,--export=vir_target_pointer_bytes \
  -Wl,--export=vir_target_size_t_bytes \
  -Wl,--export=vir_target_layout_ok \
  wasm/runner.c \
  -o web/public/vir.wasm

echo "wrote web/public/vir.wasm"

