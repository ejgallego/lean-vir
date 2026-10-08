/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public section

inductive ConstructorSpelling where
  | plain
  | constructor

def constructorSpellingIdentity (value : ConstructorSpelling) : ConstructorSpelling :=
  value
