#!/usr/bin/env bash
#
# Copyright (c) 2026 Lean FRO LLC. All rights reserved.
# Released under Apache 2.0 license as described in the file LICENSE.
# Author: Emilio J. Gallego Arias

set -euo pipefail

repo="$(pwd -P)"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/lean-vir-lake-facets.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT

lake build +SlidesCanvas:vir

canvas_package="$repo/.lake/build/vir/modules/SlidesCanvas.irpkg"
canvas_report="$repo/.lake/build/vir/reports/SlidesCanvas.report.md"
test -f "$canvas_package"
test -f "$canvas_report"

node "$repo/scripts/inspect-irpkg.mjs" --json "$canvas_package" > "$tmp/canvas-package.json"
node --input-type=module -e '
  import fs from "node:fs";
  const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).manifest;
  if (manifest.exports.length !== 1) process.exit(1);
  if (manifest.exports[0]?.entry !== "SlidesCanvas.mount") process.exit(1);
  if (manifest.exports[0]?.startup !== true) process.exit(1);
' "$tmp/canvas-package.json"

mkdir -p "$tmp/Smoke" "$tmp/sdk-source/lean-vir-sdk/js"

printf '%s\n' \
  'import Lake' \
  'open Lake DSL' \
  '' \
  'package vir_lake_smoke' \
  '' \
  "require lean_vir from \"$repo\"" \
  '' \
  '@[default_target]' \
  'lean_lib Smoke' > "$tmp/lakefile.lean"

printf '%s\n' 'leanprover/lean4:v4.32.0-rc1' > "$tmp/lean-toolchain"

printf '%s\n' \
  'import Vir' \
  '' \
  'open Lean.Vir.Browser' \
  '' \
  '@[vir_export]' \
  'def Smoke.Runtime.value : Nat := 42' \
  '' \
  '@[vir_entry]' \
  'def Smoke.Runtime.start : DomM Unit := pure ()' > "$tmp/Smoke/Runtime.lean"

printf '%s\n' \
  'module' \
  '' \
  'public meta import Vir.Attributes' \
  '' \
  '@[vir_export]' \
  'public def Smoke.NewRuntime.value : Nat := 43' > "$tmp/Smoke/NewRuntime.lean"

printf '%s\n' 'export const smoke = true;' > "$tmp/sdk-source/lean-vir-sdk/js/vir-runtime.js"
sdk_hash="$(sha256sum "$tmp/sdk-source/lean-vir-sdk/js/vir-runtime.js" | cut -d' ' -f1)"
printf '%s\n' \
  '{' \
  '  "name": "lean-vir-sdk",' \
  '  "version": "0.1.0",' \
  '  "gitCommit": "lake-facet-smoke",' \
  '  "runtimeAbiVersion": 1,' \
  '  "files": [' \
  "    {\"path\": \"js/vir-runtime.js\", \"sha256\": \"$sdk_hash\"}" \
  '  ]' \
  '}' > "$tmp/sdk-source/lean-vir-sdk/lean-vir-artifact.json"
tar -czf "$tmp/lean-vir-sdk.tar.gz" -C "$tmp/sdk-source" lean-vir-sdk

lake -d "$tmp" build +Smoke.Runtime:vir
lake -d "$tmp" build +Smoke.NewRuntime:vir

package="$tmp/.lake/build/vir/modules/Smoke/Runtime.irpkg"
report="$tmp/.lake/build/vir/reports/Smoke/Runtime.report.md"
test -f "$package"
test -f "$report"

module_package="$tmp/.lake/build/vir/modules/Smoke/NewRuntime.irpkg"
module_driver="$tmp/.lake/build/vir/drivers/Smoke/NewRuntime.lean"
test -f "$module_package"
test -f "$module_driver"

node "$repo/scripts/inspect-irpkg.mjs" --json "$package" > "$tmp/package.json"
node --input-type=module -e '
  import fs from "node:fs";
  const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).manifest;
  const entries = Object.fromEntries(manifest.exports.map((entry) => [entry.entry, entry]));
  if (entries["Smoke.Runtime.value"]?.startup !== false) process.exit(1);
  if (entries["Smoke.Runtime.start"]?.startup !== true) process.exit(1);
' "$tmp/package.json"

node "$repo/scripts/inspect-irpkg.mjs" --json "$module_package" > "$tmp/module-package.json"
node --input-type=module -e '
  import fs from "node:fs";
  const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).manifest;
  if (manifest.exports.length !== 1) process.exit(1);
  if (manifest.exports[0]?.entry !== "Smoke.NewRuntime.value") process.exit(1);
  if (manifest.exports[0]?.startup !== false) process.exit(1);
' "$tmp/module-package.json"

VIR_SDK_ARCHIVE="$tmp/lean-vir-sdk.tar.gz" lake -d "$tmp" build :virSdk
test -f "$tmp/.lake/build/vir/sdk/js/vir-runtime.js"
test -f "$tmp/.lake/build/vir/sdk/lean-vir-artifact.json"

echo "VIR Lake facet smoke ok"
