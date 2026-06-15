/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.React

namespace ReactCounter

open Lean.Vir.React

def label (value : Nat) : String :=
  "react:" ++ toString value

partial def renderInto (root : Root) (value : Nat) : IO Unit := do
  Root.render root <|
    Html.buttonWith
      #[Property.id "react-counter-button"]
      #[EventHandler.onClick (renderInto root (value + 1))]
      #[.text (label value)]

def mount (selector : String) : IO Bool :=
  Root.mountFromSelector selector fun root => renderInto root 0

def mountDefault : IO Bool :=
  mount "#react-counter-root"

def staticTree : Html :=
  Html.spanWith #[Property.id "react-static-label"] #[] #[.text "react:static"]

def renderStatic (selector : String) : IO Bool :=
  Root.mountFromSelector selector fun root => Root.render root staticTree

def benchTextSpan (index : Nat) : Html :=
  Html.spanWith
    #[
      Property.className "react-bench-text",
      Property.data "index" (toString index)
    ]
    #[]
    #[.text ("item:" ++ toString index)]

partial def benchTextChildrenAux (index remaining : Nat) (acc : Array Html) : Array Html :=
  match remaining with
  | 0 => acc
  | n + 1 => benchTextChildrenAux (index + 1) n (acc.push (benchTextSpan index))

def benchTextChildren (count : Nat) : Array Html :=
  benchTextChildrenAux 0 count #[]

def benchTextTree (count : Nat) : Html :=
  Html.divWith
    #[Property.id "react-bench-text-tree", Property.className "react-bench-tree"]
    #[]
    (benchTextChildren count)

partial def renderWideTextLoopAux (root : Root) (width remaining acc : Nat) : IO Nat := do
  match remaining with
  | 0 => pure acc
  | n + 1 => do
      Root.render root (benchTextTree width)
      renderWideTextLoopAux root width n (acc + 1)

def renderWideTextLoop (selector : String) (width count : Nat) : IO Nat := do
  match ← Root.createFromSelector selector with
  | none => pure 0
  | some root => do
      let rendered ← renderWideTextLoopAux root width count 0
      Root.unmount root
      pure rendered

def benchCallbackButton (root : Root) (index : Nat) : Html :=
  Html.buttonWith
    #[
      Property.className "react-bench-callback",
      Property.data "index" (toString index)
    ]
    #[EventHandler.onClick (Root.render root (benchTextTree 1))]
    #[.text ("callback:" ++ toString index)]

partial def benchCallbackChildrenAux (root : Root) (index remaining : Nat) (acc : Array Html) :
    Array Html :=
  match remaining with
  | 0 => acc
  | n + 1 => benchCallbackChildrenAux root (index + 1) n (acc.push (benchCallbackButton root index))

def benchCallbackChildren (root : Root) (count : Nat) : Array Html :=
  benchCallbackChildrenAux root 0 count #[]

def benchCallbackTree (root : Root) (count : Nat) : Html :=
  Html.divWith
    #[Property.id "react-bench-callback-tree", Property.className "react-bench-tree"]
    #[]
    (benchCallbackChildren root count)

partial def renderCallbackTreeLoopAux (root : Root) (width remaining acc : Nat) : IO Nat := do
  match remaining with
  | 0 => pure acc
  | n + 1 => do
      Root.render root (benchCallbackTree root width)
      renderCallbackTreeLoopAux root width n (acc + 1)

def renderCallbackTreeLoop (selector : String) (width count : Nat) : IO Nat := do
  match ← Root.createFromSelector selector with
  | none => pure 0
  | some root => do
      let rendered ← renderCallbackTreeLoopAux root width count 0
      Root.unmount root
      pure rendered

def mountAndUnmount (selector : String) : IO Bool :=
  Root.mountFromSelector selector fun root => do
    renderInto root 0
    Root.unmount root

partial def mountAndUnmountLoopAux (selector : String) (remaining acc : Nat) : IO Nat := do
  match remaining with
  | 0 => pure acc
  | n + 1 => do
      let mounted ← mountAndUnmount selector
      mountAndUnmountLoopAux selector n (if mounted then acc + 1 else acc)

def mountAndUnmountLoop (selector : String) (count : Nat) : IO Nat :=
  mountAndUnmountLoopAux selector count 0

def renderAfterUnmount (selector : String) : IO Bool :=
  Root.mountFromSelector selector fun root => do
    Root.unmount root
    renderInto root 0

def nestedDivs (depth : Nat) : Html :=
  match depth with
  | 0 => .text "deep"
  | n + 1 => Html.div #[nestedDivs n]

def renderTooDeep (selector : String) : IO Bool :=
  Root.mountFromSelector selector fun root => Root.render root (nestedDivs 129)

end ReactCounter
