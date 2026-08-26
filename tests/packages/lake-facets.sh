#!/usr/bin/env bash
#
# Copyright (c) 2026 Lean FRO LLC. All rights reserved.
# Released under Apache 2.0 license as described in the file LICENSE.
# Author: Emilio J. Gallego Arias

set -euo pipefail

cd "$(dirname "$0")/../.."

repo="$(pwd -P)"
sdk_version="$(node -p 'require("./package.json").version')"
repo_commit="$(git rev-parse HEAD)"
lean_toolchain="$(tr -d '\n' < lean-toolchain)"
lean_version_output="$(lean --version)"
if [[ "$lean_version_output" =~ ^Lean\ \(version\ ([^,]+),.*commit\ ([0-9a-fA-F]+), ]]; then
  lean_version="${BASH_REMATCH[1]}"
  lean_githash="${BASH_REMATCH[2],,}"
else
  echo "could not parse Lean build identity from: $lean_version_output" >&2
  exit 1
fi
tmp="$(mktemp -d "${TMPDIR:-/tmp}/lean-vir-lake-facets.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT

write_sdk_manifest() {
  local sdk_dir="$1"
  local commit="$2"
  local js_hash="$3"
  local wasm_hash="$4"
  local js_size
  local wasm_size
  js_size="$(wc -c < "$sdk_dir/js/vir-runtime.js")"
  wasm_size="$(wc -c < "$sdk_dir/wasm/vir-upstream.wasm")"
  printf '%s\n' \
    '{' \
    '  "name": "lean-vir-sdk",' \
    "  \"version\": \"$sdk_version\"," \
    "  \"gitCommit\": \"$commit\"," \
    "  \"leanToolchain\": \"$lean_toolchain\"," \
    "  \"leanVersion\": \"$lean_version_output\"," \
    "  \"leanVersionString\": \"$lean_version\"," \
    "  \"leanGithash\": \"$lean_githash\"," \
    '  "packageFormatVersion": 10,' \
    '  "manifestVersion": 7,' \
    '  "runtimeAbiVersion": 1,' \
    '  "files": [' \
    "    {\"path\": \"js/vir-runtime.js\", \"sha256\": \"$js_hash\", \"byteSize\": $js_size}," \
    "    {\"path\": \"wasm/vir-upstream.wasm\", \"sha256\": \"$wasm_hash\", \"byteSize\": $wasm_size}" \
    '  ]' \
    '}' > "$sdk_dir/lean-vir-artifact.json"
}

assert_module_fixture_descriptor() {
  node --input-type=module -e '
    import fs from "node:fs";
    const descriptor = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (descriptor.format !== "lean-vir-ir-package-set") process.exit(1);
    if (descriptor.version !== 1) process.exit(1);
    if (descriptor.compatibility?.packageFormatVersion !== 10) process.exit(1);
    if (descriptor.compatibility?.manifestVersion !== 7) process.exit(1);
    if (descriptor.compatibility?.runtimeAbiVersion !== 1) process.exit(1);
    const actual = descriptor.packages.map(({ module, role, path }) => [module, role, path]);
    const expected = [
      ["ModuleSetFixture.Shared", "dependency", "Root.parts/ModuleSetFixture.Shared.irpkg"],
      ["ModuleSetFixture.Left", "dependency", "Root.parts/ModuleSetFixture.Left.irpkg"],
      ["ModuleSetFixture.Right", "dependency", "Root.parts/ModuleSetFixture.Right.irpkg"],
      ["ModuleSetFixture.Root", "root", "Root.irpkg"],
    ];
    if (JSON.stringify(actual) !== JSON.stringify(expected)) process.exit(1);
  ' "$1"
}

lake build +SlidesCanvas:vir
lake build +ModuleSetFixture.Root:vir

canvas_package="$repo/.lake/build/vir/module-sets/SlidesCanvas.irpkg"
canvas_report="$repo/.lake/build/vir/module-sets/SlidesCanvas.report.md"
test -f "$canvas_package"
test -f "$canvas_report"

module_set="$repo/.lake/build/vir/module-sets/ModuleSetFixture/Root.irpkg-set.json"
module_set_root="$repo/.lake/build/vir/module-sets/ModuleSetFixture/Root.irpkg"
module_set_shared="$repo/.lake/build/vir/module-sets/ModuleSetFixture/Root.parts/ModuleSetFixture.Shared.irpkg"
test -f "$module_set"
test -f "$module_set_root"
test -f "$module_set_shared"

assert_module_fixture_descriptor "$module_set"

obsolete_shard="$repo/.lake/build/vir/module-sets/ModuleSetFixture/Root.parts/Obsolete.irpkg"
printf '%s\n' 'obsolete' > "$obsolete_shard"
node --input-type=module -e '
  import fs from "node:fs";
  const path = process.argv[1];
  const descriptor = JSON.parse(fs.readFileSync(path, "utf8"));
  descriptor.format = "invalid-package-set";
  fs.writeFileSync(path, `${JSON.stringify(descriptor)}\n`);
' "$module_set"
lake build +ModuleSetFixture.Root:vir
test ! -e "$obsolete_shard"
assert_module_fixture_descriptor "$module_set"

node --input-type=module -e '
  import fs from "node:fs";
  const path = process.argv[1];
  const descriptor = JSON.parse(fs.readFileSync(path, "utf8"));
  descriptor.packages = [];
  fs.writeFileSync(path, `${JSON.stringify(descriptor)}\n`);
' "$module_set"
lake build +ModuleSetFixture.Root:vir
assert_module_fixture_descriptor "$module_set"

node --input-type=module -e '
  import fs from "node:fs";
  const path = process.argv[1];
  const descriptor = JSON.parse(fs.readFileSync(path, "utf8"));
  const dependency = descriptor.packages[0];
  const root = descriptor.packages.at(-1);
  [dependency.path, root.path] = [root.path, dependency.path];
  fs.writeFileSync(path, `${JSON.stringify(descriptor)}\n`);
' "$module_set"
lake build +ModuleSetFixture.Root:vir
assert_module_fixture_descriptor "$module_set"

mv "$module_set_shared" "$tmp/missing-shard.irpkg"
lake build +ModuleSetFixture.Root:vir
test -f "$module_set_shared"
assert_module_fixture_descriptor "$module_set"

mv "$module_set_shared" "$tmp/shard-replaced-by-directory.irpkg"
mkdir "$module_set_shared"
lake build +ModuleSetFixture.Root:vir
test -f "$module_set_shared"
assert_module_fixture_descriptor "$module_set"

node "$repo/scripts/packages/inspect-irpkg.mjs" --json "$canvas_package" > "$tmp/canvas-package.json"
node --input-type=module -e '
  import fs from "node:fs";
  const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).manifest;
  if (manifest.exports.length !== 1) process.exit(1);
  if (manifest.exports[0]?.entry !== "SlidesCanvas.mount") process.exit(1);
  if (manifest.exports[0]?.startup !== true) process.exit(1);
