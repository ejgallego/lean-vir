/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

meta import Vir.Attributes
public import ModuleSetFixture.Left
public import ModuleSetFixture.Right
public import ModuleSetFixture.Facade
import ModuleSetFixture.Unreached
meta import ModuleSetFixture.MetaOnly

namespace ModuleSetFixture.Root

@[vir_export]
public def answer : Nat :=
  ModuleSetFixture.Left.value + ModuleSetFixture.Right.value +
    ModuleSetFixture.Facade.value

end ModuleSetFixture.Root
