/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

meta import Vir.Attributes
public import Vir.Js

public section
namespace NativeValueCodecs

inductive Tree where
  | leaf (amount : Nat)
  | node (optional : Option Tree) (children : List Tree)
      (pair : Nat × Tree) (choice : Sum Tree Bool)

partial def weight : Tree → Nat
  | .leaf amount => amount
  | .node optional children pair choice =>
      1 + (optional.map weight).getD 0 + children.foldl (fun total child => total + weight child) 0
        + pair.1 + weight pair.2 + match choice with
          | .inl tree => weight tree
          | .inr flag => if flag then 1 else 0

@[vir_export] def identity (value : Tree) : Tree := value
@[vir_export] def score (value : Tree) : Nat := weight value
@[vir_export] def sample : Tree :=
  .node (some (.leaf 2)) [.leaf 5, .leaf 8] (7, .leaf 11) (.inl (.leaf 13))

@[vir_export] def nestedLists (value : List (List Nat)) : List (List Nat) := value
@[vir_export] def optionProduct (value : Option (Nat × Option (Option Unit))) := value

structure Layout where
  amount : Nat
  flag : Bool
  stride : USize
  wide : UInt64
  small : Float32

@[vir_export] def mixedLayout (value : Layout) : Layout := value

end NativeValueCodecs
