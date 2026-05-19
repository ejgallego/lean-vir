/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

/-
A tiny merge-sort style demo.

The public entry point returns a weighted checksum so the browser can display a
single Nat while the interpreter still evaluates the sort closure.
-/

namespace SortDemo

def inputArray : Array Nat :=
  #[7, 3, 9, 1, 4, 1, 5, 2]

def split : List Nat -> List Nat × List Nat
  | [] => ([], [])
  | [x] => ([x], [])
  | x :: y :: rest =>
      let halves := split rest
      (x :: halves.1, y :: halves.2)

def merge : List Nat -> List Nat -> List Nat
  | [], ys => ys
  | xs, [] => xs
  | x :: xs, y :: ys =>
      if x <= y then
        x :: merge xs (y :: ys)
      else
        y :: merge (x :: xs) ys

def mergeSortFuel : Nat -> List Nat -> List Nat
  | 0, xs => xs
  | _ + 1, [] => []
  | _ + 1, [x] => [x]
  | fuel + 1, xs =>
      let halves := split xs
      merge (mergeSortFuel fuel halves.1) (mergeSortFuel fuel halves.2)

def sortedFromArray (input : Array Nat) : List Nat :=
  mergeSortFuel 32 input.toList

def sorted : List Nat :=
  sortedFromArray inputArray

def checksumAux : Nat -> List Nat -> Nat
  | _, [] => 0
  | weight, x :: xs => weight * x + checksumAux (weight + 1) xs

def demoFromArray (input : Array Nat) : Nat :=
  checksumAux 1 (sortedFromArray input)

def demo : Nat :=
  demoFromArray inputArray

#eval sorted
-- [1, 1, 2, 3, 4, 5, 7, 9]

#eval demo
-- 192

end SortDemo
