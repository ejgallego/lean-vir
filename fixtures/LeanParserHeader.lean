/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Lean.Parser.Module

namespace Vir.Fixtures.LeanParserHeader

open Lean Parser

unsafe def parseHeaderScore (input : String) : Nat :=
  match unsafeIO (parseHeader (mkInputContext input "<input>")) with
  | .error _ => 1
  | .ok (_, st, messages) =>
      st.pos.byteIdx + messages.toList.length

unsafe def upstreamParseHeaderScore : Nat :=
  parseHeaderScore "import Init\npublic import Lean.Parser\n\nnamespace Demo\n"

end Vir.Fixtures.LeanParserHeader
