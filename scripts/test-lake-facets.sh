#!/usr/bin/env bash
#
# Copyright (c) 2026 Lean FRO LLC. All rights reserved.
# Released under Apache 2.0 license as described in the file LICENSE.
# Author: Emilio J. Gallego Arias

set -euo pipefail

cd "$(dirname "$0")/.."

repo="$(pwd -P)"
sdk_version="$(node -p 'require("./package.json").version')"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/lean-vir-lake-facets.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT

write_sdk_manifest() {
  local sdk_dir="$1"
  local commit="$2"
  local hash="$3"
  printf '%s\n' \
    '{' \
    '  "name": "lean-vir-sdk",' \
    "  \"version\": \"$sdk_version\"," \
    "  \"gitCommit\": \"$commit\"," \
    '  "runtimeAbiVersion": 1,' \
    '  "files": [' \
    "    {\"path\": \"js/vir-runtime.js\", \"sha256\": \"$hash\"}" \
    '  ]' \
    '}' > "$sdk_dir/lean-vir-artifact.json"
}

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

printf '%s\n' 'leanprover/lean4:v4.32.0' > "$tmp/lean-toolchain"

printf '%s\n' \
  'import Vir' \
  '' \
  'open Lean.Vir.Browser' \
  '' \
  '@[vir_export]' \
  'def Smoke.Runtime.value : Nat := 42' \
  '' \
  '@[vir_startup]' \
  'def Smoke.Runtime.start : DomM Unit := pure ()' > "$tmp/Smoke/Runtime.lean"

printf '%s\n' \
  'module' \
  '' \
  'public meta import Vir.Attributes' \
  '' \
  '@[vir_export]' \
  'public def Smoke.Dependency.importedValue : Nat := 41' > "$tmp/Smoke/Dependency.lean"

printf '%s\n' \
  'module' \
  '' \
  'public meta import Vir.Attributes' \
  'public import Smoke.Dependency' \
  '' \
  '@[vir_export]' \
  'public def Smoke.NewRuntime.value : Nat := 43' \
  '' \
  '@[vir_startup]' \
  'public def Smoke.NewRuntime.start : Unit := ()' > "$tmp/Smoke/NewRuntime.lean"

printf '%s\n' 'export const smoke = true;' > "$tmp/sdk-source/lean-vir-sdk/js/vir-runtime.js"
sdk_hash="$(sha256sum "$tmp/sdk-source/lean-vir-sdk/js/vir-runtime.js" | cut -d' ' -f1)"
write_sdk_manifest "$tmp/sdk-source/lean-vir-sdk" "lake-facet-smoke" "$sdk_hash"
tar -czf "$tmp/lean-vir-sdk.tar.gz" -C "$tmp/sdk-source" lean-vir-sdk

mkdir -p "$tmp/sdk-bad/lean-vir-sdk/js" "$tmp/existing-sdk"
printf '%s\n' 'export const smoke = false;' > "$tmp/sdk-bad/lean-vir-sdk/js/vir-runtime.js"
write_sdk_manifest "$tmp/sdk-bad/lean-vir-sdk" "lake-facet-smoke" \
  "0000000000000000000000000000000000000000000000000000000000000000"
tar -czf "$tmp/lean-vir-sdk-bad.tar.gz" -C "$tmp/sdk-bad" lean-vir-sdk
printf '%s\n' 'keep-existing-sdk' > "$tmp/existing-sdk/marker.txt"

if lake exe vir_fetch_sdk --archive "$tmp/lean-vir-sdk-bad.tar.gz" --out "$tmp/existing-sdk" \
    > "$tmp/bad-sdk.stdout" 2> "$tmp/bad-sdk.stderr"; then
  echo "corrupt SDK archive unexpectedly installed" >&2
  exit 1
fi
test "$(cat "$tmp/existing-sdk/marker.txt")" = 'keep-existing-sdk'
grep -q 'checksum mismatch' "$tmp/bad-sdk.stderr"

if lake exe vir_fetch_sdk --archive "$tmp/lean-vir-sdk.tar.gz" --expect-version 9.9.9 \
    --out "$tmp/existing-sdk" > "$tmp/version-sdk.stdout" 2> "$tmp/version-sdk.stderr"; then
  echo "SDK archive with the wrong expected version unexpectedly installed" >&2
  exit 1
fi
test "$(cat "$tmp/existing-sdk/marker.txt")" = 'keep-existing-sdk'
grep -q 'SDK version mismatch' "$tmp/version-sdk.stderr"

lake -d "$tmp" build +Smoke.Runtime:vir
lake -d "$tmp" build +Smoke.NewRuntime:vir

package="$tmp/.lake/build/vir/modules/Smoke/Runtime.irpkg"
report="$tmp/.lake/build/vir/reports/Smoke/Runtime.report.md"
test -f "$package"
test -f "$report"

rm -f "$report"
lake -d "$tmp" build +Smoke.Runtime:vir
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
  const entries = Object.fromEntries(manifest.exports.map((entry) => [entry.entry, entry]));
  if (manifest.exports.length !== 2) process.exit(1);
  if (entries["Smoke.NewRuntime.value"]?.startup !== false) process.exit(1);
  if (entries["Smoke.NewRuntime.start"]?.startup !== true) process.exit(1);
  if (entries["Smoke.Dependency.importedValue"] !== undefined) process.exit(1);
' "$tmp/module-package.json"

VIR_SDK_ARCHIVE="$tmp/lean-vir-sdk.tar.gz" lake -d "$tmp" build :virSdk
test -f "$tmp/.lake/build/vir/sdk/js/vir-runtime.js"
test -f "$tmp/.lake/build/vir/sdk/lean-vir-artifact.json"

rm -f "$tmp/.lake/build/vir/sdk/js/vir-runtime.js"
VIR_SDK_ARCHIVE="$tmp/lean-vir-sdk.tar.gz" lake -d "$tmp" build :virSdk
grep -q 'smoke = true' "$tmp/.lake/build/vir/sdk/js/vir-runtime.js"

mkdir -p "$tmp/sdk-source-2/lean-vir-sdk/js"
printf '%s\n' 'export const smoke = false;' > "$tmp/sdk-source-2/lean-vir-sdk/js/vir-runtime.js"
sdk_hash="$(sha256sum "$tmp/sdk-source-2/lean-vir-sdk/js/vir-runtime.js" | cut -d' ' -f1)"
write_sdk_manifest "$tmp/sdk-source-2/lean-vir-sdk" "lake-facet-smoke-2" "$sdk_hash"
tar -czf "$tmp/lean-vir-sdk-2.tar.gz" -C "$tmp/sdk-source-2" lean-vir-sdk

VIR_SDK_ARCHIVE="$tmp/lean-vir-sdk-2.tar.gz" lake -d "$tmp" build :virSdk
grep -q 'smoke = false' "$tmp/.lake/build/vir/sdk/js/vir-runtime.js"

echo "VIR Lake facet smoke ok"
