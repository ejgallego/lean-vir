/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.React

public section

/-!
# A first Lean-authored React component

This deliberately small counter introduces `useState`, an event callback, and
mounting. It is tutorial code rather than a deployed example; the larger React
runtime conformance cases live in `fixtures/ReactCounter.lean`.
-/

namespace ReactCounterTutorial

open Lean.Vir
open Lean.Vir.Browser (DomM)
open Lean.Vir.React

def Counter : RuntimeM (Js (Component Unit)) := Component.ofLean fun _ => do
  let initial ← JsValue.ofNat 0
  let count ← StateTuple.toState (← Hooks.useState initial)
  let value ← JsValue.toNat count.value
  let label ← Node.text (← Lean.Vir.JsValue.ofString s!"Count: {value}")
  Node.buttonWith #[
    Props.onClick do
      State.modify count fun previous => do
        let current ← JsValue.toNat previous
        JsValue.ofNat (current + 1)
  ] #[label]

def mount (selector : String) : DomM Bool := do
  let component ← Counter
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

end ReactCounterTutorial
