/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.React

public section

namespace ReactCounter

open Lean.Vir
open Lean.Vir.Browser (DomM)
open Lean.Vir.React

def label (value : Nat) : String :=
  "react:" ++ toString value

def counter : RuntimeM (Js (Component Unit)) :=
  Component.ofLean fun _ => do
    let initial ← JsValue.ofNat 0
    let count ← StateTuple.toState (← Hooks.useState initial)
    let countValue ← JsValue.toNat count.value
    let text ← Node.text (← Lean.Vir.JsValue.ofString (label countValue))
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
  let node ← ReactM.run do
    let text ← Node.text (← Lean.Vir.JsValue.ofString (label value))
    Node.buttonWith
      #[
        Props.id "react-counter-button",
        Props.onClick (renderInto root (value + 1))
      ]
      #[text]
  Root.render root node

def mount (selector : String) : DomM Bool := do
  let container ← Lean.Vir.Browser.Document.querySelector
    (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)
  match ← Lean.Vir.Js.Nullable.toOption container with
  | none => pure false
  | some container => do
      let root ← Lean.Vir.React.Root.create container
      let component ← counter
      let props ← Lean.Vir.LeanRef.toJSL ()
      let node ← Lean.Vir.React.ReactM.run (Lean.Vir.React.Node.component component props)
      Lean.Vir.React.Root.render root node
      pure true

def mountDefault : DomM Bool :=
  mount "#react-counter-root"

def staticTree : ReactM (Lean.Vir.Js Node) := do
  let text ← Node.text (← Lean.Vir.JsValue.ofString "react:static")
  Node.spanWith #[Props.id "react-static-label"] #[text]

def renderStatic (selector : String) : DomM Bool := do
  let container ← Lean.Vir.Browser.Document.querySelector
    (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)
  match ← Lean.Vir.Js.Nullable.toOption container with
  | none => pure false
  | some container => do
      let root ← Lean.Vir.React.Root.create container
      Root.render root (← ReactM.run staticTree)
      pure true

def renderStaticIntoSelector (selector : String) : DomM Bool := do
  let component ← Component.ofLean fun _ => staticTree
  let container ← Lean.Vir.Browser.Document.querySelector
    (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)
  match ← Lean.Vir.Js.Nullable.toOption container with
  | none => pure false
  | some container => do
      let root ← Lean.Vir.React.Root.create container
      let props ← Lean.Vir.LeanRef.toJSL ()
      let node ← Lean.Vir.React.ReactM.run (Lean.Vir.React.Node.component component props)
      Lean.Vir.React.Root.render root node
      pure true

def effectProbe : RuntimeM (Js (Component Unit)) :=
  Component.ofLean fun _ => do
    let effect ← EffectCallback.ofLean { setup := JsValue.ofNat 0, cleanup := fun _ => pure () }
    Hooks.useEffect effect
    let dep ← JsValue.ofNat 1
    let deps ← Hooks.DependencyList.ofArray #[dep]
    let effectWithDeps ← EffectCallback.ofLean
      { setup := JsValue.ofNat 0, cleanup := fun _ => pure () }
    Hooks.useEffect effectWithDeps (some deps)
    let text ← Node.text (← Lean.Vir.JsValue.ofString "react:effect")
    Node.spanWith #[Props.id "react-effect-label"] #[text]

def mountEffect (selector : String) : DomM Bool := do
  let component ← effectProbe
  let container ← Lean.Vir.Browser.Document.querySelector
    (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)
  match ← Lean.Vir.Js.Nullable.toOption container with
  | none => pure false
  | some container => do
      let root ← Lean.Vir.React.Root.create container
      let props ← Lean.Vir.LeanRef.toJSL ()
      let node ← Lean.Vir.React.ReactM.run (Lean.Vir.React.Node.component component props)
      Lean.Vir.React.Root.render root node
      pure true

def memoProbe : RuntimeM (Js (Component Unit)) :=
  Component.ofLean fun _ => do
    let dep ← JsValue.ofNat 1
    let deps ← Hooks.DependencyList.ofArray #[dep]
    let calculate : ReactM (Lean.Vir.Js Nat) := do
      JsValue.ofNat 42
    let calculation ← MemoCalculation.ofLean calculate
    let value ← Hooks.useMemo calculation deps
    let memoValue ← JsValue.toNat value
    let text ← Node.text (← Lean.Vir.JsValue.ofString s!"react:memo:{memoValue}")
    Node.spanWith #[Props.id "react-memo-label"] #[text]

def mountMemo (selector : String) : DomM Bool := do
  let component ← memoProbe
  let container ← Lean.Vir.Browser.Document.querySelector
    (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)
  match ← Lean.Vir.Js.Nullable.toOption container with
  | none => pure false
  | some container => do
      let root ← Lean.Vir.React.Root.create container
      let props ← Lean.Vir.LeanRef.toJSL ()
      let node ← Lean.Vir.React.ReactM.run (Lean.Vir.React.Node.component component props)
      Lean.Vir.React.Root.render root node
      pure true

def memoStableProbe : RuntimeM (Js (Component Unit)) :=
  Component.ofLean fun _ => do
    let initial ← JsValue.ofNat 0
    let count ← StateTuple.toState (← Hooks.useState initial)
    let deps ← Hooks.DependencyList.empty
    let calculation ← MemoCalculation.ofLean (pure count.value)
    let memoValue ← Hooks.useMemo calculation deps
    let countValue ← JsValue.toNat count.value
    let cachedValue ← JsValue.toNat memoValue
    let text ← Node.text (← Lean.Vir.JsValue.ofString s!"react:memo-stable:{countValue}:{cachedValue}")
    Node.buttonWith
      #[
        Props.id "react-memo-stable-button",
        Props.onClick do
          State.modify count fun previous => do
            let value ← JsValue.toNat previous
            JsValue.ofNat (value + 1)
      ]
      #[text]

