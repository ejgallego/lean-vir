/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import {
  assert,
  assertUnsupportedInterfaceFixture,
  assertUnsupportedInterfaceSource,
  ensureVirJsBuilt,
  join,
  readFile,
  runVirIrpkg,
  spawnSync,
  writeFile,
  writeRuntimeFixture,
} from "./shared.mjs";

const implicitHostImportReason =
  /unsupported JavaScript import signature: implicit or instance argument `value` is not supported; declare a wrapper with only explicit arguments/;
const rawNatHostArgumentReason =
  /unsupported JavaScript import argument `n`: raw Lean type `Nat` is not a JavaScript boundary type; use `Unit`, `Lean\.Vir\.Js \.\.\.`, `Lean\.Vir\.Js\.Nullable \.\.\.`, top-level callback arguments, or explicit conversion calls/;
const callbackHostResultReason =
  /unsupported JavaScript import result: callback `Function` is not a JavaScript boundary type; use `Unit`, `Lean\.Vir\.Js \.\.\.`, `Lean\.Vir\.Js\.Nullable \.\.\.`, top-level callback arguments, or explicit conversion calls/;
const explicitConversionReason =
  /declaration is marked with `@\[vir_js_explicit_conversion\]`, but `js\.value\.bad\.action` does not convert between exactly one `Lean\.Vir\.Js \.\.\.` resource and one Lean value/;

async function assertInvalidHostAttributeSource(freshDir, stem, lines, patterns) {
  ensureVirJsBuilt();
  const source = join(freshDir, `${stem}.lean`);
  await writeFile(source, lines.join("\n"));
  const checked = spawnSync("lake", ["env", "lean", source], { encoding: "utf8" });
  assert.notEqual(checked.status, 0, `${stem} unexpectedly elaborated successfully`);
  const output = `${checked.stderr}${checked.stdout}`;
  for (const pattern of patterns) assert.match(output, pattern);
}

