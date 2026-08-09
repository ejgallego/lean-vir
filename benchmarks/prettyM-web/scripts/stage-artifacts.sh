#!/usr/bin/env bash
set -euo pipefail

app_root="$(cd "$(dirname "$0")/.." && pwd)"
seed_dir="${1:-}"
artifact_dir="$app_root/artifacts"

if [[ -z "$seed_dir" ]]; then
  set_id="$(node -e '
    const fs = require("node:fs");
    const lock = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    process.stdout.write(lock.setId);
  ' "$app_root/artifact-set.lock.json")"
  locked_dir="$app_root/_artifacts/sets/$set_id"
  if [[ -d "$locked_dir" ]]; then
    seed_dir="$locked_dir"
  else
    seed_dir="$app_root/_artifacts/seed"
  fi
fi

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

rm -rf "$artifact_dir"
for path in "${required[@]}"; do
  install -D -m 0644 "$seed_dir/$path" "$artifact_dir/$path"
done

optional=(
  ARTIFACT_SET.json
  SHA256SUMS
  lean-vir/COMPONENT.json
)
for path in "${optional[@]}"; do
  if [[ -f "$seed_dir/$path" ]]; then
    install -D -m 0644 "$seed_dir/$path" "$artifact_dir/$path"
  fi
done

shopt -s nullglob
for source in "$seed_dir"/components/*.json; do
  path="${source#"$seed_dir/"}"
  install -D -m 0644 "$source" "$artifact_dir/$path"
done

echo "Staged five-backend artifacts from $seed_dir"
