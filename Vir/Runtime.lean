/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

namespace Lean.Vir

/--
Runtime/JavaScript-resource effect.

`RuntimeM` is for host-runtime operations that may allocate or inspect
JavaScript-owned values and mutate VIR runtime bookkeeping, but do not by
themselves mutate the browser DOM or enter React's render/root APIs.
-/
@[irreducible] def RuntimeM (α : Type) : Type :=
  IO α

namespace RuntimeM

/-- Runs a runtime action at an exported `IO` boundary. -/
def run (action : RuntimeM α) : IO α :=
  by
    unfold RuntimeM at action
    exact action

instance : Monad RuntimeM where
  pure value :=
    by
      unfold RuntimeM
      exact pure value
  bind action next :=
    by
      unfold RuntimeM at action
      unfold RuntimeM
      exact action >>= fun value => by
        unfold RuntimeM at next
        exact next value

instance : Nonempty (RuntimeM α) :=
  by
    unfold RuntimeM
    infer_instance

end RuntimeM

end Lean.Vir
