/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.ProofWidgets.Jsx

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
open scoped Lean.Vir.Js Lean.Vir.ProofWidgets.Jsx

def Counter : RuntimeM (FunctionComponent Props) := FunctionComponent.ofLean fun _ => do
  let initial ← JsValue.ofNat 0
  let count ← Hooks.useState (α := Nat) initial
  let value ← JsValue.toNat (← Js.Tuple2.first count)
  let setter ← Js.Tuple2.second count
  let increment ← Js.Function.ofLeanVoid fun (_ : Js Browser.Event) => do
    let update ← Js.Function.ofLean fun previous => do
      let current ← JsValue.toNat previous
      JsValue.ofNat (current + 1)
    Js.Function.callVoid setter (React.SetStateAction.ofUpdater update)
  return ← <button type="button" onClick={increment}>
    {Node.text (← JsValue.ofString s!"Count: {value}")}
  </button>

def mount (selector : String) : DomM Bool := do
  let component ← Counter
  let container ← Lean.Vir.Browser.Document.querySelector
    (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)
  match ← Lean.Vir.Js.Nullable.toOption container with
  | none => pure false
  | some container => do
      let root ← Lean.Vir.React.Root.create container
      let props ← Js.Object.empty
      let node ← Lean.Vir.React.ReactM.run do
        Lean.Vir.React.Node.functionComponent component props (← Lean.Vir.Js.Array.empty)
      Lean.Vir.React.Root.render root node
      pure true

end ReactCounterTutorial
