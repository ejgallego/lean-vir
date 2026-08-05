#!/usr/bin/env bash
set -euo pipefail

app_root="$(cd "$(dirname "$0")/.." && pwd)"
seed_dir="${1:-$app_root/_artifacts/seed}"
artifact_dir="$app_root/artifacts"

seed_dir="$(realpath "$seed_dir")"
case "$seed_dir/" in
  "$app_root"/*) ;;
  *)
    echo "artifact seed must be inside the application directory: $app_root" >&2
    exit 2
    ;;
esac

required=(
  lean-vir/js/vir-runtime.js
  lean-vir/wasm/vir-upstream.wasm
  prettyM-vir.irpkg
  lean-native/BUILD.json
  lean-native/prettyM-browser-adapter.mjs
  lean-native/prettyM.wasm
  lean-native/prettyM.wasm.json
  lean-llvm/README.md
  lean-llvm/SHA256SUMS
  lean-llvm/emscripten-loader.mjs
  lean-llvm/prettyM-emscripten-adapter.mjs
  lean-llvm/prettyM.manifest.json
  lean-llvm/prettyM.mjs
  lean-llvm/prettyM.wasm
)

for path in "${required[@]}"; do
  if [[ ! -f "$seed_dir/$path" ]]; then
    echo "artifact seed is incomplete; missing $path" >&2
    exit 1
  fi
done

(cd "$seed_dir/lean-llvm" && sha256sum -c --quiet SHA256SUMS)

for path in "${required[@]}"; do
  install -D -m 0644 "$seed_dir/$path" "$artifact_dir/$path"
done

echo "Staged five-backend artifacts from $seed_dir"
