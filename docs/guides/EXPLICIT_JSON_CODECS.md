# Explicit JSON codecs

Import `Vir.Js.Json` to turn application-supplied JSON converters into concrete
Lean entrypoints. JavaScript explicitly requests conversion; between requests it
holds an opaque `JSL α` and calls ordinary Lean operations on that value.

The optional module provides two generic Lean helpers:

```lean
LeanRef.fromJsonText : (Lean.Json → Except String α) → String → IO (JSL α)
LeanRef.toJsonText   : (α → Lean.Json) → JSL α → IO String
```

Decode uses Lean's JSON parser, then the supplied decoder. Either failure becomes
an ordinary `IO.userError`, before creating a carrier. Encode recovers the held
Lean value, applies the supplied encoder, and prints compact JSON. The existing
[call error contract](JS_API.md#calls-and-manifest) and
[carrier lifetime contract](../reference/HOST_BINDINGS.md#lean-backed-javascript-values)
apply: use a live carrier from the same runtime and the matching Lean type, and
dispose the runtime when finished. JSON text can be stored and decoded in a new
runtime; the old carrier belongs to its original runtime.

## Concrete exported wrappers

The helpers are polymorphic Lean functions. Export concrete wrappers with the
existing `@[vir_export]` marker; the package generator needs no new attribute.
For example, this caller explicitly chooses Lean's standard Nat JSON instances:

```lean
module

meta import Vir.Attributes
public import Vir.Js.Json

public section
open Lean Lean.Vir

namespace Counter

@[vir_export]
def fromJsonText (text : String) : IO (JSL Nat) :=
  LeanRef.fromJsonText (fromJson? (α := Nat)) text

@[vir_export]
def toJsonText (value : JSL Nat) : IO String :=
  LeanRef.toJsonText toJson value

@[vir_export]
def value (held : JSL Nat) : RuntimeM Nat := LeanRef.fromJSL held

end Counter
```

Build and deploy the program through the usual [package workflow](PACKAGES.md).
The JavaScript call interface is unchanged:

```js
const held = vir.call("Counter.fromJsonText", "9007199254740993123456789");
const value = vir.call("Counter.value", held); // 9007199254740993123456789n
const saved = vir.call("Counter.toJsonText", held); // exact JSON text
```

## The application owns the representation

Use standard `FromJson`/`ToJson` instances when their encoding suits the
application, or pass explicit decoder/encoder functions. The helpers select no
integer, Option, constructor, field-default, or schema-version policy. The
application decides which field values to admit and must choose a pair that
preserves the distinctions it needs.

Lean's standard Nat JSON parser/printer preserves integers exactly as text.
JavaScript `JSON.parse` rounds numeric literals beyond the safe Number range.
If JavaScript will parse and rewrite snapshots, decimal-string integer fields
can preserve their precision. Standard nested Option encoding maps both `none`
and `some none` to null; explicitly tagged options preserve their distinction.
These choices are separate from [automatic JavaScript value conversion](JS_API.md#calls-and-manifest).

The [JSON codec fixture](../../fixtures/runtime/JsonCodecs.lean) supplies explicit
tagged Option and decimal-string codecs with independent Lean observations.
The [Tamagotchi fixture](../../fixtures/runtime/TamagotchiCodecs.lean) uses the
existing application model and transitions to save, retire, restore, and continue
a pet. It preserves representable fields; normalization remains with Tamagotchi.

These are explicit converters using existing calls and references. Automatically
generated codecs remain [planned work](../SUPPORT.md#planned-for-011), with a
separate [lossless representation proposal](../design/EXPLICIT_CODECS.md).
