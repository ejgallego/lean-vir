/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { assertUnsupportedInterfaceSource } from "./shared.mjs";

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
  ], [
    "indexedPairIdentity",
    "implicitBump",
    "polymorphicJsIdentity",
    "nakedElementIdentity",
    "nakedReactRootIdentity",
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
}
