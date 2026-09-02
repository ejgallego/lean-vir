import Vir.React

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
    let text ← Node.text "external child"
    let props ← Props.fromEntries #[Props.id "react-external-badge", Props.ref ref]
    let children ← Lean.Vir.Js.Array.ofArray #[text]
    Node.createElement component props children

def mount (selector : String) : DomM Bool := do
  let component ← externalComponentProbe
  Root.mountFromSelector selector fun root => Root.renderComponent root component ()

end Vir.Fixtures.ReactExternalComponent
