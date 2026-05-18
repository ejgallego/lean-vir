#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p web/public
npm exec -- wat2wasm wasm/runner.wat -o web/public/vir.wasm
echo "wrote web/public/vir.wasm"