export async function runUnsupportedInterfaceSmoke(freshDir) {
  await assertInvalidHostAttributeSource(freshDir, "InvalidImplicitHostAttribute", [
    "import Vir.Host",
    "import Vir.Js",
    "",
    "@[vir_js \"test.implicitValue\"]",
    "opaque jsImplicitValue {value : Lean.Vir.Js Nat} : Lean.Vir.RuntimeM Unit",
    "",
  ], [
    /invalid `@\[vir_js\]` declaration `jsImplicitValue`/,
    implicitHostImportReason,
  ]);

  await assertInvalidHostAttributeSource(freshDir, "InvalidHostBoundaryAttribute", [
    "import Vir.Host",
    "",
    "@[vir_js \"test.bumpNat\"]",
    "opaque jsBumpNat (n : Nat) : Nat",
    "",
  ], [
    /invalid `@\[vir_js\]` declaration `jsBumpNat`/,
    rawNatHostArgumentReason,
  ]);

  await assertInvalidHostAttributeSource(freshDir, "InvalidHostResultAttribute", [
    "import Vir.Js",
    "",
    "@[vir_js \"test.callbackResult\"]",
    "opaque jsCallbackResult : Lean.Vir.RuntimeM (Unit → Lean.Vir.RuntimeM Unit)",
    "",
  ], [
    /invalid `@\[vir_js\]` declaration `jsCallbackResult`/,
    callbackHostResultReason,
  ]);

  await assertInvalidHostAttributeSource(freshDir, "InvalidExplicitConversionAttribute", [
    "import Vir.Host",
    "import Vir.Js",
    "",
    "@[vir_js_explicit_conversion \"js.value.bad.action\"]",
    "opaque actionToString (action : String) : Lean.Vir.RuntimeM String",
    "",
  ], [
    /invalid `@\[vir_js_explicit_conversion\]` declaration `actionToString`/,
    explicitConversionReason,
  ]);

  await assertUnsupportedInterfaceFixture(freshDir, "UnsupportedInterfaces.lean", [
    /indexedPairIdentity/,
    /indexed inductive `IndexedPair` is not supported/,
    /implicitBump/,
    /VIR exports cannot have implicit or instance arguments \(`offset`\); export a wrapper with only explicit arguments/,
    /polymorphicJsIdentity/,
    /VIR exports must use concrete runtime types; type parameter `α` is erased; export a concrete wrapper instead/,
    /nakedElementIdentity/,
    /JavaScript object marker `Lean\.Vir\.Browser\.Element` must appear under `Lean\.Vir\.Js`/,
    /nakedReactRootIdentity/,
    /JavaScript object marker `Lean\.Vir\.React\.Root` must appear under `Lean\.Vir\.Js`/,
    /nakedStateSetterIdentity/,
    /unsupported type `Lean\.Vir\.React\.StateSetter Nat`/,
    /nakedPropsIdentity/,
    /unsupported type `Lean\.Vir\.React\.Props`/,
  ], [
    "indexedPairIdentity",
    "implicitBump",
    "polymorphicJsIdentity",
    "nakedElementIdentity",
    "nakedReactRootIdentity",
    "nakedStateSetterIdentity",
    "nakedPropsIdentity",
  ]);

  await assertUnsupportedInterfaceFixture(freshDir, "UnsupportedRecursiveInductives.lean", [
    /recursiveChildIdentity/,
    /recursive inherited structure `RecursiveChild` is not supported/,
    /mutualLeftIdentity/,
    /mutually recursive inductive `MutualLeft` is not supported/,
    /proofPayloadIdentity/,
    /field `proof` of constructor `ProofPayload\.mk` has erased or void runtime layout/,
  ], ["recursiveChildIdentity", "mutualLeftIdentity", "proofPayloadIdentity"]);

  await assertUnsupportedInterfaceFixture(freshDir, "FreshCustomHost.lean", [
    /jsBumpNat/,
    rawNatHostArgumentReason,
    /jsBumpCounter/,
    /unsupported JavaScript import argument `counter`/,
    /structure `HostCounter` is not a JavaScript boundary type/,
    /jsCallbackResult/,
    callbackHostResultReason,
    /jsNestedCallbackArg/,
    /unsupported JavaScript import argument `callback`/,
    /callback `Function` is not a JavaScript boundary type/,
    /jsArrayLength/,
    /unsupported JavaScript import argument `arrayItems`/,
    /array `Array Js` is not a JavaScript boundary type/,
    /jsListLength/,
    /unsupported JavaScript import argument `listItems`/,
    /list `List Js` is not a JavaScript boundary type/,
    /jsOptionValue/,
    /unsupported JavaScript import argument `value`/,
    /option `Option Js` is not a JavaScript boundary type/,
    /jsProdValue/,
    /unsupported JavaScript import argument `value`/,
    /product `Js × Js` is not a JavaScript boundary type/,
  ], [
    "freshCustomBump",
    "freshCustomCounter",
    "freshCustomCallbackResult",
    "freshCustomNestedCallbackArg",
    "freshCustomArrayLength",
    "freshCustomListLength",
    "freshCustomOptionValue",
    "freshCustomProdValue",
  ]);

  await assertUnsupportedInterfaceSource(freshDir, "ImplicitHostImport", [
    "import Vir.Host",
    "import Vir.Js",
    "",
    "-- Bypass `@[vir_js]` so package generation still exercises its final fallback.",
    "@[extern \"__vir_js:test.implicitValue\"]",
    "opaque jsImplicitValue {value : Lean.Vir.Js Nat} : Lean.Vir.RuntimeM Unit",
    "",
    "def callImplicitValue (value : Lean.Vir.Js Nat) : Lean.Vir.RuntimeM Unit :=",
    "  jsImplicitValue (value := value)",
    "",
  ], [
    /jsImplicitValue/,
    implicitHostImportReason,
  ], ["callImplicitValue"]);

  await assertUnsupportedInterfaceFixture(freshDir, "BadLeanRef.lean", [
    /actionToJs/,
    /unsupported JavaScript import argument `action`/,
    /inductive `Vir\.Fixtures\.BadLeanRef\.Action` is not a JavaScript boundary type/,
    /actionFromJs/,
    /unsupported JavaScript import result/,
    /inductive `Vir\.Fixtures\.BadLeanRef\.Action` is not a JavaScript boundary type/,
  ], ["Vir.Fixtures.BadLeanRef.roundtripFeed"]);

  await assertUnsupportedInterfaceFixture(freshDir, "BadJsValue.lean", [
    /actionToString/,
    explicitConversionReason,
  ], ["Vir.Fixtures.BadJsValue.roundtripFeed"]);

  const badJslStringSource = join(freshDir, "BadJSLString.lean");
  await writeRuntimeFixture(badJslStringSource, "BadJSLString.lean");
  ensureVirJsBuilt();
  const checkedBadJslString = spawnSync("lake", ["env", "lean", badJslStringSource], {
    encoding: "utf8",
  });
  assert.notEqual(checkedBadJslString.status, 0, "LeanRef-wrapped String unexpectedly typechecked as Js String");
  const badJslStringOutput = `${checkedBadJslString.stderr}${checkedBadJslString.stdout}`;
  assert.match(badJslStringOutput, /Application type mismatch/);
  assert.match(badJslStringOutput, /Lean\.Vir\.JSL String/);
  assert.match(badJslStringOutput, /Lean\.Vir\.Js String/);

  await assertUnsupportedInterfaceFixture(freshDir, "DuplicateExportNames.lean", [
    /Duplicate\.entry/,
    /Duplicate_entry/,
    /interface export id `Duplicate_entry` duplicates/,
  ]);

  const leftSource = join(freshDir, "CollisionLeft.lean");
  const rightSource = join(freshDir, "CollisionRight.lean");
  const packageFallbackMarkerSource = join(freshDir, "PackageFallbackMarkers.lean");
  const packagePath = join(freshDir, "PackageDiagnostics.irpkg");
  const reportPath = join(freshDir, "PackageDiagnostics.report.md");
  await writeRuntimeFixture(leftSource, "CollisionLeft.lean");
  await writeRuntimeFixture(rightSource, "CollisionRight.lean");
  // Bypass the attribute callbacks to exercise the final package-time contract guards.
  await writeFile(packageFallbackMarkerSource, [
    "import Vir",
    "",
    "namespace PackageFallbackMarkers",
    "",
    "def badErased {α : Type} (value : α) : α := value",
    "",
    "def badImplicit {offset : Nat} (n : Nat) : Nat := n + offset",
    "",
    "def badArguments (_n : Nat) : Unit := ()",
    "",
    "def badResult : IO Nat := pure 1",
    "",
    "def badPureResult : Nat := 1",
    "",
    "run_meta vir_export.add `PackageFallbackMarkers.badErased",
    "run_meta vir_export.add `PackageFallbackMarkers.badImplicit",
    "run_meta vir_startup.add `PackageFallbackMarkers.badArguments",
    "run_meta vir_startup.add `PackageFallbackMarkers.badResult",
    "run_meta vir_startup.add `PackageFallbackMarkers.badPureResult",
    "",
    "end PackageFallbackMarkers",
    "",
  ].join("\n"));
  const generated = runVirIrpkg([
    packagePath,
    reportPath,
    "--target",
    leftSource,
    "collisionBump",
    "--target",
    rightSource,
    "collisionBump",
    "--target-marked",
    packageFallbackMarkerSource,
  ]);
  assert.notEqual(generated.status, 0, "unsupported package targets unexpectedly generated successfully");
  assert.match(generated.stderr, /package diagnostics/);
  assert.match(generated.stderr, /collisionBump/);
  assert.match(generated.stderr, /declaration name collides/);
  assert.match(
    generated.stderr,
    /PackageFallbackMarkers\.badErased: VIR exports must use concrete runtime types; type parameter `α` is erased; export a concrete wrapper instead/,
  );
  assert.match(
    generated.stderr,
    /PackageFallbackMarkers\.badImplicit: VIR exports cannot have implicit or instance arguments \(`offset`\); export a wrapper with only explicit arguments/,
  );
  assert.match(
    generated.stderr,
    /PackageFallbackMarkers\.badArguments: VIR startup hooks cannot declare parameters \(`_n`\); define a zero-argument wrapper instead/,
  );
  assert.match(
    generated.stderr,
    /PackageFallbackMarkers\.badResult: VIR startup hooks using `IO` must return `Unit`; got `Nat`/,
  );
  assert.match(
    generated.stderr,
    /PackageFallbackMarkers\.badPureResult: VIR startup hooks must return `Unit`; got `Nat`/,
  );
  const report = await readFile(reportPath, "utf8");
  assert.match(report, /collisionBump/);
  assert.match(report, /declaration name collides/);
  assert.match(report, /PackageFallbackMarkers\.badErased/);
  assert.match(report, /PackageFallbackMarkers\.badImplicit/);
  assert.match(report, /PackageFallbackMarkers\.badArguments/);
  assert.match(report, /PackageFallbackMarkers\.badResult/);
  assert.match(report, /PackageFallbackMarkers\.badPureResult/);
}
