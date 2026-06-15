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
    let count ← Hooks.useState 0
    let text ← Html.text (label count.value)
    Html.buttonWith
      #[Property.id "react-counter-button"]
      #[EventHandler.onClick ((State.modify count (fun value => value + 1)).run)]
      #[text]

partial def renderInto (root : Lean.Vir.Js Root) (value : Nat) : DomM Unit := do
  let text ← Html.text (label value)
  let html ← Html.buttonWith
    #[Property.id "react-counter-button"]
    #[EventHandler.onClick (renderInto root (value + 1))]
    #[text]
  Root.render root html

def mount (selector : String) : DomM Bool :=
  Root.mountFromSelector selector fun root => Root.renderComponent root counter ()

def mountDefault : DomM Bool :=
  mount "#react-counter-root"

def staticTree : ReactM (Lean.Vir.Js Html) := do
  let text ← Html.text "react:static"
  Html.spanWith #[Property.id "react-static-label"] #[] #[text]

def renderStatic (selector : String) : DomM Bool :=
  Root.mountFromSelector selector fun root => do
    let tree ← staticTree
    Root.render root tree

def benchTextSpan (index : Nat) : ReactM (Lean.Vir.Js Html) := do
  let text ← Html.text ("item:" ++ toString index)
  Html.spanWith
    #[
      Property.className "react-bench-text",
      Property.data "index" (toString index)
    ]
    #[]
    #[text]

partial def benchTextChildrenAux
    (index remaining : Nat)
    (acc : Array (Lean.Vir.Js Html)) :
    ReactM (Array (Lean.Vir.Js Html)) := do
  match remaining with
  | 0 => pure acc
  | n + 1 => do
      let span ← benchTextSpan index
      benchTextChildrenAux (index + 1) n (acc.push span)

def benchTextChildren (count : Nat) : ReactM (Array (Lean.Vir.Js Html)) :=
  benchTextChildrenAux 0 count #[]

def benchTextTree (count : Nat) : ReactM (Lean.Vir.Js Html) := do
  let children ← benchTextChildren count
  Html.divWith
    #[Property.id "react-bench-text-tree", Property.className "react-bench-tree"]
    #[]
    children

partial def renderWideTextLoopAux (root : Lean.Vir.Js Root) (width remaining acc : Nat) : DomM Nat := do
  match remaining with
  | 0 => pure acc
  | n + 1 => do
      let tree ← benchTextTree width
      Root.render root tree
      renderWideTextLoopAux root width n (acc + 1)

def renderWideTextLoop (selector : String) (width count : Nat) : DomM Nat := do
  match ← Root.createFromSelector selector with
  | none => pure 0
  | some root => do
      let rendered ← renderWideTextLoopAux root width count 0
      Root.unmount root
      pure rendered

def benchCallbackButton (root : Lean.Vir.Js Root) (index : Nat) : ReactM (Lean.Vir.Js Html) := do
  let text ← Html.text ("callback:" ++ toString index)
  Html.buttonWith
    #[
      Property.className "react-bench-callback",
      Property.data "index" (toString index)
    ]
    #[EventHandler.onClick do
      let tree ← benchTextTree 1
      Root.render root tree]
    #[text]

partial def benchCallbackChildrenAux
    (root : Lean.Vir.Js Root)
    (index remaining : Nat)
    (acc : Array (Lean.Vir.Js Html)) :
    ReactM (Array (Lean.Vir.Js Html)) := do
  match remaining with
  | 0 => pure acc
  | n + 1 => do
      let button ← benchCallbackButton root index
      benchCallbackChildrenAux root (index + 1) n (acc.push button)

def benchCallbackChildren (root : Lean.Vir.Js Root) (count : Nat) : ReactM (Array (Lean.Vir.Js Html)) :=
  benchCallbackChildrenAux root 0 count #[]

def benchCallbackTree (root : Lean.Vir.Js Root) (count : Nat) : ReactM (Lean.Vir.Js Html) := do
  let children ← benchCallbackChildren root count
  Html.divWith
    #[Property.id "react-bench-callback-tree", Property.className "react-bench-tree"]
    #[]
    children

partial def renderCallbackTreeLoopAux (root : Lean.Vir.Js Root) (width remaining acc : Nat) : DomM Nat := do
  match remaining with
  | 0 => pure acc
  | n + 1 => do
      let tree ← benchCallbackTree root width
      Root.render root tree
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

def nestedDivs (depth : Nat) : ReactM (Lean.Vir.Js Html) := do
  match depth with
  | 0 => Html.text "deep"
  | n + 1 => do
      let child ← nestedDivs n
      Html.div #[child]

def renderTooDeep (selector : String) : DomM Bool :=
  Root.mountFromSelector selector fun root => do
    let html ← nestedDivs 129
    Root.render root html

end ReactCounter
