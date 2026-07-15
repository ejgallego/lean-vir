/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.GeneratePackage.Basic

open Lean

namespace Vir.GeneratePackage

def jsonString (text : String) : String :=
  Lean.Json.renderString text

def jsonArray (items : Array String) : String :=
  "[" ++ ",".intercalate items.toList ++ "]"

def jsonObject (fields : Array (String × String)) : String :=
  let entries := fields.map fun (name, value) => jsonString name ++ ":" ++ value
  "{" ++ ",".intercalate entries.toList ++ "}"

def jsonBool (value : Bool) : String :=
  if value then "true" else "false"

def jsonNat (value : Nat) : String :=
  toString value

def jsonName (name : Name) : String :=
  jsonString name.toString

end Vir.GeneratePackage
