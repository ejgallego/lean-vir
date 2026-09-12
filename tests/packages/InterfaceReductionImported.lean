/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import InterfaceReduction
public meta import Vir.Attributes

public section

open InterfaceReduction

-- Check exported values/layout metadata, not just the defining environment.
@[vir_export] def importedProjection (x : Text) : Text := x
@[vir_export] def importedGenericProjection (x : (carrierOf String).type) : String := x
@[vir_export] def importedConstantFamily (x : FamilyValue (fun _ => String)) :
    FamilyValue (fun _ => String) := x
