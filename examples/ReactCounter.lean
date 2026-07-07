/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.React

namespace ReactCounter

open Lean.Vir
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
      #[
        Props.id "react-counter-button",
        Props.onClick do
          State.modify count fun previous => do
            let value ← JsValue.toNat previous
            JsValue.ofNat (value + 1)
      ]
      #[text]

partial def renderInto (root : Lean.Vir.Js Root) (value : Nat) : DomM Unit := do
  Root.render root do
    let text ← Node.text (label value)
    Node.buttonWith
      #[
        Props.id "react-counter-button",
        Props.onClick (renderInto root (value + 1))
      ]
      #[text]

def mount (selector : String) : DomM Bool :=
  Root.mountFromSelector selector fun root => Root.renderComponent root counter ()

def mountDefault : DomM Bool :=
  mount "#react-counter-root"

def staticTree : ReactM (Lean.Vir.Js Node) := do
  let text ← Node.text "react:static"
  Node.spanWith #[Props.id "react-static-label"] #[text]

def renderStatic (selector : String) : DomM Bool :=
  Root.mountFromSelector selector fun root => do
    Root.render root staticTree

def effectProbe : Component Unit :=
  fun _ => do
    Hooks.useEffect
      (JsValue.ofNat 0)
      (fun _ => pure ())
    let dep ← JsValue.ofNat 1
    let deps ← Hooks.DependencyList.ofArray #[dep]
    Hooks.useEffectWithDeps deps
      (JsValue.ofNat 0)
      (fun _ => pure ())
    let text ← Node.text "react:effect"
    Node.spanWith #[Props.id "react-effect-label"] #[text]

def mountEffect (selector : String) : DomM Bool :=
  Root.mountFromSelector selector fun root => Root.renderComponent root effectProbe ()

def memoProbe : Component Unit :=
  fun _ => do
    let dep ← JsValue.ofNat 1
    let deps ← Hooks.DependencyList.ofArray #[dep]
    let calculate : ReactM (Lean.Vir.Js Nat) := do
      JsValue.ofNat 42
    let value ← Hooks.useMemo calculate deps
    let memoValue ← JsValue.toNat value
    let text ← Node.text s!"react:memo:{memoValue}"
    Node.spanWith #[Props.id "react-memo-label"] #[text]

def mountMemo (selector : String) : DomM Bool :=
  Root.mountFromSelector selector fun root => Root.renderComponent root memoProbe ()

def memoStableProbe : Component Unit :=
  fun _ => do
    let initial ← JsValue.ofNat 0
    let count ← Hooks.useState initial
    let deps ← Hooks.DependencyList.empty
    let memoValue ← Hooks.useMemo (pure count.value) deps
    let countValue ← JsValue.toNat count.value
    let cachedValue ← JsValue.toNat memoValue
    let text ← Node.text s!"react:memo-stable:{countValue}:{cachedValue}"
    Node.buttonWith
      #[
        Props.id "react-memo-stable-button",
        Props.onClick do
          State.modify count fun previous => do
            let value ← JsValue.toNat previous
            JsValue.ofNat (value + 1)
      ]
      #[text]

def mountMemoStable (selector : String) : DomM Bool :=
  Root.mountFromSelector selector fun root => Root.renderComponent root memoStableProbe ()

def refFragmentProbe : Component Unit :=
  fun _ => do
    let initial ← JsValue.ofNat 0
    let count ← Hooks.useState initial
    let lastClick ← Hooks.useRef initial
    let countValue ← JsValue.toNat count.value
    let lastValueResource ← Ref.get lastClick
    let lastValue ← JsValue.toNat lastValueResource
    let labelText ← Node.text s!"react:ref:{countValue}:{lastValue}"
    let button ←
      Node.buttonWith
        #[
          Props.id "react-ref-button",
          Props.onClick do
            State.modify count fun previous => do
              let value ← JsValue.toNat previous
              let next ← JsValue.ofNat (value + 1)
              Ref.set lastClick next
              pure next
        ]
        #[labelText]
    let markerText ← Node.text "fragment child"
    let marker ← Node.spanWith #[Props.id "react-fragment-marker"] #[markerText]
    Node.fragment #[button, marker]

def mountRefFragment (selector : String) : DomM Bool :=
  Root.mountFromSelector selector fun root => Root.renderComponent root refFragmentProbe ()

def benchTextSpan (index : Nat) : ReactM (Lean.Vir.Js Node) := do
  let text ← Node.text ("item:" ++ toString index)
  Node.spanWith
    #[
      Props.className "react-bench-text",
      Props.data "index" (toString index)
    ]
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
    #[Props.id "react-bench-text-tree", Props.className "react-bench-tree"]
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
      Props.className "react-bench-callback",
      Props.data "index" (toString index),
      Props.onClick do
        Root.render root (benchTextTree 1)
    ]
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
    #[Props.id "react-bench-callback-tree", Props.className "react-bench-tree"]
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
