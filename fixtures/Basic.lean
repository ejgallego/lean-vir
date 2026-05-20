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

def upstreamListMapFilterFoldScore : Nat :=
  let xs := [1, 2, 3, 4, 5]
  let ys := xs.map (fun x => x + 1)
  let zs := ys.filter (fun x => 4 <= x)
  zs.foldl (fun acc x => acc + x) 0

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

def boolGateScore (flag other : Bool) : Nat :=
  if flag then
    if other then 11 else 17
  else
    3

def upstreamBoolGateScore : Nat :=
  boolGateScore true false

def optionProdScore : Option (Nat × Nat) -> Nat
  | some (a, b) => a * 10 + b
  | none => 4

def upstreamOptionProdSomeScore : Nat :=
  optionProdScore (some (7, 3))

def upstreamOptionProdNoneScore : Nat :=
  optionProdScore none

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

def classifyFind (xs : Array Nat) : Option (Nat × Nat) :=
  match xs.find? (fun x => 5 <= x) with
  | some x => some (x, xs.size)
  | none => none

def upstreamArrayFindOptionProdScore : Nat :=
  optionProdScore (classifyFind #[1, 3, 8, 2])

def upstreamArrayMutatingScore : Nat :=
  let xs := Array.replicate 4 3
  let xs := xs.set! 1 9
  let xs := xs.push 5
  let xs := xs.swapIfInBounds 0 1
  let xs := xs.pop
  checksum 1 xs.toList + xs.size

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

def rawStringIterationScore (s : String) : Nat :=
  let p0 : String.Pos.Raw := ⟨0⟩
  let c0 := String.Pos.Raw.get s p0
  let p1 := String.Internal.next s p0
  let c1 := String.Pos.Raw.get s p1
  let p2 := String.Internal.next s p1
  let c2 := String.Pos.Raw.get s p2
  let p3 := String.Internal.next s p2
  let c3 := String.Pos.Raw.get s p3
  let p4 := String.Internal.next s p3
  c0.toNat + c1.toNat + c2.toNat + c3.toNat + p4.byteIdx +
    if String.Internal.atEnd s p4 then 1000 else 0

def upstreamStringRawIterationScore : Nat :=
  rawStringIterationScore "Aé∀Z"

def stringSliceExtractScore (s : String) : Nat :=
  let p0 : String.Pos.Raw := ⟨0⟩
  let p1 := String.Internal.next s p0
  let p2 := String.Internal.next s p1
  let p3 := String.Internal.next s p2
  let middle := String.Internal.extract s p1 p3
  let pushed := middle.push '!'
  pushed.length + pushed.utf8ByteSize + (String.Pos.Raw.prev s p3).byteIdx +
    (if ("A" : String) < pushed then 100 else 0) +
    if middle = "é∀" then 1000 else 0

def upstreamStringSliceExtractScore : Nat :=
  stringSliceExtractScore "Aé∀Z"

def stringSearchDropScore (s : String) : Nat :=
  let trimmed := s.trimAscii.copy
  let tail := (trimmed.drop 5).copy
  (if trimmed.contains '∀' then 100 else 0) +
  (if trimmed.startsWith "lean" then 200 else 0) +
  (if tail = "vir∀" then 300 else 0) +
  tail.length + tail.utf8ByteSize

def upstreamStringSearchDropScore : Nat :=
  stringSearchDropScore "  lean-vir∀  "

def stringSplitIntercalateScore (s : String) : Nat :=
  let parts := s.splitOn "|"
  let joined := "-".intercalate parts
  parts.length + joined.length + joined.utf8ByteSize +
    (if joined.contains 'β' then 100 else 0) +
    if joined = "lean-β-vir" then 1000 else 0

def upstreamStringSplitIntercalateScore : Nat :=
  stringSplitIntercalateScore "lean|β|vir"

def stringPredicatePositionScore (s : String) : Nat :=
  let padded := s.pushn '!' 2
  let right := (padded.dropEnd 2).copy
  let p0 : String.Pos.Raw := ⟨0⟩
  let firstNonSpace := String.Pos.Raw.nextWhile right Char.isWhitespace p0
  let compact := right.trimAscii.copy
  (if right.any (fun c => c = 'λ') then 100 else 0) +
  (if String.isEmpty "" then 200 else 0) +
  (if right.front = ' ' then 300 else 0) +
  firstNonSpace.byteIdx + compact.length + compact.utf8ByteSize

def upstreamStringPredicatePositionScore : Nat :=
  stringPredicatePositionScore "  λean"

def upstreamByteArrayPushGetScore : Nat :=
  let bs := ByteArray.empty.push 65
  let bs := bs.push 66
  let bs := bs.push 67
  let b := bs.get! 1
  bs.size + b.toNat

def upstreamByteArraySetScore : Nat :=
  let bs := ByteArray.empty.push 10
  let bs := bs.push 20
  let bs := bs.push 30
  let bs := bs.set! 1 99
  (bs.get! 0).toNat + (bs.get! 1).toNat + (bs.get! 2).toNat + bs.size

def upstreamByteArrayExtractScore : Nat :=
  let bs := ByteArray.empty.push 5
  let bs := bs.push 9
  let bs := bs.push 7
  let bs := bs.push 8
  let bs := bs.push 1
  let slice := bs.extract 1 4
  (slice.get! 0).toNat + (slice.get! 1).toNat + (slice.get! 2).toNat + slice.size

end Vir.Fixtures.Basic
