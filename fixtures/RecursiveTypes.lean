/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

namespace Vir.Fixtures.RecursiveTypes

inductive Tree (α : Type) where
  | leaf (value : α)
  | branch (left : Tree α) (right : Tree α)

def treeSize : Tree Nat -> Nat
  | .leaf _ => 1
  | .branch left right => 1 + treeSize left + treeSize right

def treeSum : Tree Nat -> Nat
  | .leaf value => value
  | .branch left right => treeSum left + treeSum right

def treeMap (f : Nat -> Nat) : Tree Nat -> Tree Nat
  | .leaf value => .leaf (f value)
  | .branch left right => .branch (treeMap f left) (treeMap f right)

def sampleTree : Tree Nat :=
  .branch
    (.branch (.leaf 2) (.leaf 3))
    (.branch (.leaf 5) (.branch (.leaf 7) (.leaf 11)))

def treeScore : Nat :=
  treeSize sampleTree * 100 + treeSum (treeMap (fun value => value + 1) sampleTree)

def treeRootScore (tree : Tree Nat) : Nat :=
  treeSize tree * 100 + treeSum tree

inductive Term where
  | var (name : String)
  | app (fn : Term) (arg : Term)
  | lam (binder : String) (body : Term)

def termSize : Term -> Nat
  | .var _ => 1
  | .app fn arg => 1 + termSize fn + termSize arg
  | .lam _ body => 1 + termSize body

def termDepth : Term -> Nat
  | .var _ => 1
  | .app fn arg => 1 + max (termDepth fn) (termDepth arg)
  | .lam _ body => 1 + termDepth body

def renameFree (source target : String) : Term -> Term
  | .var name => .var (if name == source then target else name)
  | .app fn arg => .app (renameFree source target fn) (renameFree source target arg)
  | .lam binder body =>
      if binder == source then
        .lam binder body
      else
        .lam binder (renameFree source target body)

def sampleTerm : Term :=
  .app
    (.lam "x" (.app (.var "x") (.var "y")))
    (.app (.var "z") (.lam "y" (.var "y")))

def lambdaScore : Nat :=
  let renamed := renameFree "y" "w" sampleTerm
  termSize renamed * 100 + termDepth renamed

structure Chain where
  label : String
  next : Option Chain

def chainDepth : Chain -> Nat
  | { next := none, .. } => 1
  | { next := some next, .. } => 1 + chainDepth next

def chainLabelScore : Chain -> Nat
  | { label, next := none } => label.length
  | { label, next := some next } => label.length + chainLabelScore next

def sampleChain : Chain :=
  { label := "root", next := some { label := "leaf", next := some { label := "tip", next := none } } }

def chainScore : Nat :=
  chainDepth sampleChain * 100 + chainLabelScore sampleChain

def chainRootScore (chain : Chain) : Nat :=
  chainDepth chain * 100 + chainLabelScore chain

inductive MiniJson where
  | null
  | bool (value : Bool)
  | nat (value : Nat)
  | array (items : List MiniJson)
  | object (entries : List (String × MiniJson))

def miniJsonScore : MiniJson -> Nat
  | .null => 1
  | .bool value => if value then 2 else 3
  | .nat value => value
  | .array items => 10 + items.length
  | .object entries => 20 + entries.length

def sampleJson : MiniJson :=
  .object [
    ("ok", .bool true),
    ("items", .array [.null, .nat 4])
  ]

def jsonScore : Nat :=
  miniJsonScore sampleJson

def jsonRootScore (json : MiniJson) : Nat :=
  miniJsonScore json

end Vir.Fixtures.RecursiveTypes
