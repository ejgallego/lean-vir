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

@[vir_js_explicit_conversion "js.string"]
opaque ofString (value : @& String) : RuntimeM (Js String)

@[vir_js_explicit_conversion "js.string.value"]
opaque toString (value : @& Js String) : RuntimeM String

@[vir_js_explicit_conversion "js.nat"]
opaque ofNat (value : Nat) : RuntimeM (Js Nat)

@[vir_js_explicit_conversion "js.nat.value"]
opaque toNat (value : @& Js Nat) : RuntimeM Nat

@[vir_js_explicit_conversion "js.bool"]
opaque ofBool (value : Bool) : RuntimeM (Js Bool)

@[vir_js_explicit_conversion "js.bool.value"]
opaque toBool (value : @& Js Bool) : RuntimeM Bool

/--
Wrap a Lean `Float` as a JavaScript number without narrowing its IEEE-754
value. NaN, infinities, and signed zero are preserved.
-/
@[vir_js_explicit_conversion "js.float"]
opaque ofFloat (value : Float) : RuntimeM (Js Float)

/--
Decode a JavaScript number as a Lean `Float` without narrowing its IEEE-754
value. NaN, infinities, and signed zero are preserved.
-/
@[vir_js_explicit_conversion "js.float.value"]
opaque toFloat (value : @& Js Float) : RuntimeM Float

end JsValue

namespace Js

namespace Nullable

/--
Phantom marker for a JavaScript nullable value.

Use `Js.Nullable α` for the resource handle. The host stores either JavaScript
`null` or a JavaScript value with Lean-side phantom shape `α`.
-/
opaque Value (α : Type) : Type

end Nullable

/--
JavaScript-owned nullable value.

This is a resource with explicit `null` semantics. It is intentionally distinct
from Lean's structural `Option`, so host imports can traffic in JavaScript
values without generic option lowering.
-/
abbrev Nullable (α : Type) : Type :=
  Lean.Vir.Js (Nullable.Value α)

namespace Nullable

@[vir_js "js.nullable.null"]
opaque null {α : Type} : RuntimeM (Lean.Vir.Js.Nullable α)

@[vir_js "js.nullable.of"]
opaque ofJs {α : Type} (value : @& Lean.Vir.Js α) : RuntimeM (Lean.Vir.Js.Nullable α)

@[vir_js "js.nullable.isNull"]
private opaque isNullJs {α : Type} (value : @& Lean.Vir.Js.Nullable α) : RuntimeM (Lean.Vir.Js Bool)

@[vir_js "js.nullable.value"]
opaque get {α : Type} (value : @& Lean.Vir.Js.Nullable α) : RuntimeM (Lean.Vir.Js α)

def isNull {α : Type} (value : @& Lean.Vir.Js.Nullable α) : RuntimeM Bool := do
  let flag ← isNullJs value
  Lean.Vir.JsValue.toBool flag

def toOption {α : Type} (value : @& Lean.Vir.Js.Nullable α) : RuntimeM (Option (Lean.Vir.Js α)) := do
  if ← isNull value then
    pure none
  else
    some <$> get value

def ofOption {α : Type} (value : Option (Lean.Vir.Js α)) : RuntimeM (Lean.Vir.Js.Nullable α) :=
  match value with
  | none => null
  | some value => ofJs value

end Nullable

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

private def collectResourceItems {α : Type}
    (item : Nat → RuntimeM (Option (Lean.Vir.Js α))) :
    (remaining index : Nat) →
    _root_.Array (Lean.Vir.Js α) →
    RuntimeM (_root_.Array (Lean.Vir.Js α))
  | 0, _, values => pure values
  | remaining + 1, index, values => do
      let values :=
        match ← item index with
        | none => values
        | some value => values.push value
      collectResourceItems item remaining (index + 1) values

namespace Array

@[vir_js "js.array.length"]
private opaque lengthJs {α : Type}
    (array : @& Lean.Vir.Js.Array α) :
    RuntimeM (Lean.Vir.Js Nat)

/-- Returns the current JavaScript array length as a Lean `Nat`. -/
def length {α : Type} (array : @& Lean.Vir.Js.Array α) : RuntimeM Nat := do
  Lean.Vir.JsValue.toNat (← lengthJs array)

@[vir_js "js.array.item"]
private opaque itemNullable {α : Type}
    (array : @& Lean.Vir.Js.Array (Lean.Vir.Js α))
    (index : @& Lean.Vir.Js Nat) :
    RuntimeM (Lean.Vir.Js.Nullable α)

