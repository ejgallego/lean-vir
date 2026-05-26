/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

namespace Quickstart

def double (n : Nat) : Nat :=
  n + n

def greet (name : String) : String :=
  "Hello, " ++ name

def total (values : Array Nat) : Nat :=
  values.foldl (fun acc value => acc + value) 0

def choose (flag : Bool) : Option String :=
  if flag then
    some "Lean is running in the browser"
  else
    none

#eval double 21
#eval greet "Lean"
#eval total #[2, 3, 5, 8]
#eval choose true

end Quickstart
