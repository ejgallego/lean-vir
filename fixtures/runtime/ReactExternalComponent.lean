module

public import Vir.React

public section

namespace Vir.Fixtures.ReactExternalComponent

open Lean.Vir
open Lean.Vir.Browser (DomM)
open Lean.Vir.React

@[vir_js "test.react.externalBadge"]
opaque externalBadge : ReactM (Lean.Vir.Js ElementType)

def externalComponentProbe : RuntimeM (Js (Component Unit)) :=
  Component.ofLean fun _ => do
    let component ← externalBadge
    let initial ← JsValue.ofString "unset"
    let ref ← Hooks.useRef initial
    let text ← Node.text (← Lean.Vir.JsValue.ofString "external child")
    let props ← Props.fromEntries #[Props.id "react-external-badge", Props.ref ref]
    let children ← Lean.Vir.Js.Array.ofArray #[text]
    Node.createElement component props children

def mount (selector : String) : DomM Bool := do
  let component ← externalComponentProbe
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

end Vir.Fixtures.ReactExternalComponent
