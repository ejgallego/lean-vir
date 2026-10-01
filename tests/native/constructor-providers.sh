#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
lean_prefix="$(lean --print-prefix)"
wasi_sdk="${WASI_SDK_PATH:-$PWD/.tools/wasi-sdk}"
out="build/constructor-providers"
mkdir -p "$out"
source="tests/native/constructor-providers.cpp"
"${CXX:-c++}" -std=c++20 -O2 -DNDEBUG -I"$lean_prefix/include" "$source" \
  -L"$lean_prefix/lib/lean" "-Wl,-rpath,$lean_prefix/lib/lean" -lleanshared -o "$out/native"
"$out/native" > "$out/native.txt"
mapfile -t objects < build/upstream-probe/objects.txt
"$wasi_sdk/bin/clang++" --target=wasm32-wasip1 -std=c++20 -O2 -DNDEBUG \
  -Ibuild/upstream-probe/include -I"$lean_prefix/include" "$source" "${objects[@]}" \
  -Wl,--gc-sections -Wl,--allow-undefined-file=build/upstream-probe/allowed-js-imports.txt \
  -o "$out/wasm.wasm"
node tests/native/constructor-providers.mjs "$out/wasm.wasm" > "$out/wasm.txt"
diff -u "$out/native.txt" "$out/wasm.txt"
echo "pinned native/Wasm constructor metadata and ownership agree"
