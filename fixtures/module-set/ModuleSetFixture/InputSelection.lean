/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

meta import Vir.Attributes
public import ModuleSetFixture.Root

namespace ModuleSetFixture.InputSelection

private def helper : Nat := 7

@[vir_export]
public def selected : Nat := helper + ModuleSetFixture.Root.answer

public def unmarked : Nat := 99

end ModuleSetFixture.InputSelection

-- Compilation may execute source commands; package generation must not.
#eval IO.println "VIR_MODULE_INPUT_COMPILED"
