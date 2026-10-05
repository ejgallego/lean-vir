/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.Resources.Embed

/-- Complete runtime bytes prepared by this module's library prerequisite. -/
public def Vir.Resources.Runtime.bundle : Vir.Resources.Bundle :=
  include_vir_library VirResourceRuntime
