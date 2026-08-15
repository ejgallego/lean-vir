/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir
import Vir.Js

namespace Vir.Fixtures.InterpreterConstantCache

private def buildDenseTable : ByteArray := Id.run do
  let mut result := ByteArray.empty
  for index in [:32769] do
    result := result.push (UInt8.ofNat index)
  return result

def denseTable : ByteArray := buildDenseTable

private def denseLookupImpl (index : Nat) : UInt8 :=
  denseTable[index % denseTable.size]!

@[implemented_by denseLookupImpl]
def denseLookup (index : Nat) : UInt8 :=
  UInt8.ofNat index

@[vir_export]
def denseTableHandle : Lean.Vir.RuntimeM (Lean.Vir.JSL ByteArray) :=
  Lean.Vir.LeanRef.toJSL denseTable

@[vir_export]
def denseLookupValue (index : Nat) : Nat :=
  (denseLookup index).toNat

end Vir.Fixtures.InterpreterConstantCache
