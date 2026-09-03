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

/-- Parse a nonempty dotted Lean name without accepting empty components. -/
def parseDottedName (text : String) : Except String Name := do
  if text.isEmpty then
    throw "dotted Lean name must be non-empty"
  let parts := text.splitOn "."
  if parts.any (·.isEmpty) then
    throw s!"dotted Lean name `{text}` must not contain empty components"
  return parts.foldl (fun name part => .str name part) .anonymous

end Vir
