/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

namespace Vir.Fixtures.Task

def taskPureGetScore : Nat :=
  (Task.pure 41).get + 1

def taskMapGetScore : Nat :=
  let base := Task.pure 10
  let mapped := Task.map (fun n => n * 3 + 2) base (sync := true)
  mapped.get

end Vir.Fixtures.Task
