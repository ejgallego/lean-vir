/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public meta import Vir.Attributes
public import Dep.Contribution

namespace App.Root

@[vir_export]
public def dependencyFeature : IO Nat :=
  Dep.Contribution.feature

@[vir_export]
public def applicationFeature : Nat :=
  2

@[vir_startup]
public def startup : IO Unit :=
  Dep.Contribution.startup

end App.Root
