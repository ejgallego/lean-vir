/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module
public import Lean.Data.Json
public section

namespace JsonRpcFixture

open Lean

structure Item where
  label : String
  count : Nat
  enabled : Bool
  deriving ToJson, FromJson, BEq

inductive Selection where
  | all
  | named (name : String)
  | range (first last : Nat)
  deriving ToJson, FromJson, BEq

/-- One shared type; neither client nor server maintains a parallel JS model. -/
structure Foo where
  title : String
  primary : Item
  rows : Array Item
  selected : Option Selection
  deriving ToJson, FromJson, BEq

def sample : Foo := {
  title := "shared Foo"
  primary := { label := "primary", count := 7, enabled := true }
  rows := #[{ label := "row", count := 0, enabled := false }]
  selected := some (.range 2 4)
}

end JsonRpcFixture
