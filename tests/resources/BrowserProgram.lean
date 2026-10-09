/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

meta import Vir.Attributes
public import fixtures.FormatPretty

@[vir_export]
public def Vir.Resources.Test.prettyScore : Nat :=
  Vir.Fixtures.FormatPretty.formatPrettyScore

@[vir_export]
public def Vir.Resources.Test.leanError : IO Unit :=
  throw (IO.userError "resource recoverable error")

-- Startup markers remain callable exports, not an automatic creation action.
@[vir_startup]
public def Vir.Resources.Test.manualStartup : IO Unit :=
  throw (IO.userError "startup requires an explicit call")
