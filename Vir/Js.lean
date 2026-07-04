/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.Host
import Vir.Runtime

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

namespace JsValue

@[vir_js "js.string"]
opaque ofString (value : @& String) : RuntimeM (Js String)

@[vir_js "js.string.value"]
opaque toString (value : @& Js String) : RuntimeM String

@[vir_js "js.nat"]
opaque ofNat (value : Nat) : RuntimeM (Js Nat)

@[vir_js "js.nat.value"]
opaque toNat (value : @& Js Nat) : RuntimeM Nat

@[vir_js "js.bool"]
opaque ofBool (value : Bool) : RuntimeM (Js Bool)

@[vir_js "js.bool.value"]
opaque toBool (value : @& Js Bool) : RuntimeM Bool

@[vir_js "js.float"]
opaque ofFloat (value : Float) : RuntimeM (Js Float)

@[vir_js "js.float.value"]
opaque toFloat (value : @& Js Float) : RuntimeM Float

end JsValue

namespace LeanRef

/--
Phantom marker for a Lean-owned value retained behind a JavaScript host
resource.
-/
opaque Handle (α : Type) : Type

end LeanRef

/--
JavaScript host resource containing a retained Lean-owned value.

`JSL α` is definitionally `Js (LeanRef.Handle α)`, not `Js α`. This keeps
LeanRef handles from being confused with true JavaScript-shaped resources such
as `Js String`.
-/
abbrev JSL (α : Type) : Type :=
  Js (LeanRef.Handle α)

namespace LeanRef

/--
Wraps a Lean-owned value in an opaque `Js` resource handle.

JavaScript stores and routes the resulting resource without decoding `α`. The
runtime retains the underlying Lean object while the handle is live.
-/
@[vir_js "js.leanRef"]
opaque toJs {α : Type} (value : @& α) : RuntimeM (JSL α)

/--
Returns the Lean-owned value stored behind a `Js` resource handle.

Unwrapping does not consume the JavaScript handle; the runtime returns a fresh
owned Lean reference to the stored object.
-/
@[vir_js "js.leanRef.value"]
opaque fromJs {α : Type} (value : @& JSL α) : RuntimeM α

end LeanRef

end Lean.Vir
