/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.Host

namespace Lean.Vir

/--
Opaque handle to a JavaScript-owned value with a Lean-side phantom shape.

`Js α` is the boundary type for host values that Lean code should treat as
JavaScript objects. The parameter `α` documents the intended Lean shape, but it
is not decoded while the value remains inside `Js`.
This lets polymorphic JavaScript APIs share one resource ABI when they only
move JS objects around.
-/
opaque Js (α : Type) : Type

end Lean.Vir
