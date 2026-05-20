/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

namespace Vir.Fixtures.ListOption

def listAnyAllFindScore : Nat :=
  let xs := [1, 4, 7, 10]
  let anyBig := xs.any (fun x => 8 <= x)
  let allPositive := xs.all (fun x => 1 <= x)
  let found := xs.find? (fun x => 5 <= x)
  (if anyBig then 10 else 0)
    + (if allPositive then 20 else 0)
    + match found with
      | some x => x
      | none => 0

def listZipScore : Nat :=
  let xs := [2, 3, 5]
  let ys := [7, 11]
  let pairs := xs.zip ys
  pairs.foldl (fun acc pair => acc + pair.1 * pair.2) 0

def classifySum : Nat -> Sum Nat Nat
  | 0 => .inl 10
  | n + 1 =>
      if n <= 2 then
        .inl (n + 11)
      else
        .inr (n + 1)

def sumScore : Sum Nat Nat -> Nat
  | .inl n => n
  | .inr n => n * 10

def nestedOptionSumScore : Nat :=
  let values := [classifySum 1, classifySum 5, classifySum 0]
  values.foldl (fun acc value => acc + sumScore value) 0

def classifyExcept : Nat -> Except Nat (Option (Sum Nat Nat))
  | 0 => .error 90
  | n + 1 =>
      if n <= 3 then
        .ok (some (.inl (n + 1)))
      else
        .ok (some (.inr (n + 1)))

def exceptOptionSumScore : Nat :=
  match classifyExcept 5 with
  | .ok (some (.inr n)) => n + 40
  | .ok (some (.inl n)) => n + 20
  | .ok none => 7
  | .error n => n

def assocLookup (key : Nat) : List (Nat × Nat) -> Option Nat
  | [] => none
  | (k, v) :: rest =>
      if k = key then
        some v
      else
        assocLookup key rest

def assocLookupScore : Nat :=
  match assocLookup 3 [(1, 10), (3, 40), (5, 90)] with
  | some value => value + 2
  | none => 0

end Vir.Fixtures.ListOption
