import Vir.React

namespace Vir.Fixtures.ReactExternalComponent

open Lean.Vir
open Lean.Vir.Browser (DomM)
open Lean.Vir.React

@[vir_js "test.react.externalBadge"]
opaque externalBadge : ReactM (Lean.Vir.Js ElementType)

def externalComponentProbe : Component Unit :=
  fun _ => do
    let component ← externalBadge
    let initial ← JsValue.ofString "unset"
    let ref ← Hooks.useRef initial
    let text ← Node.text "external child"
    Node.createElement component
      #[Props.id "react-external-badge", Props.ref ref]
      #[text]

def mount (selector : String) : DomM Bool :=
  Root.mountFromSelector selector fun root => Root.renderComponent root externalComponentProbe ()

end Vir.Fixtures.ReactExternalComponent
