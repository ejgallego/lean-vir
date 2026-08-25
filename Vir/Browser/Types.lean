/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.Js
import Vir.Runtime

namespace Lean.Vir.Browser

/-- Browser/DOM effect used by Lean-authored browser code. -/
@[irreducible] def DomM (α : Type) : Type :=
  Lean.Vir.RuntimeM α

namespace DomM

/-- Runs a browser/DOM action at an exported `IO` boundary. -/
def run (action : DomM α) : IO α :=
  by
    unfold DomM at action
    exact action.run

instance : Monad DomM where
  pure value :=
    by
      unfold DomM
      exact pure value
  bind action next :=
    by
      unfold DomM at action
      unfold DomM
      exact action >>= fun value => by
        unfold DomM at next
        exact next value

instance : MonadLift Lean.Vir.RuntimeM DomM where
  monadLift action :=
    by
      unfold DomM
      exact action

instance : Nonempty (DomM α) :=
  by
    unfold DomM
    infer_instance

end DomM

/--
Browser DOM element object class.

Lean code receives element values from `Document.querySelector` and passes them
to `Element` or more-specific element APIs. The current `wasm32-wasip1` runtime
represents this as a typed JavaScript object resource; Lean programs should not
construct or persist assumptions about the resource representation.

Reference: [MDN `Element`](https://developer.mozilla.org/en-US/docs/Web/API/Element).
-/
opaque Element : Type

end Lean.Vir.Browser
