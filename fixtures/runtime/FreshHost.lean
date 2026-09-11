module

public import Vir.Browser
public import Vir.React

public section

def freshEchoBang (s : String) : Lean.Vir.RuntimeM String := do
  Lean.Vir.JsValue.toString
    (← Lean.Vir.Common.echoString (← Lean.Vir.JsValue.ofString (s ++ "!")))

def freshTitleRoundtrip (s : String) : Lean.Vir.Browser.DomM String := do
  let document ← Lean.Vir.Browser.Document.current
  Lean.Vir.Browser.Document.setTitle document (← Lean.Vir.JsValue.ofString s)
  Lean.Vir.JsValue.toString (← Lean.Vir.Browser.Document.getTitle document)

def freshElementRoundtrip (s : String) : Lean.Vir.Browser.DomM (String × Option String) := do
  match ← Lean.Vir.Js.Nullable.toOption (← Lean.Vir.Browser.Document.querySelector
      (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString "#fresh")) with
  | none => pure ("", none)
  | some fresh =>
      let jsText ← Lean.Vir.JsValue.ofString s
      Lean.Vir.Browser.Element.setTextContent fresh (← Lean.Vir.Js.Nullable.ofJs jsText)
      let attrName ← Lean.Vir.JsValue.ofString "data-fresh"
      Lean.Vir.Browser.Element.setAttribute fresh attrName
        (← Lean.Vir.JsValue.ofString (s ++ "!"))
      let text ← Lean.Vir.JsValue.toString (← Lean.Vir.Browser.Element.getTextContent fresh)
      let attr ← match ← Lean.Vir.Js.Nullable.toOption
          (← Lean.Vir.Browser.Element.getAttribute fresh attrName) with
        | none => pure none
        | some value => some <$> Lean.Vir.JsValue.toString value
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