' "$tmp/canvas-package.json"

mkdir -p "$tmp/Smoke" "$tmp/dep/Dep" "$tmp/sdk-source/lean-vir-sdk/js" \
  "$tmp/sdk-source/lean-vir-sdk/wasm"

printf '%s\n' \
  'import Lake' \
  'open Lake DSL' \
  '' \
  'package «vir-lake-smoke»' \
  '' \
  "require lean_vir from \"$repo\"" \
  'require «smoke-dep» from "dep"' \
  '' \
  '@[default_target]' \
  'lean_lib Smoke' \
  '' \
  'lean_exe smoke_app where' \
  '  root := `Main' \
  '  needs := #[`@:virWebAssets]' > "$tmp/lakefile.lean"

cp lean-toolchain "$tmp/lean-toolchain"

printf '%s\n' \
  'import Lake' \
  'open Lake DSL' \
  '' \
  'package «smoke-dep»' \
  '' \
  "require lean_vir from \"$repo\"" \
  '' \
  '@[default_target]' \
  'lean_lib SmokeDep where' \
  '  roots := #[`Dep.Widget]' > "$tmp/dep/lakefile.lean"

cp lean-toolchain "$tmp/dep/lean-toolchain"

printf '%s\n' \
  'def main : IO Unit := pure ()' > "$tmp/Main.lean"

printf '%s\n' \
  'module' \
  '' \
  'public meta import Vir.Attributes' \
  '' \
  '@[vir_export]' \
  'public def Dep.Widget.value : Nat := 77' > "$tmp/dep/Dep/Widget.lean"

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

