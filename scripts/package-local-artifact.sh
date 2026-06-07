#!/usr/bin/env bash
#
# Copyright (c) 2026 Lean FRO LLC. All rights reserved.
# Released under Apache 2.0 license as described in the file LICENSE.
# Author: Emilio J. Gallego Arias

set -euo pipefail

cd "$(dirname "$0")/.."

artifact_name="${VIR_LOCAL_ARTIFACT_NAME:-lean-vir-local}"
archive_name="${artifact_name}.tar.gz"
local_site="build/local-site"
artifact_root="build/artifacts"
bundle_dir="$artifact_root/$artifact_name"
archive="$artifact_root/$archive_name"
public_downloads="web/public/downloads"
vite_bin="${VITE:-node_modules/.bin/vite}"

if [ ! -x "$vite_bin" ]; then
  vite_bin="vite"
fi

rm -rf "$local_site" "$bundle_dir" "$archive"
rm -f "$public_downloads/$archive_name"
mkdir -p "$artifact_root"

"$vite_bin" build --base ./ --outDir ../"$local_site" --emptyOutDir
rm -rf "$local_site/downloads"

keep_public_file() {
  case "$1" in
    vir-upstream.wasm|\
    fixtures-basic.irpkg|\
    demo-host.irpkg|\
    pretty-printer.irpkg|\
    fixtures-lean.irpkg|\
    fixtures-boundary.irpkg|\
    local-quickstart.irpkg|\
    local-fib.irpkg|\
    local-mergesort.irpkg)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

while IFS= read -r generated_file; do
  basename="$(basename "$generated_file")"
  if ! keep_public_file "$basename"; then
    rm -f "$generated_file"
  fi
done < <(
  find "$local_site" -maxdepth 1 -type f \
    \( -name '*.wasm' -o -name '*.irpkg' -o -name '*.input.json' -o -name '*.report.md' \) \
    -print
)

mkdir -p "$bundle_dir"
cp -R "$local_site"/. "$bundle_dir"/
cp LICENSE NOTICE "$bundle_dir"/

cat > "$bundle_dir/README.txt" <<'EOF'
Lean VIR local bundle
=====================

This directory contains a static build of the Lean VIR browser demo, the
compiled wasm32-wasip1 IR interpreter, and the bundled demo .irpkg files.

Serve this directory from a local HTTP server, then open the printed URL:

  python3 -m http.server 8000
  http://127.0.0.1:8000/

Opening index.html directly from the filesystem is not supported by all
browsers because the runtime fetches WebAssembly modules and package files.

Useful entry points:

  index.html              Main demo and fixture browser
  dev.html                Package runner
  react.html              Lean-authored React examples
  format.html             Format.pretty workbench
  runtime-example.html    Minimal JavaScript runtime example
EOF

tar -czf "$archive" -C "$artifact_root" "$artifact_name"

mkdir -p "$public_downloads"
cp "$archive" "$public_downloads/$archive_name"

echo "wrote $archive"
echo "wrote $public_downloads/$archive_name"
