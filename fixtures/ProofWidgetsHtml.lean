/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.ProofWidgets.Jsx

public section

namespace ProofWidgetsHtml

open Lean.Vir
open Lean.Vir.Browser (DomM)
open Lean.Vir.ProofWidgets
open scoped Lean.Vir.Js

structure StatProps where
  label : String
  value : String

def Stat : RuntimeM (Lean.Vir.React.FunctionComponent (Lean.Vir.React.Props.WithData StatProps)) :=
  Lean.Vir.React.FunctionComponent.ofLean fun nativeProps => do
    let data ← Lean.Vir.React.Props.WithData.data nativeProps
    let props ← Lean.Vir.LeanRef.fromJSL data
    jsx%{<li className="pw-html-stat" data-label={(← Lean.Vir.JsValue.ofString props.label)}>
      <span className="pw-html-stat-label">{Lean.Vir.React.Node.text (← Lean.Vir.JsValue.ofString props.label)}</span>
      <strong className="pw-html-stat-value">{Lean.Vir.React.Node.text (← Lean.Vir.JsValue.ofString props.value)}</strong>
    </li>}

def View : RuntimeM (Lean.Vir.React.FunctionComponent Lean.Vir.React.Props) := do
  let StatComponent ← Stat
  Lean.Vir.React.FunctionComponent.ofLean fun _ => do
    let elementsProps ← Lean.Vir.React.Props.WithData.make
      (← Lean.Vir.LeanRef.toJSL { label := "Elements", value := "5" })
    let componentsProps ← Lean.Vir.React.Props.WithData.make
      (← Lean.Vir.LeanRef.toJSL { label := "Components", value := "1" })
    jsx%{<section id="proofwidgets-html-demo" role="region" aria-label="ProofWidgets HTML facade demo"
        className="pw-html-demo is-live" data-testid="proofwidgets-html">
      <h3 className="pw-html-title">ProofWidgets-style Html</h3>
      <p className="pw-html-summary">This tree is written through native JSX and rendered as native React nodes.</p>
      <ul className="pw-html-stats">
        <StatComponent @props={elementsProps}/>
        <StatComponent @props={componentsProps}/>
        <li className="pw-html-stat">
          <span className="pw-html-stat-label">Text</span>
          <strong className="pw-html-stat-value">native</strong>
        </li>
      </ul>
      <code className="pw-html-code">Native JSX section props children</code>
    </section>}

def mount (selector : String) : DomM Bool := do
  let component ← View
  let container ← Lean.Vir.Browser.Document.querySelector
    (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)
  match ← Lean.Vir.Js.Nullable.toOption container with
  | none => pure false
  | some container => do
      let root ← Lean.Vir.React.Root.create container
      let props ← Lean.Vir.Js.Object.empty
      let children ← js#[]
      let node ← Lean.Vir.React.ReactM.run (Lean.Vir.React.Node.functionComponent component props children)
      Lean.Vir.React.Root.render root node
      pure true

def mountDefault : DomM Bool :=
  mount "#proofwidgets-html-root"

end ProofWidgetsHtml