printf '%s\n' \
  'module' \
  '' \
  'public meta import Vir.Attributes' \
  'public import Vir.HostValidation' \
  '' \
  '#check vir_export' \
  '#check vir_startup' \
  '#check Vir.InterfaceValidation.analyzeExportSignature' \
  '#check Vir.InterfaceValidation.ExportSignatureError.toMessageData' \
  '#check Vir.InterfaceValidation.analyzeStartupSignature' \
  '#check Vir.InterfaceValidation.StartupSignatureError.toMessageData' \
  '#check Vir.InterfaceValidation.StartupSignature.effect' \
  '#check Vir.Interface.InterfaceType' \
  '#check Vir.Interface.InterfaceEffect' \
  '#check Vir.Interface.HostImportBoundary' \
  '#check Vir.Interface.InterfaceClassifierError.toMessageData' \
  '#check Vir.Interface.ExportInterfaceValidationError' \
  '#check Vir.Interface.ExportInterfaceValidationError.toMessageData' \
  '#check Vir.Interface.ClassifiedSignature' \
  '#check Vir.Interface.ClassifiedSignature.args' \
  '#check Vir.Interface.ClassifiedSignature.result' \
  '#check Vir.Interface.ClassifiedSignature.effect' \
  '#check Vir.Interface.ClassifiedSignature.erasedPrefixArgs' \
  '#check Vir.Interface.analyzeExportInterface' \
  '#check Vir.Interface.classifyExportSignature' \
  '#check Vir.Interface.classifyHostImportSignature' \
  '#check Vir.HostMetadata.HostImportMarker' \
  '#check Vir.HostMetadata.HostImportMarker.attributeName' \
  '#check Vir.HostMetadata.HostImportMarker.externSymbol' \
  '#check Vir.HostMetadata.decodeExternSymbol?' \
  '#guard Vir.HostMetadata.HostImportMarker.hostImport.externSymbol "demo.bump" ==' \
  '  "__vir_js:demo.bump"' \
  '#guard Vir.HostMetadata.decodeExternSymbol?' \
  '    (Vir.HostMetadata.HostImportMarker.hostImport.externSymbol "demo.bump") ==' \
  '  some { marker := .hostImport, target := "demo.bump" }' \
  '#guard Vir.HostMetadata.decodeExternSymbol?' \
  '    (Vir.HostMetadata.HostImportMarker.explicitConversion.externSymbol "demo.convert") ==' \
  '  some { marker := .explicitConversion, target := "demo.convert" }' \
  '#guard Vir.HostMetadata.decodeExternSymbol? "__other:demo.bump" == none' \
  '#check Vir.HostValidation.HostImportBoundaryError' \
  '#check Vir.HostValidation.HostImportBoundaryError.toMessageData' \
  '#check Vir.HostValidation.HostImportValidationError' \
  '#check Vir.HostValidation.HostImportValidationError.toMessageData' \
  '#check Vir.HostValidation.HostImportAnalysis' \
  '#check Vir.HostValidation.HostImportAnalysis.signature' \
  '#check Vir.HostValidation.HostImportAnalysis.boundary' \
  '#check (Vir.HostValidation.validateHostImportBoundary :' \
  '  Vir.HostMetadata.HostImportMarker → String →' \
  '  Vir.Interface.ClassifiedSignature →' \
  '  Except Vir.HostValidation.HostImportBoundaryError Vir.Interface.HostImportBoundary)' \
  '#check (Vir.HostValidation.analyzeHostImport :' \
  '  Vir.HostMetadata.HostImportMarker → String → Lean.Expr →' \
  '  Lean.CoreM (Except Vir.HostValidation.HostImportValidationError' \
  '    Vir.HostValidation.HostImportAnalysis))' > "$tmp/Smoke/InterfaceClassifier.lean"

printf '%s\n' \
  'module' \
  '' \
  'public import Vir.GeneratePackage' \
  '' \
  '#check Vir.GeneratePackage.moduleNameFor' \
  '#check Vir.GeneratePackage.collectClosure' \
  '#check Vir.GeneratePackage.virJsMetadataFromDecl?' \
  '#check Vir.GeneratePackage.collectHostImports' \
  '#check Vir.GeneratePackage.collectInterfaceManifest' \
  '#check Vir.GeneratePackage.emitPackage' \
  '#check Vir.GeneratePackage.reportFor' \
  '#check Vir.GeneratePackage.analyzePackage' > "$tmp/Smoke/PackagePipeline.lean"

printf '%s\n' \
  'module' \
  '' \
  'public import Init.System.IO' \
  '' \
  'public def Smoke.OpaqueDependency.environmentHome : IO String := do' \
  '  return (← IO.getEnv "HOME").getD ""' > "$tmp/Smoke/OpaqueDependency.lean"

