/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
-/
module

public meta import Vir.Attributes

public section

namespace SharedBoundaryPairs

structure Box (α : Type) where
  value : α

inductive Tree (α : Type) where
  | leaf (value : α)
  | branch (optional : Option (Tree α)) (children : List (Tree α))

@[vir_export] def boxNat (value : Box Nat) : Box Nat := value
@[vir_export] def boxNatAgain (value : Box Nat) : Box Nat := value
@[vir_export] def boxString (value : Box String) : Box String := value
@[vir_export] def treeNat (value : Tree Nat) : Tree Nat := value
@[vir_export] def treeNatAgain (value : Tree Nat) : Tree Nat := value
@[vir_export] def treeString (value : Tree String) : Tree String := value

end SharedBoundaryPairs
