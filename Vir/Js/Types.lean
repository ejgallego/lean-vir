/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.Host
import Vir.Runtime

namespace Lean.Vir

/-- Opaque handle to a JavaScript-owned value with a Lean-side phantom shape. -/
opaque Js (α : Type) : Type

namespace Js

namespace Nullable

/-- Phantom marker for a JavaScript nullable value. -/
opaque Value (α : Type) : Type

end Nullable

/-- JavaScript-owned nullable value. -/
abbrev Nullable (α : Type) : Type :=
  Lean.Vir.Js (Nullable.Value α)

namespace Array

/-- Phantom shape for a JavaScript `Array` whose entries have Lean view `α`. -/
opaque Value (α : Type) : Type

end Array

/-- JavaScript-owned array. The parameter describes the Lean view returned by indexing. -/
abbrev Array (α : Type) : Type :=
  Lean.Vir.Js (Array.Value α)

namespace NodeList

/-- Phantom shape for a JavaScript DOM `NodeList` whose entries have Lean view `α`. -/
opaque Value (α : Type) : Type

end NodeList

/-- JavaScript-owned DOM `NodeList`. The parameter describes the Lean view returned by indexing. -/
abbrev NodeList (α : Type) : Type :=
  Lean.Vir.Js (NodeList.Value α)

end Js

namespace LeanRef

/-- Phantom marker for a Lean-owned value retained behind a JavaScript host resource. -/
opaque Handle (α : Type) : Type

end LeanRef

/-- JavaScript host resource containing a retained Lean-owned value. -/
abbrev JSL (α : Type) : Type :=
  Js (LeanRef.Handle α)

end Lean.Vir