printf '%s\n' \
  'module' \
  '' \
  'public meta import Vir.Attributes' \
  'public import Smoke.OpaqueDependency' \
  '' \
  '@[vir_export]' \
  'public def Smoke.DeferredRuntime.home : IO String :=' \
  '  Smoke.OpaqueDependency.environmentHome' > "$tmp/Smoke/DeferredRuntime.lean"

printf '%s\n' 'export const smoke = true;' > "$tmp/sdk-source/lean-vir-sdk/js/vir-runtime.js"
printf '%s\n' 'fake-wasm' > "$tmp/sdk-source/lean-vir-sdk/wasm/vir-upstream.wasm"
sdk_hash="$(sha256sum "$tmp/sdk-source/lean-vir-sdk/js/vir-runtime.js" | cut -d' ' -f1)"
wasm_hash="$(sha256sum "$tmp/sdk-source/lean-vir-sdk/wasm/vir-upstream.wasm" | cut -d' ' -f1)"
write_sdk_manifest "$tmp/sdk-source/lean-vir-sdk" "$repo_commit" "$sdk_hash" "$wasm_hash"
tar -czf "$tmp/lean-vir-sdk.tar.gz" -C "$tmp/sdk-source" lean-vir-sdk

mkdir -p "$tmp/sdk-bad/lean-vir-sdk/js" "$tmp/sdk-bad/lean-vir-sdk/wasm" "$tmp/existing-sdk"
printf '%s\n' 'export const smoke = false;' > "$tmp/sdk-bad/lean-vir-sdk/js/vir-runtime.js"
printf '%s\n' 'fake-wasm' > "$tmp/sdk-bad/lean-vir-sdk/wasm/vir-upstream.wasm"
write_sdk_manifest "$tmp/sdk-bad/lean-vir-sdk" "$repo_commit" \
  "0000000000000000000000000000000000000000000000000000000000000000" "$wasm_hash"
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

if lake exe vir_fetch_sdk --archive "$tmp/lean-vir-sdk.tar.gz" \
    --expect-commit "$(printf '0%.0s' {1..40})" --out "$tmp/existing-sdk" \
    > "$tmp/commit-sdk.stdout" 2> "$tmp/commit-sdk.stderr"; then
  echo "SDK archive with the wrong expected commit unexpectedly installed" >&2
  exit 1
fi
test "$(cat "$tmp/existing-sdk/marker.txt")" = 'keep-existing-sdk'
grep -q 'SDK commit mismatch' "$tmp/commit-sdk.stderr"

lake -d "$tmp" build Smoke.InterfaceClassifier
lake -d "$tmp" build Smoke.PackagePipeline
lake -d "$tmp" build +Smoke.Runtime:vir
lake -d "$tmp" build +Smoke.NewRuntime:vir

printf '%s\n' \
  '{' \
  '  "format": "lean-vir-web-assets-config",' \
  '  "version": 1,' \
  '  "programs": [' \
  '    {"id": "runtime", "package": "vir-lake-smoke", "module": "Smoke.Runtime"}' \
  '  ]' \
  '}' > "$tmp/vir-web-assets.json"

VIR_SDK_ARCHIVE="$tmp/lean-vir-sdk.tar.gz" lake -d "$tmp" build smoke_app

web_assets="$tmp/.lake/build/vir/web-assets"
web_manifest="$web_assets/VIR_WEB_ASSETS.json"
test -f "$web_manifest"
test -f "$web_assets/sdk/js/vir-runtime.js"
test -f "$web_assets/sdk/wasm/vir-upstream.wasm"
test -f "$web_assets/programs/runtime/Runtime.irpkg-set.json"
node --input-type=module -e '
  import crypto from "node:crypto";
  import fs from "node:fs";
  import path from "node:path";
  const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (manifest.format !== "lean-vir-web-assets" || manifest.version !== 1) process.exit(1);
  if (manifest.sdk?.gitCommit !== process.argv[2]) process.exit(1);
  if (manifest.sdk?.compatibility?.leanGithash !== process.argv[3]) process.exit(1);
  if (manifest.sdk?.runtimeModule !== "sdk/js/vir-runtime.js") process.exit(1);
  if (manifest.sdk?.wasm !== "sdk/wasm/vir-upstream.wasm") process.exit(1);
  if (manifest.programs?.length !== 1) process.exit(1);
  if (manifest.programs[0]?.module !== "Smoke.Runtime") process.exit(1);
  if (!manifest.programs[0]?.files?.every(({ sha256 }) => /^[0-9a-f]{64}$/.test(sha256))) process.exit(1);
  const root = path.dirname(process.argv[1]);
  const files = [...manifest.sdk.files, ...manifest.programs.flatMap((program) => program.files)];
  for (const file of files) {
    const bytes = fs.readFileSync(path.join(root, file.path));
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    if (file.sha256 !== sha256 || file.byteSize !== bytes.byteLength) process.exit(1);
  }