def mountMemoStable (selector : String) : DomM Bool := do
  let component ← memoStableProbe
  let container ← Lean.Vir.Browser.Document.querySelector
    (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)
  match ← Lean.Vir.Js.Nullable.toOption container with
  | none => pure false
  | some container => do
      let root ← Lean.Vir.React.Root.create container
      let props ← Lean.Vir.LeanRef.toJSL ()
      let node ← Lean.Vir.React.ReactM.run (Lean.Vir.React.Node.component component props)
      Lean.Vir.React.Root.render root node
      pure true

def refFragmentProbe : RuntimeM (Js (Component Unit)) :=
  Component.ofLean fun _ => do
    let initial ← JsValue.ofNat 0
    let count ← StateTuple.toState (← Hooks.useState initial)
    let lastClick ← Hooks.useRef initial
    let countValue ← JsValue.toNat count.value
    let lastValueResource ← Ref.get lastClick
    let lastValue ← JsValue.toNat lastValueResource
    let labelText ← Node.text (← Lean.Vir.JsValue.ofString s!"react:ref:{countValue}:{lastValue}")
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
    let markerText ← Node.text (← Lean.Vir.JsValue.ofString "fragment child")
    let marker ← Node.spanWith #[Props.id "react-fragment-marker"] #[markerText]
    Node.fragment (← Props.empty) (← Js.Array.ofArray #[button, marker])

def mountRefFragment (selector : String) : DomM Bool := do
  let component ← refFragmentProbe
  let container ← Lean.Vir.Browser.Document.querySelector
    (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)
  match ← Lean.Vir.Js.Nullable.toOption container with
  | none => pure false
  | some container => do
      let root ← Lean.Vir.React.Root.create container
      let props ← Lean.Vir.LeanRef.toJSL ()
      let node ← Lean.Vir.React.ReactM.run (Lean.Vir.React.Node.component component props)
      Lean.Vir.React.Root.render root node
      pure true

def benchTextSpan (index : Nat) : ReactM (Lean.Vir.Js Node) := do
  let text ← Node.text (← Lean.Vir.JsValue.ofString ("item:" ++ toString index))
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
      Root.render root (← ReactM.run (benchTextTree width))
      renderWideTextLoopAux root width n (acc + 1)

def renderWideTextLoop (selector : String) (width count : Nat) : DomM Nat := do
  let container ← Browser.Document.querySelector
    (← Browser.Document.current) (← JsValue.ofString selector)
  match ← Js.Nullable.toOption container with
  | none => pure 0
  | some container => do
      let root ← Root.create container
      let rendered ← renderWideTextLoopAux root width count 0
      Root.unmount root
      pure rendered

def benchCallbackButton (root : Lean.Vir.Js Root) (index : Nat) : ReactM (Lean.Vir.Js Node) := do
  let text ← Node.text (← Lean.Vir.JsValue.ofString ("callback:" ++ toString index))
  Node.buttonWith
    #[
      Props.className "react-bench-callback",
      Props.data "index" (toString index),
      Props.onClick do
        Root.render root (← ReactM.run (benchTextTree 1))
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
      Root.render root (← ReactM.run (benchCallbackTree root width))
      renderCallbackTreeLoopAux root width n (acc + 1)

def renderCallbackTreeLoop (selector : String) (width count : Nat) : DomM Nat := do
  let container ← Browser.Document.querySelector
    (← Browser.Document.current) (← JsValue.ofString selector)
  match ← Js.Nullable.toOption container with
  | none => pure 0
  | some container => do
      let root ← Root.create container
      let rendered ← renderCallbackTreeLoopAux root width count 0
      Root.unmount root
      pure rendered

def mountAndUnmount (selector : String) : DomM Bool := do
  let container ← Lean.Vir.Browser.Document.querySelector
    (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)
  match ← Lean.Vir.Js.Nullable.toOption container with
  | none => pure false
  | some container => do
      let root ← Lean.Vir.React.Root.create container
      renderInto root 0
      Root.unmount root
      pure true

partial def mountAndUnmountLoopAux (selector : String) (remaining acc : Nat) : DomM Nat := do
  match remaining with
  | 0 => pure acc
  | n + 1 => do
      let mounted ← mountAndUnmount selector
      mountAndUnmountLoopAux selector n (if mounted then acc + 1 else acc)

def mountAndUnmountLoop (selector : String) (count : Nat) : DomM Nat :=
  mountAndUnmountLoopAux selector count 0

def renderAfterUnmount (selector : String) : DomM Bool := do
  let container ← Lean.Vir.Browser.Document.querySelector
    (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)
  match ← Lean.Vir.Js.Nullable.toOption container with
  | none => pure false
  | some container => do
      let root ← Lean.Vir.React.Root.create container
      Root.unmount root
      renderInto root 0
      pure true

def nestedDivs (depth : Nat) : ReactM (Lean.Vir.Js Node) := do
  match depth with
  | 0 => Node.text (← Lean.Vir.JsValue.ofString "deep")
  | n + 1 => do
      let child ← nestedDivs n
      Node.div #[child]

def renderTooDeep (selector : String) : DomM Bool := do
  let container ← Lean.Vir.Browser.Document.querySelector
    (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)
  match ← Lean.Vir.Js.Nullable.toOption container with
  | none => pure false
  | some container => do
      let root ← Lean.Vir.React.Root.create container
      Root.render root (← ReactM.run (nestedDivs 129))
      pure true

end ReactCounter
