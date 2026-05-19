/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

namespace Vir.Fixtures.Basic

def fib : Nat -> Nat
  | 0 => 0
  | 1 => 1
  | n + 2 => fib n + fib (n + 1)

def fib12 : Nat :=
  fib 12

inductive Token where
  | zero
  | one
  | many

def tokenScore : Token -> Nat
  | .zero => 0
  | .one => 1
  | .many => 7

def inductiveMatch : Nat :=
  tokenScore .many + tokenScore .one

def checksum : Nat -> List Nat -> Nat
  | _, [] => 0
  | weight, x :: xs => weight * x + checksum (weight + 1) xs

def reverseAux : List Nat -> List Nat -> List Nat
  | [], acc => acc
  | x :: xs, acc => reverseAux xs (x :: acc)

def reverse (xs : List Nat) : List Nat :=
  reverseAux xs []

def localListReverseChecksum : Nat :=
  checksum 1 (reverse [3, 1, 4, 1, 5])

def addN (n : Nat) : Nat -> Nat :=
  fun x => n + x

def partialApplication : Nat :=
  let f := addN 9
  f 4

def arrayPushChecksum : Nat :=
  let xs := (#[] : Array Nat)
  let xs := xs.push 8
  let xs := xs.push 6
  let xs := xs.push 7
  checksum 1 xs.toList

def branchAndSub : Nat :=
  if 3 <= 5 then
    100 - 58
  else
    0

def upstreamArrayMapChecksum : Nat :=
  let xs := #[1, 2, 3]
  checksum 1 ((xs.map fun x => x + 1).toList)

def upstreamArrayFoldlSum : Nat :=
  let xs := #[2, 4, 6, 8]
  xs.foldl (fun acc x => acc + x) 10

def upstreamArrayAnyScore : Nat :=
  let xs := #[1, 3, 8, 2]
  if xs.any (fun x => 5 <= x) then
    99
  else
    0

def upstreamArrayFilterChecksum : Nat :=
  let xs := #[1, 5, 2, 8]
  checksum 1 ((xs.filter fun x => 3 <= x).toList)

def upstreamArrayFindScore : Nat :=
  let xs := #[7, 6, 5, 8, 1, 2, 6]
  match xs.find? (fun x => x <= 2) with
  | some x => x + 40
  | none => 0

def stringAppendLength (a b c : String) : Nat :=
  (a ++ b).length + c.length

def upstreamStringAppendLength : Nat :=
  stringAppendLength "lean" "-vir" "wasm"

def stringEqScore (a b c : String) : Nat :=
  if a = b then
    a.length + 100
  else
    (a ++ c).length

def upstreamStringEqScore : Nat :=
  stringEqScore "lean" "lean" "-vir"

def stringUtf8ByteScore (a b c : String) : Nat :=
  (a ++ b).utf8ByteSize + c.utf8ByteSize

def upstreamStringUtf8ByteScore : Nat :=
  stringUtf8ByteScore "lean" "-vir" "wasm"

def stringByteAtScore (s : String) (h : (⟨1⟩ : String.Pos.Raw) < s.rawEndPos) : Nat :=
  (s.getUTF8Byte ⟨1⟩ h).toNat

def upstreamStringByteAtScore : Nat :=
  stringByteAtScore "lean" (by decide)

def upstreamByteArrayPushGetScore : Nat :=
  let bs := ByteArray.empty.push 65
  let bs := bs.push 66
  let bs := bs.push 67
  let b := bs.get! 1
  bs.size + b.toNat

end Vir.Fixtures.Basic
