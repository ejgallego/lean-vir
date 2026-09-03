#!/usr/bin/env bash
#
# Copyright (c) 2026 Lean FRO LLC. All rights reserved.
# Released under Apache 2.0 license as described in the file LICENSE.
# Author: Emilio J. Gallego Arias

set -euo pipefail

cd "$(dirname "$0")/../.."

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

assert_module_fixture_descriptor() {
  node --input-type=module -e '
    import fs from "node:fs";
    const descriptor = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (descriptor.format !== "lean-vir-ir-package-set") process.exit(1);
    if (descriptor.version !== 2) process.exit(1);
    for (const entry of descriptor.packages) {
      if (!Number.isSafeInteger(entry.byteLength) || entry.byteLength <= 0) process.exit(1);
      if (!/^[0-9a-f]{64}$/.test(entry.sha256)) process.exit(1);
    }
    const actual = descriptor.packages.map(({ module, role, path }) => [module, role, path]);
    const expected = [
      ["ModuleSetFixture.Shared", "dependency", "Root.parts/ModuleSetFixture.Shared.irpkg"],
      ["ModuleSetFixture.Left", "dependency", "Root.parts/ModuleSetFixture.Left.irpkg"],
      ["ModuleSetFixture.Right", "dependency", "Root.parts/ModuleSetFixture.Right.irpkg"],
      ["ModuleSetFixture.InternalBase", "dependency", "Root.parts/ModuleSetFixture.InternalBase.irpkg"],
      ["ModuleSetFixture.Facade", "dependency", "Root.parts/ModuleSetFixture.Facade.irpkg"],
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
module_set_root_hash="$(sha256sum "$module_set_root" | cut -d' ' -f1)"
module_set_shared_hash="$(sha256sum "$module_set_shared" | cut -d' ' -f1)"

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
test "$(sha256sum "$module_set_root" | cut -d' ' -f1)" = "$module_set_root_hash"
test "$(sha256sum "$module_set_shared" | cut -d' ' -f1)" = "$module_set_shared_hash"

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

printf '%s\n' 'corrupt-member-bytes' >> "$module_set_shared"
test "$(sha256sum "$module_set_shared" | cut -d' ' -f1)" != "$module_set_shared_hash"
lake build +ModuleSetFixture.Root:vir
test "$(sha256sum "$module_set_shared" | cut -d' ' -f1)" = "$module_set_shared_hash"
assert_module_fixture_descriptor "$module_set"

node "$repo/scripts/packages/inspect-irpkg.mjs" --json "$canvas_package" > "$tmp/canvas-package.json"
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

cp lean-toolchain "$tmp/lean-toolchain"

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
  'meta import Vir.Attributes' \
  '' \
  '@[vir_export]' \
  'public def Lean.SmokeDependency.importedValue : Nat := 41' > "$tmp/Smoke/Dependency.lean"

printf '%s\n' \
  'module' \
  '' \
  'meta import Vir.Attributes' \
  'public import Smoke.Dependency' \
  '' \
  '@[vir_export]' \
  'public def Smoke.NewRuntime.value : Nat :=' \
  '  Lean.SmokeDependency.importedValue + 2' \
  '' \
  '@[vir_startup]' \
  'public def Smoke.NewRuntime.start : Unit := ()' > "$tmp/Smoke/NewRuntime.lean"

printf '%s\n' \
  'module' \
  '' \
  'meta import Vir.Attributes' \
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
  '#check Vir.GeneratePackage.TargetMode' \
  '#check Vir.GeneratePackage.TargetMode.explicit' \
  '#check Vir.GeneratePackage.TargetMode.packageOnly' \
  '#check Vir.GeneratePackage.TargetMode.markedModule' \
  '#check Vir.parseDottedName' \
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
  'meta import Vir.Attributes' \
  'meta import Vir.ExternFallback' \
  '' \
  '@[extern "smoke_client_native_first"]' \
  'public def Smoke.ClientNative.first (value : UInt32) : UInt32 := value + 1' \
  '' \
  '@[extern "smoke_client_native_second"]' \
  'public def Smoke.ClientNative.second (value : UInt32) : UInt32 := value + 2' \
  '' \
  'vir_extern_fallback Smoke.ClientNative.first, Smoke.ClientNative.second' \
  '' \
  '@[vir_export]' \
  'public def Smoke.ClientNative.value (value : UInt32) : UInt32 :=' \
  '  Smoke.ClientNative.first value + Smoke.ClientNative.second value' > "$tmp/Smoke/ClientNative.lean"

printf '%s\n' \
  '#include <stdint.h>' \
  'uint32_t smoke_client_native_first(uint32_t value) { return value + 1; }' \
  'uint32_t smoke_client_native_second(uint32_t value) { return value + 2; }' \
  > "$tmp/client-native.c"

write_client_native_manifest() {
  local externs="$1"
  printf '%s\n' \
    '{' \
    '  "format": "lean-vir-client-native-externs",' \
    '  "version": 1,' \
    '  "modules": ["Smoke.ClientNative"],' \
    "  \"externs\": $externs," \
    '  "providerSources": ["client-native.c"]' \
    '}' > "$tmp/client-native.json"
}

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
  'meta import Vir.Attributes' \
  'public import Smoke.OpaqueDependency' \
  '' \
  '@[vir_export]' \
  'public def Smoke.DeferredRuntime.home : IO String :=' \
  '  Smoke.OpaqueDependency.environmentHome' > "$tmp/Smoke/DeferredRuntime.lean"

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

lake -d "$tmp" build Smoke.InterfaceClassifier
lake -d "$tmp" build Smoke.PackagePipeline
lake -d "$tmp" build +Smoke.Runtime:vir
lake -d "$tmp" build +Smoke.NewRuntime:vir

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
module_dependency="$tmp/.lake/build/vir/module-sets/Smoke/NewRuntime.parts/Smoke.Dependency.irpkg"
module_driver="$tmp/.lake/build/vir/drivers/Smoke/NewRuntime.lean"
test -f "$module_package"
test -f "$module_descriptor"
test -f "$module_dependency"
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
  if (manifest.metadata.targets[0]?.mode !== "markedModules") process.exit(1);
  if (manifest.exports.length !== 2) process.exit(1);
  if (entries["Smoke.NewRuntime.value"]?.startup !== false) process.exit(1);
  if (entries["Smoke.NewRuntime.start"]?.startup !== true) process.exit(1);
  if (entries["Lean.SmokeDependency.importedValue"] !== undefined) process.exit(1);
' "$tmp/module-package.json"

module_dependency_hash_before="$(sha256sum "$module_dependency" | cut -d' ' -f1)"
printf '%s\n' \
  'module' \
  '' \
  'meta import Vir.Attributes' \
  '' \
  '@[vir_export]' \
  'public def Lean.SmokeDependency.importedValue : Nat := 42' > "$tmp/Smoke/Dependency.lean"
lake -d "$tmp" build +Smoke.NewRuntime:vir
module_dependency_hash_after="$(sha256sum "$module_dependency" | cut -d' ' -f1)"
if [ "$module_dependency_hash_before" = "$module_dependency_hash_after" ]; then
  echo "imported implementation change did not invalidate the VIR dependency shard" >&2
  exit 1
fi

printf '%s\n' \
  'module' \
  '' \
  'meta import Vir.Attributes' \
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

client_native_package="$tmp/.lake/build/vir/module-sets/Smoke/ClientNative.irpkg"
client_native_report="$tmp/.lake/build/vir/module-sets/Smoke/ClientNative.report.md"
write_client_native_manifest \
  '["Smoke.ClientNative.first", "Smoke.ClientNative.second"]'
VIR_NATIVE_EXTERN_MANIFEST="$tmp/client-native.json" \
  lake -d "$tmp" build +Smoke.ClientNative:vir
client_native_first_hash="$(sha256sum "$client_native_package" | cut -d' ' -f1)"

printf '%s\n' 'stale-client-native-report' > "$client_native_report"
write_client_native_manifest \
  '["Smoke.ClientNative.second", "Smoke.ClientNative.first"]'
VIR_NATIVE_EXTERN_MANIFEST="$tmp/client-native.json" \
  lake -d "$tmp" build +Smoke.ClientNative:vir
client_native_second_hash="$(sha256sum "$client_native_package" | cut -d' ' -f1)"
if grep -q 'stale-client-native-report' "$client_native_report"; then
  echo "client-native manifest contents did not invalidate the VIR package-set facet" >&2
  exit 1
fi
test "$client_native_first_hash" = "$client_native_second_hash"

printf '%s\n' 'stale-client-native-report' > "$client_native_report"
lake -d "$tmp" build +Smoke.ClientNative:vir
client_native_fallback_hash="$(sha256sum "$client_native_package" | cut -d' ' -f1)"
if grep -q 'stale-client-native-report' "$client_native_report"; then
  echo "removing the client-native manifest profile did not invalidate the VIR package-set facet" >&2
  exit 1
fi
if [ "$client_native_second_hash" = "$client_native_fallback_hash" ]; then
  echo "removing the client-native manifest profile did not change the VIR package set" >&2
  exit 1
fi

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
