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

/-- Canonical structural identity, independent of the display printer.
String components are UTF-8 hex, numeral components canonical decimal; `/`
terminates each root-to-leaf component. The anonymous name has the empty key. -/
def nameKey : Name → String
  | .anonymous => ""
  | .str pre value =>
    let hex := value.toUTF8.foldl (fun out byte =>
      let n := byte.toNat
      let digit := fun n => Char.ofNat (if n < 10 then 48 + n else 87 + n)
      out.push (digit (n / 16)) |>.push (digit (n % 16))) ""
    nameKey pre ++ "s" ++ hex ++ "/"
  | .num pre value => nameKey pre ++ "n" ++ toString value ++ "/"

end Vir
