/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Lean.Data.Name

public section

open Lean

namespace Vir

/--
Parse the escaped syntax emitted by `Name.toString`. `String.toName` understands
quoted components such as `«A.B»`; splitting on dots does not.
-/
def parseDottedName (text : String) : Except String Name := do
  if text.isEmpty then
    throw "Lean name must be non-empty"
  let name := text.toName
  if name.isAnonymous then
    throw s!"`{text}` is not a valid Lean name"
  return name

end Vir
