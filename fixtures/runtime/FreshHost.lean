import Vir.Browser
import Vir.React

def freshEchoBang (s : String) : Lean.Vir.RuntimeM String := do
  Lean.Vir.Common.echoString (s ++ "!")

def freshTitleRoundtrip (s : String) : Lean.Vir.Browser.DomM String := do
  Lean.Vir.Browser.Document.setTitle (← Lean.Vir.JsValue.ofString s)
  Lean.Vir.JsValue.toString (← Lean.Vir.Browser.Document.getTitle)

private def setFreshText
    (element : Lean.Vir.Js Lean.Vir.Browser.Element)
    (text : String) : Lean.Vir.Browser.DomM Unit := do
  let jsText ← Lean.Vir.JsValue.ofString text
  Lean.Vir.Browser.Element.setTextContent element (← Lean.Vir.Js.Nullable.ofJs jsText)

private def getFreshText
    (element : Lean.Vir.Js Lean.Vir.Browser.Element) :
    Lean.Vir.Browser.DomM String := do
  Lean.Vir.JsValue.toString (← Lean.Vir.Browser.Element.getTextContent element)

def freshElementRoundtrip (s : String) : Lean.Vir.Browser.DomM (String × Option String) := do
  match ← Lean.Vir.Browser.Document.querySelectorString "#fresh" with
  | none => pure ("", none)
  | some fresh =>
      setFreshText fresh s
      Lean.Vir.Browser.Element.setAttributeString fresh "data-fresh" (s ++ "!")
      let text ← getFreshText fresh
      let attr ← Lean.Vir.Browser.Element.getAttributeString fresh "data-fresh"
      pure (text, attr)

@[vir_js "test.react.value"]
opaque freshReactValueHost : Lean.Vir.React.ReactM (Lean.Vir.Js Nat)

def freshReactValue : Lean.Vir.React.ReactM Nat := do
  let value ← freshReactValueHost
  Lean.Vir.JsValue.toNat value

@[vir_js "test.runtime.value"]
opaque freshRuntimeValueHost : Lean.Vir.RuntimeM (Lean.Vir.Js Nat)

def freshRuntimeValue : Lean.Vir.RuntimeM Nat := do
  let value ← freshRuntimeValueHost
  Lean.Vir.JsValue.toNat value

def freshRuntimeInDom : Lean.Vir.Browser.DomM Nat := do
  let value ← freshRuntimeValue
  pure (value + 1)

def freshRuntimeInReact : Lean.Vir.React.ReactM Nat := do
  let value ← freshRuntimeValue
  pure (value + 2)