' "$web_manifest" "$repo_commit" "$lean_githash"

sdk_stage_time="$(stat -c '%y' "$web_assets/sdk/js/vir-runtime.js")"
runtime_stage_time="$(stat -c '%y' "$web_assets/programs/runtime/Runtime.irpkg")"

printf '%s\n' \
  '{' \
  '  "format": "lean-vir-web-assets-config",' \
  '  "version": 1,' \
  '  "programs": [' \
  '    {"id": "runtime", "package": "vir-lake-smoke", "module": "Smoke.Runtime"},' \
  '    {"id": "widget", "package": "smoke-dep", "module": "Dep.Widget"}' \
  '  ]' \
  '}' > "$tmp/vir-web-assets.json"

VIR_SDK_ARCHIVE="$tmp/lean-vir-sdk.tar.gz" lake -d "$tmp" build smoke_app
test "$(stat -c '%y' "$web_assets/sdk/js/vir-runtime.js")" = "$sdk_stage_time"
test "$(stat -c '%y' "$web_assets/programs/runtime/Runtime.irpkg")" = "$runtime_stage_time"
test -f "$web_assets/programs/widget/Widget.irpkg-set.json"
node --input-type=module -e '
  import fs from "node:fs";
  const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const programs = Object.fromEntries(manifest.programs.map((program) => [program.id, program]));
  if (manifest.programs.length !== 2) process.exit(1);
  if (programs.runtime?.package !== "vir-lake-smoke") process.exit(1);
  if (programs.widget?.package !== "smoke-dep") process.exit(1);
  if (programs.widget?.descriptor !== "programs/widget/Widget.irpkg-set.json") process.exit(1);
' "$web_manifest"

widget_hash="$(sha256sum "$web_assets/programs/widget/Widget.irpkg" | cut -d' ' -f1)"
printf '%s\n' \
  'module' \
  '' \
  'public meta import Vir.Attributes' \
  '' \
  '@[vir_export]' \
  'public def Dep.Widget.value : Nat := 78' > "$tmp/dep/Dep/Widget.lean"
VIR_SDK_ARCHIVE="$tmp/lean-vir-sdk.tar.gz" lake -d "$tmp" build smoke_app
test "$(stat -c '%y' "$web_assets/sdk/js/vir-runtime.js")" = "$sdk_stage_time"
test "$(stat -c '%y' "$web_assets/programs/runtime/Runtime.irpkg")" = "$runtime_stage_time"
test "$(sha256sum "$web_assets/programs/widget/Widget.irpkg" | cut -d' ' -f1)" != "$widget_hash"

printf '%s\n' \
  '{' \
  '  "format": "lean-vir-web-assets-config",' \
  '  "version": 1,' \
  '  "programs": [' \
  '    {"id": "runtime", "package": "vir-lake-smoke", "module": "Smoke.Runtime"}' \
  '  ]' \
  '}' > "$tmp/vir-web-assets.json"
VIR_SDK_ARCHIVE="$tmp/lean-vir-sdk.tar.gz" lake -d "$tmp" build smoke_app
test ! -e "$web_assets/programs/widget"
test "$(stat -c '%y' "$web_assets/sdk/js/vir-runtime.js")" = "$sdk_stage_time"
test "$(stat -c '%y' "$web_assets/programs/runtime/Runtime.irpkg")" = "$runtime_stage_time"
web_manifest_time="$(stat -c '%y' "$web_manifest")"
VIR_SDK_ARCHIVE="$tmp/lean-vir-sdk.tar.gz" lake -d "$tmp" build smoke_app
test "$(stat -c '%y' "$web_manifest")" = "$web_manifest_time"

rm -f "$web_assets/programs/runtime/Runtime.irpkg"
VIR_SDK_ARCHIVE="$tmp/lean-vir-sdk.tar.gz" lake -d "$tmp" build smoke_app
test -f "$web_assets/programs/runtime/Runtime.irpkg"
test -f "$web_manifest"

printf '%s\n' \
  '{' \
  '  "format": "lean-vir-web-assets-config",' \
  '  "version": 1,' \
  '  "programs": [' \
  '    {"id": "%2e%2e", "package": "vir-lake-smoke", "module": "Smoke.Runtime"}' \
  '  ]' \
  '}' > "$tmp/vir-web-assets.json"
