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
  ], ["freshCustomBump", "freshCustomCounter"]);

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
