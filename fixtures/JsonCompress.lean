/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Lean

namespace Vir.Fixtures.JsonCompress

def stringCompareScore : Nat :=
  let okCount := match compare "ok" "count" with
    | .lt => 1
    | .eq => 2
    | .gt => 3
  let countOk := match compare "count" "ok" with
    | .lt => 10
    | .eq => 20
    | .gt => 30
  let okOk := match compare "ok" "ok" with
    | .lt => 100
    | .eq => 200
    | .gt => 300
  okCount + countOk + okOk

def jsonCompressObj : String :=
  Lean.Json.compress (Lean.Json.mkObj [("ok", true)])

def jsonCompressWrapperObj : String :=
  Lean.Json.compress <| Lean.Json.mkObj [
    ("ok", true),
    ("segments", Lean.Json.arr #[Lean.Json.str "alpha", Lean.Json.str "beta"])
  ]

def jsonCompressWrapperObjScore : Nat :=
  if jsonCompressWrapperObj == "{\"ok\":true,\"segments\":[\"alpha\",\"beta\"]}" then
    1000 + jsonCompressWrapperObj.length
  else
    jsonCompressWrapperObj.length

end Vir.Fixtures.JsonCompress