/-- Returns the resource at `index`, or `none` when the index is out of bounds. -/
def item {α : Type}
    (array : @& Lean.Vir.Js.Array (Lean.Vir.Js α))
    (index : Nat) :
    RuntimeM (Option (Lean.Vir.Js α)) := do
  let jsIndex ← Lean.Vir.JsValue.ofNat index
  Lean.Vir.Js.Nullable.toOption (← itemNullable array jsIndex)

/-- Materializes independent Lean resource handles for the entries of a JavaScript array. -/
def toLeanArray {α : Type}
    (array : @& Lean.Vir.Js.Array (Lean.Vir.Js α)) :
    RuntimeM (_root_.Array (Lean.Vir.Js α)) := do
  let size ← length array
  collectResourceItems (item array) size 0 (_root_.Array.mkEmpty size)

end Array

namespace NodeList

@[vir_js "js.nodeList.length"]
private opaque lengthJs {α : Type}
    (nodes : @& Lean.Vir.Js.NodeList α) :
    RuntimeM (Lean.Vir.Js Nat)

/-- Returns the current `NodeList.length` as a Lean `Nat`. -/
def length {α : Type} (nodes : @& Lean.Vir.Js.NodeList α) : RuntimeM Nat := do
  Lean.Vir.JsValue.toNat (← lengthJs nodes)

@[vir_js "js.nodeList.item"]
private opaque itemNullable {α : Type}
    (nodes : @& Lean.Vir.Js.NodeList (Lean.Vir.Js α))
    (index : @& Lean.Vir.Js Nat) :
    RuntimeM (Lean.Vir.Js.Nullable α)

/-- Calls `NodeList.item`, returning `none` when the index is out of bounds. -/
def item {α : Type}
    (nodes : @& Lean.Vir.Js.NodeList (Lean.Vir.Js α))
    (index : Nat) :
    RuntimeM (Option (Lean.Vir.Js α)) := do
  let jsIndex ← Lean.Vir.JsValue.ofNat index
  Lean.Vir.Js.Nullable.toOption (← itemNullable nodes jsIndex)

/-- Copies a `NodeList` into a JavaScript array without crossing its entries into Lean. -/
@[vir_js "js.nodeList.toArray"]
opaque toArray {α : Type}
    (nodes : @& Lean.Vir.Js.NodeList α) :
    RuntimeM (Lean.Vir.Js.Array α)

/-- Materializes independent Lean resource handles for the entries of a `NodeList`. -/
def toLeanArray {α : Type}
    (nodes : @& Lean.Vir.Js.NodeList (Lean.Vir.Js α)) :
    RuntimeM (_root_.Array (Lean.Vir.Js α)) := do
  let size ← length nodes
  collectResourceItems (item nodes) size 0 (_root_.Array.mkEmpty size)

end NodeList

end Js

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
Wraps a Lean-owned value in an opaque `JSL` resource handle.

JavaScript stores and routes the resulting resource without decoding `α`. The
runtime retains the underlying Lean object while the handle is live.
-/
@[vir_js "js.leanRef"]
opaque toJSL {α : Type} (value : @& α) : RuntimeM (JSL α)

/--
Returns the Lean-owned value stored behind a `JSL` resource handle.

Unwrapping does not consume the JavaScript handle; the runtime returns a fresh
owned Lean reference to the stored object.
-/
@[vir_js "js.leanRef.value"]
opaque fromJSL {α : Type} (value : @& JSL α) : RuntimeM α

/--
Creates an independent JavaScript handle for the same retained Lean-owned value.

Each `JSL` alias owns an independent lease. `releaseJSL` can release that lease
early; otherwise dropping the Lean wrapper releases it automatically. Releasing
one alias does not invalidate any other live alias.
-/
@[vir_js "js.leanRef.retain"]
opaque retainJSL {α : Type} (value : @& JSL α) : RuntimeM (JSL α)

/--
Releases a JavaScript handle created by `LeanRef.toJSL` early. Dropping the
wrapper also releases it automatically.

Releasing the handle does not affect Lean values already returned by
`LeanRef.fromJSL` or other aliases created by `LeanRef.retainJSL`; those calls
receive independent ownership. Using the released handle again is a runtime
error.
-/
@[vir_js "js.leanRef.release"]
opaque releaseJSL {α : Type} (value : @& JSL α) : RuntimeM Unit

end LeanRef

end Lean.Vir
