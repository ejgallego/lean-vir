/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import {
  assert,
  assertUnsupportedInterfaceFixture,
  join,
  readFile,
  runVirIrpkg,
  spawnSync,
  writeRuntimeFixture,
} from "./shared.mjs";

export async function runUnsupportedInterfaceSmoke(freshDir) {
  await assertUnsupportedInterfaceFixture(freshDir, "UnsupportedInterfaces.lean", [
    /indexedPairIdentity/,
    /indexed inductive `IndexedPair` is not supported/,
    /implicitBump/,
    /unsupported implicit\/instance argument `offset`/,
    /polymorphicJsIdentity/,
    /polymorphic exported entrypoints with erased type parameters are not supported/,
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
    /unsupported JavaScript import argument `n`/,
    /raw Lean type `Nat` is not a JavaScript boundary type/,
    /jsBumpCounter/,
    /unsupported JavaScript import argument `counter`/,
    /structure `HostCounter` is not a JavaScript boundary type/,
    /jsCallbackResult/,
    /unsupported JavaScript import result/,
    /callback `Function` is not a JavaScript boundary type/,
  ], ["freshCustomBump", "freshCustomCounter", "freshCustomCallbackResult"]);

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
    /declaration is marked with `@\[vir_js_explicit_conversion\]`/,
    /js\.value\.bad\.action/,
    /does not convert between exactly one `Lean\.Vir\.Js \.\.\.` resource and one Lean value/,
  ], ["Vir.Fixtures.BadJsValue.roundtripFeed"]);

  const badJslStringSource = join(freshDir, "BadJSLString.lean");
  await writeRuntimeFixture(badJslStringSource, "BadJSLString.lean");
  const builtVirJs = spawnSync("lake", ["build", "Vir.Js"], {
    encoding: "utf8",
  });
  assert.equal(
    builtVirJs.status,
    0,
    `failed to build Vir.Js before BadJSLString typecheck:\n${builtVirJs.stderr}${builtVirJs.stdout}`,
  );
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
  const packagePath = join(freshDir, "CollisionTargets.irpkg");
  const reportPath = join(freshDir, "CollisionTargets.report.md");
  await writeRuntimeFixture(leftSource, "CollisionLeft.lean");
  await writeRuntimeFixture(rightSource, "CollisionRight.lean");
  const generated = runVirIrpkg([
    packagePath,
    reportPath,
    "--target",
    leftSource,
    "collisionBump",
    "--target",
    rightSource,
    "collisionBump",
  ]);
  assert.notEqual(generated.status, 0, "duplicate target declarations unexpectedly generated successfully");
  assert.match(generated.stderr, /package diagnostics/);
  assert.match(generated.stderr, /collisionBump/);
  assert.match(generated.stderr, /declaration name collides/);
  const report = await readFile(reportPath, "utf8");
  assert.match(report, /collisionBump/);
  assert.match(report, /declaration name collides/);
}
