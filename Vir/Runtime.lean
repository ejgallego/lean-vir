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

/-- Mutable Lean-owned state shared by VIR callbacks. -/
@[irreducible] def RuntimeRef (α : Type) : Type :=
  IO.Ref α

namespace RuntimeRef

/-- Creates a mutable Lean-owned runtime reference. -/
def new (value : α) : RuntimeM (RuntimeRef α) := by
  unfold RuntimeM RuntimeRef
  exact liftM (IO.mkRef value)

/-- Reads a runtime reference. -/
def get (ref : RuntimeRef α) : RuntimeM α := by
  unfold RuntimeRef at ref
  unfold RuntimeM
  exact ref.get

/-- Replaces the contents of a runtime reference. -/
def set (ref : RuntimeRef α) (value : α) : RuntimeM Unit := by
  unfold RuntimeRef at ref
  unfold RuntimeM
  exact ref.set value

/-- Modifies a runtime reference. -/
def modify (ref : RuntimeRef α) (f : α → α) : RuntimeM Unit := by
  unfold RuntimeRef at ref
  unfold RuntimeM
  exact ref.modify f

/-- Modifies a runtime reference and returns a value computed from its previous contents. -/
def modifyGet (ref : RuntimeRef α) (f : α → β × α) : RuntimeM β := by
  unfold RuntimeRef at ref
  unfold RuntimeM
  exact ref.modifyGet f

end RuntimeRef

end Lean.Vir
