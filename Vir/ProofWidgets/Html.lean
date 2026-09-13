/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.React

public section

namespace Lean.Vir.ProofWidgets

abbrev ReactM := Lean.Vir.React.ReactM

/--
ProofWidgets-style HTML value backed by a real React node construction action.

This is a shallow facade over `Lean.Vir.React`: `Html.elementWithProps`
and `Html.text` allocate native React node resources through React's public
APIs instead of building a second recursive structural tree.
-/
abbrev Html : Type :=
  ReactM (Lean.Vir.Js Lean.Vir.React.Node)

namespace Html

def text (value : String) : Html := do
  Lean.Vir.React.Node.text (← Lean.Vir.JsValue.ofString value)

def children (items : Array Html) :
    ReactM (Array (Lean.Vir.Js Lean.Vir.React.Node)) :=
  items.mapM fun item => item

/-- Builds a native React element from a single unified prop array. -/
def elementWithProps
    (tag : String)
    (props : Array Lean.Vir.React.Props.Entry := #[])
    (children : Array Html := #[]) :
    Html := do
  let childNodes ← Html.children children
  Lean.Vir.React.Node.elementWith tag props childNodes

def fragment (children : Array Html := #[]) : Html := do
  let childNodes ← Html.children children
  Lean.Vir.React.Node.fragment (← Lean.Vir.React.Props.empty)
    (← Lean.Vir.Js.Array.ofArray childNodes)

def keyedFragment (key : String) (children : Array Html := #[]) : Html := do
  let childNodes ← Html.children children
  Lean.Vir.React.Node.fragment
    (← Lean.Vir.React.Props.fromEntries #[Lean.Vir.React.Props.key key])
    (← Lean.Vir.Js.Array.ofArray childNodes)

def component
    (component : Lean.Vir.React.FunctionComponent (Lean.Vir.React.Props.WithData props))
    (data : Lean.Vir.JSL props)
    (children : Array Html := #[]) :
  Html := do
  let childNodes ← Html.children children
  let props ← Lean.Vir.React.Props.WithData.make data
  Lean.Vir.React.Node.functionComponent component props
    (← Lean.Vir.Js.Array.ofArray childNodes)

def keyedComponent
    (key : String)
    (component : Lean.Vir.React.FunctionComponent (Lean.Vir.React.Props.WithData props))
    (data : Lean.Vir.JSL props)
    (children : Array Html := #[]) :
  Html := do
  let childNodes ← Html.children children
  let props ← Lean.Vir.React.Props.WithData.make data
  Lean.Vir.React.Props.setKey (Lean.Vir.React.Props.WithData.asProps props) key
  Lean.Vir.React.Node.functionComponent component props
    (← Lean.Vir.Js.Array.ofArray childNodes)

end Html

end Lean.Vir.ProofWidgets
