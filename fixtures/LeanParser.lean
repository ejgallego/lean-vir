/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Lean.Parser

namespace Vir.Fixtures.LeanParser

open Lean Parser

def parserInputContextScore (input : String) : Nat :=
  let ictx := mkInputContext input "<input>"
  let p0 : String.Pos.Raw := ⟨0⟩
  let c0 := ictx.get p0
  let p1 := ictx.next p0
  let lineCol := ictx.fileMap.toPosition p1
  let st := mkParserState ictx.inputString
  c0.toNat + p1.byteIdx + ictx.endPos.byteIdx + lineCol.line + lineCol.column +
    st.pos.byteIdx + st.stxStack.size + if ictx.atEnd ictx.endPos then 1000 else 0

def upstreamParserInputContextScore : Nat :=
  parserInputContextScore "def f := 1\r\n#check f\n"

end Vir.Fixtures.LeanParser
