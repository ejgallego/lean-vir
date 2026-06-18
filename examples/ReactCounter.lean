/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.React

namespace ReactCounter

open Lean.Vir.Browser (DomM)
open Lean.Vir.React

def label (value : Nat) : String :=
  "react:" ++ toString value

def counter : Component Unit :=
  fun _ => do
    let initial ← JsValue.ofNat 0
    let count ← Hooks.useState initial
    let countValue ← JsValue.toNat count.value
    let text ← Node.text (label countValue)
    Node.buttonWith
      #[Property.id "react-counter-button"]
      #[EventHandler.onClick do
        let next ← (JsValue.ofNat (countValue + 1)).run
        (State.set count next).run]
      #[text]

partial def renderInto (root : Lean.Vir.Js Root) (value : Nat) : DomM Unit := do
  Root.render root do
    let text ← Node.text (label value)
    Node.buttonWith
      #[Property.id "react-counter-button"]
      #[EventHandler.onClick (renderInto root (value + 1))]
      #[text]

def mount (selector : String) : DomM Bool :=
  Root.mountFromSelector selector fun root => Root.renderComponent root counter ()

def mountDefault : DomM Bool :=
  mount "#react-counter-root"

def staticTree : ReactM (Lean.Vir.Js Node) := do
  let text ← Node.text "react:static"
  Node.spanWith #[Property.id "react-static-label"] #[] #[text]

def renderStatic (selector : String) : DomM Bool :=
  Root.mountFromSelector selector fun root => do
    Root.render root staticTree

def benchTextSpan (index : Nat) : ReactM (Lean.Vir.Js Node) := do
  let text ← Node.text ("item:" ++ toString index)
  Node.spanWith
    #[
      Property.className "react-bench-text",
      Property.data "index" (toString index)
    ]
    #[]
    #[text]

partial def benchTextChildrenAux
    (index remaining : Nat)
    (acc : Array (Lean.Vir.Js Node)) :
    ReactM (Array (Lean.Vir.Js Node)) := do
  match remaining with
  | 0 => pure acc
  | n + 1 => do
      let span ← benchTextSpan index
      benchTextChildrenAux (index + 1) n (acc.push span)

def benchTextChildren (count : Nat) : ReactM (Array (Lean.Vir.Js Node)) :=
  benchTextChildrenAux 0 count #[]

def benchTextTree (count : Nat) : ReactM (Lean.Vir.Js Node) := do
  let children ← benchTextChildren count
  Node.divWith
    #[Property.id "react-bench-text-tree", Property.className "react-bench-tree"]
    #[]
    children

partial def renderWideTextLoopAux (root : Lean.Vir.Js Root) (width remaining acc : Nat) : DomM Nat := do
  match remaining with
  | 0 => pure acc
  | n + 1 => do
      Root.render root (benchTextTree width)
      renderWideTextLoopAux root width n (acc + 1)

def renderWideTextLoop (selector : String) (width count : Nat) : DomM Nat := do
  match ← Root.createFromSelector selector with
  | none => pure 0
  | some root => do
      let rendered ← renderWideTextLoopAux root width count 0
      Root.unmount root
      pure rendered

def benchCallbackButton (root : Lean.Vir.Js Root) (index : Nat) : ReactM (Lean.Vir.Js Node) := do
  let text ← Node.text ("callback:" ++ toString index)
  Node.buttonWith
    #[
      Property.className "react-bench-callback",
      Property.data "index" (toString index)
    ]
    #[EventHandler.onClick do
      Root.render root (benchTextTree 1)]
    #[text]

partial def benchCallbackChildrenAux
    (root : Lean.Vir.Js Root)
    (index remaining : Nat)
    (acc : Array (Lean.Vir.Js Node)) :
    ReactM (Array (Lean.Vir.Js Node)) := do
  match remaining with
  | 0 => pure acc
  | n + 1 => do
      let button ← benchCallbackButton root index
      benchCallbackChildrenAux root (index + 1) n (acc.push button)

def benchCallbackChildren (root : Lean.Vir.Js Root) (count : Nat) : ReactM (Array (Lean.Vir.Js Node)) :=
  benchCallbackChildrenAux root 0 count #[]

def benchCallbackTree (root : Lean.Vir.Js Root) (count : Nat) : ReactM (Lean.Vir.Js Node) := do
  let children ← benchCallbackChildren root count
  Node.divWith
    #[Property.id "react-bench-callback-tree", Property.className "react-bench-tree"]
    #[]
    children

partial def renderCallbackTreeLoopAux (root : Lean.Vir.Js Root) (width remaining acc : Nat) : DomM Nat := do
  match remaining with
  | 0 => pure acc
  | n + 1 => do
      Root.render root (benchCallbackTree root width)
      renderCallbackTreeLoopAux root width n (acc + 1)

def renderCallbackTreeLoop (selector : String) (width count : Nat) : DomM Nat := do
  match ← Root.createFromSelector selector with
  | none => pure 0
  | some root => do
      let rendered ← renderCallbackTreeLoopAux root width count 0
      Root.unmount root
      pure rendered

def mountAndUnmount (selector : String) : DomM Bool :=
  Root.mountFromSelector selector fun root => do
    renderInto root 0
    Root.unmount root

partial def mountAndUnmountLoopAux (selector : String) (remaining acc : Nat) : DomM Nat := do
  match remaining with
  | 0 => pure acc
  | n + 1 => do
      let mounted ← mountAndUnmount selector
      mountAndUnmountLoopAux selector n (if mounted then acc + 1 else acc)

def mountAndUnmountLoop (selector : String) (count : Nat) : DomM Nat :=
  mountAndUnmountLoopAux selector count 0

def renderAfterUnmount (selector : String) : DomM Bool :=
  Root.mountFromSelector selector fun root => do
    Root.unmount root
    renderInto root 0

def nestedDivs (depth : Nat) : ReactM (Lean.Vir.Js Node) := do
  match depth with
  | 0 => Node.text "deep"
  | n + 1 => do
      let child ← nestedDivs n
      Node.div #[child]

def renderTooDeep (selector : String) : DomM Bool :=
  Root.mountFromSelector selector fun root => do
    Root.render root (nestedDivs 129)

end ReactCounter
