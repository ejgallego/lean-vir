/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.Js.Types

public section

namespace Lean.Vir.Infoview

/-- Phantom marker for the exact position-specific infoview RPC session object. -/
opaque RpcSession : Type

/-- Exact infoview `ClientRequestOptions`, including its native AbortSignal. -/
opaque ClientRequestOptions : Type

/-- Cursor position for the current infoview snapshot. -/
structure DocumentPosition where
  uri : String
  fileName : String
  line : Nat
  character : Nat
  label : String

end Lean.Vir.Infoview
