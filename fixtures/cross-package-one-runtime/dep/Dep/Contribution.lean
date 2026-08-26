/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public meta import Vir.Attributes

namespace Dep.Contribution

public initialize state : IO.Ref Nat ← IO.mkRef 40

@[vir_export]
public def feature : IO Nat :=
  state.get

@[vir_startup]
public def startup : IO Unit :=
  state.modify (· + 1)

end Dep.Contribution
