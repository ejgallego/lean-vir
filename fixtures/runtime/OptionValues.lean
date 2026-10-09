/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

meta import Vir.Attributes
public import Vir.Js

public section

open Lean.Vir

namespace OptionValues

@[vir_export]
def nestedSample (choice : Nat) : Option (Option Nat) :=
  match choice with
  | 0 => none
  | 1 => some none
  | _ => some (some 900719925474099312345678901234567890)

@[vir_export]
def nestedIdentity (value : Option (Option Nat)) : Option (Option Nat) := value

@[vir_export]
def nestedKind : Option (Option Nat) → Nat
  | none => 0
  | some none => 1
  | some (some _) => 2

@[vir_export]
def nestedAmount : Option (Option Nat) → Nat
  | some (some value) => value
  | _ => 0

@[vir_export]
def nestedSampleKind (choice : Nat) : Nat := nestedKind (nestedSample choice)

@[vir_export]
def unitSample (present : Bool) : Option Unit := if present then some () else none

@[vir_export]
def unitIdentity (value : Option Unit) : Option Unit := value

@[vir_export]
def unitPresent (value : Option Unit) : Bool := value.isSome

@[vir_export]
def unitSamplePresent (present : Bool) : Bool := (unitSample present).isSome

@[vir_export]
def wrapJs (value : Js.Any) : Option Js.Any := some value

@[vir_export]
def jsIdentity (value : Option Js.Any) : Option Js.Any := value

@[vir_export]
def jsArrayIdentity (value : Array (Option Js.Any)) : Array (Option Js.Any) := value

@[vir_export]
def jsPresent (value : Option Js.Any) : Bool := value.isSome

@[vir_export]
def wrapJsPresent (value : Js.Any) : Bool := (wrapJs value).isSome

@[vir_export]
def nullableIdentity (value : Js.Nullable String) : Js.Nullable String := value

@[vir_export]
def undefinedOrIdentity (value : Js.UndefinedOr String) : Js.UndefinedOr String := value

structure Bundle where
  nested : Option (Option Nat)
  marker : Option Unit
  items : Array (Option (Option Nat))
  pair : Option Nat × Option String

@[vir_export]
def bundleSample : Bundle :=
  { nested := some none, marker := some (),
    items := #[none, some none, some (some 7)], pair := (none, some "α雪") }

@[vir_export]
def bundleIdentity (value : Bundle) : Bundle := value

@[vir_export]
def bundleObservation (value : Bundle) : Nat :=
  nestedKind value.nested * 1000 + (if value.marker.isSome then 100 else 0)
    + value.items.foldl (fun acc item => acc + nestedKind item) 0
    + (if value.pair.1.isSome then 10 else 0) + (if value.pair.2.isSome then 1 else 0)

inductive Tree where
  | leaf (value : Nat)
  | next (child : Option (Sum Tree Bool))

@[vir_export]
def treeSample : Tree := .next (some (.inl (.leaf 19)))

@[vir_export]
def treeIdentity (value : Tree) : Tree := value

@[vir_export]
def treeScore : Tree → Nat
  | .leaf n => n
  | .next none => 1
  | .next (some (.inr b)) => if b then 2 else 3
  | .next (some (.inl child)) => 10 + treeScore child

@[vir_export]
def callback (increment : Nat) : RuntimeM (Option Nat → Option Nat) :=
  pure fun value => value.map (· + increment)

@[vir_export]
def retainNat (value : Nat) : RuntimeM (JSL Nat) := LeanRef.toJSL value

@[vir_export]
def refIdentity (value : Option (JSL Nat)) : Option (JSL Nat) := value

@[vir_export]
def refAmount (value : Option (JSL Nat)) : RuntimeM Nat := do
  match value with
  | none => return 0
  | some ref => LeanRef.fromJSL ref

end OptionValues
