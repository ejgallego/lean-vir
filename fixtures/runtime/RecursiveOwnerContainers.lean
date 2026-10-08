/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public section

inductive RecursiveContainers where
  | leaf (value : Nat)
  | viaSum (child : Sum RecursiveContainers Bool)
  | viaExcept (child : Except String RecursiveContainers)

def recursiveContainersIdentity (value : RecursiveContainers) : RecursiveContainers :=
  value

def recursiveContainersSumValue : RecursiveContainers :=
  .viaSum (.inl (.leaf 5))

def recursiveContainersExceptValue : RecursiveContainers :=
  .viaExcept (.ok (.leaf 7))
