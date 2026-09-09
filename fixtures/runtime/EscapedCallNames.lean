/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public meta import Vir.Attributes
public meta import Lean.Elab.Command
public meta import Lean.AddDecl

public section

@[vir_export] def «foo.bar» (n : Nat) : Nat :=
  n + 1

@[vir_export] def Numeric.«1» (n : Nat) : Nat :=
  n + 2

-- Exercise the Name.toString contract, not the C++ diagnostic printer.
@[vir_export] def café (n : Nat) : Nat := n + 3
@[vir_export] def αβ₁ (n : Nat) : Nat := n + 4
@[vir_export] def «#meta».«part.with.dot» (n : Nat) : Nat := n + 5
@[vir_export] def «?mvar».«part.with.dot» (n : Nat) : Nat := n + 6
@[vir_export] def Inaccessible.«part.with.dot✝» (n : Nat) : Nat := n + 7
@[vir_export] def Nested.«?part» (n : Nat) : Nat := n + 9

-- These structural names cannot all be expressed by source identifier syntax.
-- Marker selection also includes _hyg names that auto-discovery omits as auxiliaries.
run_elab do
  let .defnInfo original ← Lean.getConstInfo `Numeric.«1» | throwError "missing fixture"
  for name in [Lean.Name.str `Empty "", Lean.Name.str `Closing "»",
      Lean.Name.str `Hygienic.«part.with.dot» "_hyg",
      Lean.Name.num `Numeral 1, Lean.Name.num `Hygienic.«numeric.part»._hyg 2,
      Lean.Name.num `Inaccessible.«numeric.part✝» 3] do
    Lean.addAndCompile (.defnDecl { original with name := name })
    vir_export.add name