if VIR_SDK_ARCHIVE="$tmp/lean-vir-sdk.tar.gz" lake -d "$tmp" build smoke_app \
    > "$tmp/web-id.stdout" 2> "$tmp/web-id.stderr"; then
  echo "URL-unsafe web-assets program id unexpectedly built" >&2
  exit 1
fi
cat "$tmp/web-id.stdout" "$tmp/web-id.stderr" > "$tmp/web-id.output"
grep -q 'program `id` must be a URL-safe slug' "$tmp/web-id.output"

printf '%s\n' \
  '{' \
  '  "format": "lean-vir-web-assets-config",' \
  '  "version": 1,' \
  '  "programs": [' \
  '    {"id": "runtime", "package": "vir-lake-smoke", "module": "Smoke.Runtime"},' \
  '    {"id": "runtime", "package": "smoke-dep", "module": "Dep.Widget"}' \
  '  ]' \
  '}' > "$tmp/vir-web-assets.json"
if VIR_SDK_ARCHIVE="$tmp/lean-vir-sdk.tar.gz" lake -d "$tmp" build smoke_app \
    > "$tmp/web-duplicate-id.stdout" 2> "$tmp/web-duplicate-id.stderr"; then
  echo "duplicate web-assets program id unexpectedly built" >&2
  exit 1
fi
cat "$tmp/web-duplicate-id.stdout" "$tmp/web-duplicate-id.stderr" \
  > "$tmp/web-duplicate-id.output"
grep -q 'duplicate VIR web-assets program id: runtime' "$tmp/web-duplicate-id.output"

printf '%s\n' \
  '{' \
  '  "format": "lean-vir-web-assets-config",' \
  '  "version": 1,' \
  '  "programs": [' \
  '    {"id": "runtime", "package": "vir-lake-smoke", "module": "Smoke.Runtime"}' \
  '  ]' \
  '}' > "$tmp/vir-web-assets.json"
VIR_SDK_ARCHIVE="$tmp/lean-vir-sdk.tar.gz" lake -d "$tmp" build smoke_app

mkdir -p "$tmp/sdk-identity-mismatch-source"
cp -R "$tmp/sdk-source/lean-vir-sdk" "$tmp/sdk-identity-mismatch-source/lean-vir-sdk"
node --input-type=module -e '
  import fs from "node:fs";
  const path = process.argv[1];
  const manifest = JSON.parse(fs.readFileSync(path, "utf8"));
  manifest.leanGithash = "0".repeat(40);
  fs.writeFileSync(path, `${JSON.stringify(manifest)}\n`);
' "$tmp/sdk-identity-mismatch-source/lean-vir-sdk/lean-vir-artifact.json"
tar -czf "$tmp/lean-vir-sdk-identity-mismatch.tar.gz" \
  -C "$tmp/sdk-identity-mismatch-source" lean-vir-sdk
if VIR_SDK_ARCHIVE="$tmp/lean-vir-sdk-identity-mismatch.tar.gz" lake -d "$tmp" build smoke_app \
    > "$tmp/web-identity-mismatch.stdout" 2> "$tmp/web-identity-mismatch.stderr"; then
  echo "compiler-mismatched SDK unexpectedly composed into VIR web assets" >&2
  exit 1
fi
cat "$tmp/web-identity-mismatch.stdout" "$tmp/web-identity-mismatch.stderr" \
  > "$tmp/web-identity-mismatch.output"
grep -q 'Lean git hash mismatch for vir-lake-smoke/Smoke.Runtime' \
  "$tmp/web-identity-mismatch.output"
test ! -e "$web_manifest"
VIR_SDK_ARCHIVE="$tmp/lean-vir-sdk.tar.gz" lake -d "$tmp" build smoke_app
test -f "$web_manifest"

mkdir -p "$tmp/sdk-mismatch-source"
cp -R "$tmp/sdk-source/lean-vir-sdk" "$tmp/sdk-mismatch-source/lean-vir-sdk"
node --input-type=module -e '
  import fs from "node:fs";
  const path = process.argv[1];
  const manifest = JSON.parse(fs.readFileSync(path, "utf8"));
  manifest.packageFormatVersion = 999;
  fs.writeFileSync(path, `${JSON.stringify(manifest)}\n`);
