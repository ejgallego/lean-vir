/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import {
  assert,
  assertUnsupportedInterfaceSource,
  join,
  readFile,
  runVirIrpkg,
  writeFile,
} from "./shared.mjs";

export async function runUnsupportedInterfaceSmoke(freshDir) {
  await assertUnsupportedInterfaceSource(freshDir, "UnsupportedInterfaces", [
    "import Vir.React",
    "",
    "inductive IndexedPair : Nat → Type where",
    "  | mk (left : Nat) (right : Nat) : IndexedPair 0",
    "",
    "def indexedPairIdentity (box : IndexedPair 0) : IndexedPair 0 := box",
    "def implicitBump {offset : Nat} (n : Nat) : Nat := n + offset",
    "def polymorphicJsIdentity {α : Type} (value : Lean.Vir.Js α) : Lean.Vir.Js α := value",
    "def nakedElementIdentity (element : Lean.Vir.Browser.Element) : Lean.Vir.Browser.Element := element",
    "def nakedReactRootIdentity (root : Lean.Vir.React.Root) : Lean.Vir.React.Root := root",
    "def nakedStateSetterIdentity (setter : Lean.Vir.React.StateSetter Nat) : Lean.Vir.React.StateSetter Nat := setter",
    "def nakedPropsIdentity (props : Lean.Vir.React.Props) : Lean.Vir.React.Props := props",
    "",
  ], [
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

  await assertUnsupportedInterfaceSource(freshDir, "UnsupportedRecursiveInductives", [
    "structure RecursiveBase where",
    "  label : String",
    "",
    "structure RecursiveChild extends RecursiveBase where",
    "  next : Option RecursiveChild",
    "",
    "mutual",
    "inductive MutualLeft where",
    "  | leaf (value : Nat)",
    "  | step (right : MutualRight)",
    "inductive MutualRight where",
    "  | step (left : MutualLeft)",
    "end",
    "",
    "inductive ProofPayload where",
    "  | mk (value : Nat) (proof : value = value)",
    "",
    "def recursiveChildIdentity (box : RecursiveChild) : RecursiveChild := box",
    "def mutualLeftIdentity (value : MutualLeft) : MutualLeft := value",
    "def proofPayloadIdentity (value : ProofPayload) : ProofPayload := value",
    "",
  ], [
    /recursiveChildIdentity/,
    /recursive inherited structure `RecursiveChild` is not supported/,
    /mutualLeftIdentity/,
    /mutually recursive inductive `MutualLeft` is not supported/,
    /proofPayloadIdentity/,
    /field `proof` of constructor `ProofPayload\.mk` has erased or void runtime layout/,
  ], ["recursiveChildIdentity", "mutualLeftIdentity", "proofPayloadIdentity"]);

  await assertUnsupportedInterfaceSource(freshDir, "DuplicateExportNames", [
    "namespace Duplicate",
    "def entry (n : Nat) : Nat := n + 1",
    "end Duplicate",
    "",
    "def Duplicate_entry (n : Nat) : Nat := n + 2",
    "",
  ], [
    /Duplicate\.entry/,
    /Duplicate_entry/,
    /interface export id `Duplicate_entry` duplicates/,
  ]);

  const leftSource = join(freshDir, "CollisionLeft.lean");
  const rightSource = join(freshDir, "CollisionRight.lean");
  const packagePath = join(freshDir, "CollisionTargets.irpkg");
  const reportPath = join(freshDir, "CollisionTargets.report.md");
  await writeFile(leftSource, "def collisionBump (n : Nat) : Nat := n + 1\n");
  await writeFile(rightSource, "def collisionBump (n : Nat) : Nat := n + 2\n");
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
