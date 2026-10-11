/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
-/
module
public import Vir.Js
public meta import Vir.Attributes
public section

namespace DescriptorRegressions

structure ScalarWrapper where
  value : UInt32

structure BoolWrapper where
  value : Bool

structure USizeWrapper where
  value : USize

structure ScalarContainer where
  label : String
  wrapped : ScalarWrapper

structure BoolContainer where
  label : String
  wrapped : BoolWrapper

structure USizeContainer where
  label : String
  wrapped : USizeWrapper

@[vir_export] def ordinaryEntry (n : Nat) : Nat := n + 1
@[vir_export] def wrapperEntry (value : ScalarContainer) : ScalarContainer := value
@[vir_export] def boolWrapperEntry (value : BoolContainer) : BoolContainer := value
@[vir_export] def usizeWrapperEntry (value : USizeContainer) : USizeContainer := value
@[vir_export] def wrapperCallback (_ : Unit) : Lean.Vir.RuntimeM (ScalarContainer → ScalarContainer) :=
  pure fun value => value

abbrev Nats := List Nat
abbrev MoreNats := List Nats
@[vir_export] def nestedAlias (xs : List Nats) : List Nats := xs
@[vir_export] def deeperAlias (xs : List MoreNats) : List MoreNats := xs

structure Row where
  first : Nat
  second : Nat
  third : Nat

@[vir_export] def listCallback (_ : Unit) : Lean.Vir.RuntimeM (List Row → List Row) :=
  pure fun rows => rows

end DescriptorRegressions
