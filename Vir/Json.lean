/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.Js

namespace Lean.Vir

/--
An ordered, structural JSON value for VIR's owned JSON boundary.

JavaScript objects lower to `object` entries in JavaScript enumeration order.
Unlike `Lean.Json`, the representation deliberately keeps those entries in an
array so clients can preserve source order without an intermediate text codec.
Numbers are finite IEEE-754 doubles, matching ordinary JavaScript JSON values.
-/
inductive Json where
  | null
  | bool (value : Bool)
  | number (value : Float)
  | string (value : String)
  | array (items : Array Json)
  | object (entries : Array (String × Json))
  deriving Repr

namespace Json

/-- Returns the first object member named `key`, preserving the stored order. -/
def objectFind? (entries : Array (String × Json)) (key : String) : Option Json :=
  entries.findSome? fun (name, value) => if name == key then some value else none

/-- Phantom marker for an ordinary JavaScript JSON value retained by the runtime. -/
opaque HandleValue : Type

/--
A runtime-owned handle to an ordinary JavaScript JSON value.

Use `Handle.inspect` to decode one level at a time. Array items and object
members remain handles, so sparse clients only cross the parts they inspect.
-/
abbrev Handle : Type :=
  Lean.Vir.Js HandleValue

/-- One batched, one-level observation of a borrowed JSON handle. -/
inductive View where
  | null
  | bool (value : Bool)
  | number (value : Float)
  | string (value : String)
  | array (items : Array Handle)
  | object (entries : Array (String × Handle))

namespace Handle

/-- Retains an owned structural value as a borrowed JavaScript JSON handle. -/
@[vir_js_explicit_conversion "js.json.handle"]
opaque ofJson (value : @& Json) : RuntimeM Handle

/-- Materializes the complete tree behind a borrowed handle as owned structural JSON. -/
@[vir_js_explicit_conversion "js.json.value"]
opaque toJson (value : @& Handle) : RuntimeM Json

/--
Inspects one level of a borrowed JSON value in one host-boundary operation.

Scalar payloads cross directly. Arrays and objects return independent handles
for their immediate children; those children remain lazy until inspected.
-/
@[vir_js_explicit_conversion "js.json.inspect"]
opaque inspect (value : @& Handle) : RuntimeM View

/-- Builds a borrowed JSON array while preserving the identity of each child value. -/
@[vir_js_explicit_conversion "js.json.array"]
opaque array (items : @& Array Handle) : RuntimeM Handle

/--
Builds an ordered borrowed JSON object while preserving the identity of each
member value. Duplicate keys are rejected by the host binding.
-/
@[vir_js_explicit_conversion "js.json.object"]
opaque object (entries : @& Array (String × Handle)) : RuntimeM Handle

end Handle

end Json

end Lean.Vir