' "$tmp/sdk-mismatch-source/lean-vir-sdk/lean-vir-artifact.json"
tar -czf "$tmp/lean-vir-sdk-mismatch.tar.gz" -C "$tmp/sdk-mismatch-source" lean-vir-sdk
if VIR_SDK_ARCHIVE="$tmp/lean-vir-sdk-mismatch.tar.gz" lake -d "$tmp" build smoke_app \
    > "$tmp/web-mismatch.stdout" 2> "$tmp/web-mismatch.stderr"; then
  echo "mismatched SDK unexpectedly composed into VIR web assets" >&2
  exit 1
fi
cat "$tmp/web-mismatch.stdout" "$tmp/web-mismatch.stderr" > "$tmp/web-mismatch.output"
grep -q 'SDK manifest package format mismatch: expected 10, got 999' "$tmp/web-mismatch.output"
test ! -e "$web_manifest"
VIR_SDK_ARCHIVE="$tmp/lean-vir-sdk.tar.gz" lake -d "$tmp" build smoke_app
test -f "$web_manifest"

if lake -d "$tmp" build +Smoke.DeferredRuntime:vir \
    > "$tmp/deferred-runtime.stdout" 2> "$tmp/deferred-runtime.stderr"; then
  echo "unsupported environment dependency unexpectedly generated as a module package set" >&2
  exit 1
fi
cat "$tmp/deferred-runtime.stdout" "$tmp/deferred-runtime.stderr" > "$tmp/deferred-runtime.output"
grep -q 'missing native extern registrations:' "$tmp/deferred-runtime.output"
grep -q 'IO.getEnv (via Smoke.DeferredRuntime.home.*Smoke.OpaqueDependency.environmentHome.*IO.getEnv)' \
  "$tmp/deferred-runtime.output"
if grep -q 'missing IR declarations after loading imported module IR:' "$tmp/deferred-runtime.output"; then
  echo "module package generation stopped at the opaque import instead of its unsupported dependency" >&2
  exit 1
fi

deferred_report="$tmp/.lake/build/vir/module-sets/Smoke/DeferredRuntime.report.md"
test -f "$deferred_report"
grep -q '^- `IO.getEnv` (via Smoke.DeferredRuntime.home.*Smoke.OpaqueDependency.environmentHome.*IO.getEnv)' \
  "$deferred_report"
if grep -q '^## Blocking Dependency Paths' "$deferred_report"; then
  echo "deprecated duplicate blocker-path report section was generated" >&2
  exit 1
fi

package="$tmp/.lake/build/vir/module-sets/Smoke/Runtime.irpkg"
report="$tmp/.lake/build/vir/module-sets/Smoke/Runtime.report.md"
test -f "$package"
test -f "$report"

rm -f "$report"
lake -d "$tmp" build +Smoke.Runtime:vir
test -f "$report"

module_package="$tmp/.lake/build/vir/module-sets/Smoke/NewRuntime.irpkg"
module_descriptor="$tmp/.lake/build/vir/module-sets/Smoke/NewRuntime.irpkg-set.json"
module_driver="$tmp/.lake/build/vir/drivers/Smoke/NewRuntime.lean"
test -f "$module_package"
test -f "$module_descriptor"
test -f "$module_driver"

node "$repo/scripts/packages/inspect-irpkg.mjs" --json "$package" > "$tmp/package.json"
node --input-type=module -e '
  import fs from "node:fs";
  const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).manifest;
  const entries = Object.fromEntries(manifest.exports.map((entry) => [entry.entry, entry]));
  if (entries["Smoke.Runtime.value"]?.startup !== false) process.exit(1);
  if (entries["Smoke.Runtime.start"]?.startup !== true) process.exit(1);
' "$tmp/package.json"

node "$repo/scripts/packages/inspect-irpkg.mjs" --json "$module_package" > "$tmp/module-package.json"
node --input-type=module -e '
  import fs from "node:fs";
  const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).manifest;
  const entries = Object.fromEntries(manifest.exports.map((entry) => [entry.entry, entry]));
  if (manifest.exports.length !== 2) process.exit(1);
  if (entries["Smoke.NewRuntime.value"]?.startup !== false) process.exit(1);
  if (entries["Smoke.NewRuntime.start"]?.startup !== true) process.exit(1);
  if (entries["Smoke.Dependency.importedValue"] !== undefined) process.exit(1);
' "$tmp/module-package.json"

