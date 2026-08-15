/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

inductive FreshMode where
  | cold
  | hot

structure FreshBox where
  label : String
  value : Nat
  enabled : Bool
  hits : UInt32
  quota : USize
  mode : FreshMode

structure FreshWrap (α : Type) where
  label : String
  payload : α

structure FreshScalarBox where
  value : UInt32

structure FreshUInt64Box where
  value : UInt64

structure FreshChain where
  label : String
  next : Option FreshChain

inductive FreshTree (α : Type) where
  | leaf (value : α)
  | node (children : List (FreshTree α))

inductive FreshTerm where
  | var (name : String)
  | app (fn : FreshTerm) (arg : FreshTerm)
  | lam (binder : String) (body : FreshTerm)

inductive FreshJson where
  | null
  | bool (value : Bool)
  | nat (value : Nat)
  | array (items : List FreshJson)
  | object (entries : List (String × FreshJson))

abbrev FreshUserId := Nat

def freshAliasBump (n : FreshUserId) : FreshUserId := n + 9
def freshBump (n : Nat) : Nat := n + 7
def freshSum (xs : Array Nat) : Nat := xs.foldl (fun acc n => acc + n) 0
def freshPairSum (p : Nat × Nat) : Nat := p.fst + p.snd
def freshUInt64Bump (n : UInt64) : UInt64 := n + 1
def freshFloatScale (n : Float) : Float := Float.scaleB n (1 : Int)
def freshFloat32Roundtrip (n : Float32) : Float32 := n
def freshClassifySum (n : Nat) : Sum Nat String :=
  if n < 3 then .inl (n + 10) else .inr (toString n)

def freshSumScore : Sum Nat String → Nat
  | .inl n => n
  | .inr text => text.length + 20

def freshClassifyExcept (n : Nat) : Except String Nat :=
  if n = 0 then .error "zero" else .ok (n + 1)

def freshBoxBump (box : FreshBox) : FreshBox :=
  { box with
    value := box.value + box.label.length
    enabled := !box.enabled
    hits := box.hits + 1
    quota := box.quota + 2
    mode := .hot }

def freshWrapBoxBump (wrap : FreshWrap FreshBox) : FreshWrap FreshBox :=
  { label := wrap.label ++ "!", payload := freshBoxBump wrap.payload }

def freshWrapUInt32Bump (wrap : FreshWrap UInt32) : FreshWrap UInt32 :=
  { label := wrap.label ++ "!", payload := wrap.payload + 1 }

def freshScalarBoxBump (box : FreshScalarBox) : FreshScalarBox :=
  { value := box.value + 1 }

def freshUInt64BoxBump (box : FreshUInt64Box) : FreshUInt64Box :=
  { value := box.value + 1 }

def freshChainDepth : FreshChain → Nat
  | { next := none, .. } => 1
  | { next := some next, .. } => 1 + freshChainDepth next

def freshChainLabelScore : FreshChain → Nat
  | { label, next := none } => label.length
  | { label, next := some next } => label.length + freshChainLabelScore next

def freshChainIdentity (chain : FreshChain) : FreshChain := chain

def freshChainPush (label : String) (chain : FreshChain) : FreshChain :=
  { label := label, next := some chain }

def freshChainScore (chain : FreshChain) : Nat :=
  freshChainDepth chain * 100 + freshChainLabelScore chain

def freshTreeIdentity (tree : FreshTree Nat) : FreshTree Nat := tree

def freshTreeRootScore : FreshTree Nat → Nat
  | .leaf value => value
  | .node children => children.length + 10

def freshTermSize : FreshTerm → Nat
  | .var _ => 1
  | .app fn arg => 1 + freshTermSize fn + freshTermSize arg
  | .lam _ body => 1 + freshTermSize body

def freshTermWrap (term : FreshTerm) : FreshTerm :=
  .lam "x" (.app term (.var "x"))

def freshJsonWeight : FreshJson → Nat
  | .null => 1
  | .bool value => if value then 2 else 3
  | .nat value => value
  | .array items => 10 + items.length
  | .object entries => 20 + entries.length

def freshJsonWrap (value : FreshJson) : FreshJson :=
  .array [value, .null]
