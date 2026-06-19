import Vir.Browser
import Vir.React

def freshEchoBang (s : String) : String :=
  Lean.Vir.Common.echoString (s ++ "!")

def freshTitleRoundtrip (s : String) : Lean.Vir.Browser.DomM String := do
  Lean.Vir.Browser.Document.setTitle s
  Lean.Vir.Browser.Document.getTitle

def freshElementRoundtrip (s : String) : Lean.Vir.Browser.DomM (String × Option String) := do
  match ← Lean.Vir.Browser.Document.querySelector "#fresh" with
  | none => pure ("", none)
  | some fresh =>
      Lean.Vir.Browser.Element.setTextContent fresh s
      Lean.Vir.Browser.Element.setAttribute fresh "data-fresh" (s ++ "!")
      let text ← Lean.Vir.Browser.Element.getTextContent fresh
      let attr ← Lean.Vir.Browser.Element.getAttribute fresh "data-fresh"
      pure (text, attr)

@[vir_js "test.react.value"]
opaque freshReactValueHost : Lean.Vir.React.ReactM Nat

def freshReactValue : Lean.Vir.React.ReactM Nat :=
  freshReactValueHost

@[vir_js "test.runtime.value"]
opaque freshRuntimeValueHost : Lean.Vir.RuntimeM Nat

def freshRuntimeValue : Lean.Vir.RuntimeM Nat :=
  freshRuntimeValueHost

def freshRuntimeInDom : Lean.Vir.Browser.DomM Nat := do
  let value ← freshRuntimeValueHost
  pure (value + 1)

def freshRuntimeInReact : Lean.Vir.React.ReactM Nat := do
  let value ← freshRuntimeValueHost
  pure (value + 2)
