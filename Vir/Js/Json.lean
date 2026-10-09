/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Lean.Data.Json
public import Vir.Js

public section

namespace Lean.Vir.LeanRef

/--
Parses JSON text with an application-supplied decoder and retains the resulting
Lean value in an opaque JavaScript carrier. Parse/decoder errors become ordinary
`IO.userError` failures, before acquiring a carrier.

Expose this polymorphic helper through a concrete `@[vir_export]` wrapper.
The decoder owns the accepted representation and application validation.
-/
def fromJsonText (decode : Lean.Json → Except String α) (text : String) : IO (JSL α) := do
  match Lean.Json.parse text >>= decode with
  | .error message => throw (IO.userError message)
  | .ok value => RuntimeM.run (toJSL value)

/--
Recovers a retained Lean value, applies an application-supplied encoder, and
prints compact JSON text. The carrier must belong to this runtime and Lean type.
The encoder owns the representation; no JavaScript JSON conversion is performed.

Expose this polymorphic helper through a concrete `@[vir_export]` wrapper.
-/
def toJsonText (encode : α → Lean.Json) (value : JSL α) : IO String := RuntimeM.run do
  return (encode (← fromJSL value)).compress

end Lean.Vir.LeanRef