printf '%s\n' \
  'module' \
  '' \
  'public meta import Vir.Attributes' \
  'public import Smoke.OpaqueDependency' \
  '' \
  '@[vir_export]' \
  'public def Smoke.NewRuntime.value : IO String :=' \
  '  Smoke.OpaqueDependency.environmentHome' > "$tmp/Smoke/NewRuntime.lean"

if lake -d "$tmp" build +Smoke.NewRuntime:vir \
    > "$tmp/rebuild-failure.stdout" 2> "$tmp/rebuild-failure.stderr"; then
  echo "unsupported replacement unexpectedly regenerated the package set" >&2
  exit 1
fi
test ! -e "$module_descriptor"
test ! -e "$module_package"

VIR_SDK_ARCHIVE="$tmp/lean-vir-sdk.tar.gz" lake -d "$tmp" build :virSdk
test -f "$tmp/.lake/build/vir/sdk/js/vir-runtime.js"
test -f "$tmp/.lake/build/vir/sdk/lean-vir-artifact.json"

node --input-type=module -e '
  import fs from "node:fs";
  const path = process.argv[1];
  const manifest = JSON.parse(fs.readFileSync(path, "utf8"));
  manifest.gitCommit = "0".repeat(40);
  fs.writeFileSync(path, `${JSON.stringify(manifest)}\n`);
' "$tmp/.lake/build/vir/sdk/lean-vir-artifact.json"
VIR_SDK_ARCHIVE="$tmp/lean-vir-sdk.tar.gz" lake -d "$tmp" build :virSdk
node --input-type=module -e '
  import fs from "node:fs";
  const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (manifest.version !== process.argv[2]) process.exit(1);
  if (manifest.gitCommit !== process.argv[3]) process.exit(1);
' "$tmp/.lake/build/vir/sdk/lean-vir-artifact.json" "$sdk_version" "$repo_commit"

node --input-type=module -e '
  import fs from "node:fs";
  const path = process.argv[1];
  const manifest = JSON.parse(fs.readFileSync(path, "utf8"));
  manifest.version = "9.9.9";
  fs.writeFileSync(path, `${JSON.stringify(manifest)}\n`);
' "$tmp/.lake/build/vir/sdk/lean-vir-artifact.json"
VIR_SDK_ARCHIVE="$tmp/lean-vir-sdk.tar.gz" lake -d "$tmp" build :virSdk
node --input-type=module -e '
  import fs from "node:fs";
  const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (manifest.version !== process.argv[2]) process.exit(1);
  if (manifest.gitCommit !== process.argv[3]) process.exit(1);
' "$tmp/.lake/build/vir/sdk/lean-vir-artifact.json" "$sdk_version" "$repo_commit"

rm -f "$tmp/.lake/build/vir/sdk/js/vir-runtime.js"
VIR_SDK_ARCHIVE="$tmp/lean-vir-sdk.tar.gz" lake -d "$tmp" build :virSdk
grep -q 'smoke = true' "$tmp/.lake/build/vir/sdk/js/vir-runtime.js"

mkdir -p "$tmp/sdk-source-2/lean-vir-sdk/js" "$tmp/sdk-source-2/lean-vir-sdk/wasm"
printf '%s\n' 'export const smoke = false;' > "$tmp/sdk-source-2/lean-vir-sdk/js/vir-runtime.js"
printf '%s\n' 'fake-wasm-2' > "$tmp/sdk-source-2/lean-vir-sdk/wasm/vir-upstream.wasm"
sdk_hash="$(sha256sum "$tmp/sdk-source-2/lean-vir-sdk/js/vir-runtime.js" | cut -d' ' -f1)"
wasm_hash="$(sha256sum "$tmp/sdk-source-2/lean-vir-sdk/wasm/vir-upstream.wasm" | cut -d' ' -f1)"
write_sdk_manifest "$tmp/sdk-source-2/lean-vir-sdk" "$repo_commit" "$sdk_hash" "$wasm_hash"
tar -czf "$tmp/lean-vir-sdk-2.tar.gz" -C "$tmp/sdk-source-2" lean-vir-sdk

VIR_SDK_ARCHIVE="$tmp/lean-vir-sdk-2.tar.gz" lake -d "$tmp" build :virSdk
grep -q 'smoke = false' "$tmp/.lake/build/vir/sdk/js/vir-runtime.js"

VIR_SDK_ARCHIVE="$tmp/lean-vir-sdk-2.tar.gz" lake -d "$tmp" build smoke_app
grep -q 'smoke = false' "$web_assets/sdk/js/vir-runtime.js"
test -f "$web_manifest"

echo "VIR Lake facet smoke ok"
