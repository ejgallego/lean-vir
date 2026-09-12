/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import HostInterop

/-! Browser boundary regression entries. The user example stays in `examples/HostInterop.lean`. -/

public section

namespace HostInterop

open Lean.Vir.Browser (DomM)

@[vir_js "test.callNatCallback"]
private opaque callNatCallbackJs
    (input : @& Lean.Vir.Js Nat)
    (callback : Lean.Vir.Js Nat → Lean.Vir.RuntimeM (Lean.Vir.Js Nat)) :
    Lean.Vir.RuntimeM (Lean.Vir.Js Nat)

@[vir_js "test.recordNat"]
private opaque recordNatJs (value : @& Lean.Vir.Js Nat) : DomM Unit

def callNatCallback (input : Nat) (callback : Nat → Nat) : Lean.Vir.RuntimeM Nat := do
  let jsInput ← Lean.Vir.JsValue.ofNat input
  let jsResult ← callNatCallbackJs jsInput fun jsValue => do
    let value ← Lean.Vir.JsValue.toNat jsValue
    Lean.Vir.JsValue.ofNat (callback value)
  Lean.Vir.JsValue.toNat jsResult

def recordNat (value : Nat) : DomM Unit := do
  let jsValue ← Lean.Vir.JsValue.ofNat value
  recordNatJs jsValue

partial def titleHandshakeLoopAux (remaining acc : Nat) : DomM Nat := do
  match remaining with
  | 0 => pure acc
  | n + 1 => do
      let title ← titleHandshake "bench"
      titleHandshakeLoopAux n (acc + title.length)

def titleHandshakeLoop (count : Nat) : DomM Nat :=
  titleHandshakeLoopAux count 0

def callbackRoundTrip (n : Nat) : Lean.Vir.RuntimeM Nat :=
  callNatCallback n fun value => value + 7

def floatRoundTrip (value : Float) : Lean.Vir.RuntimeM Float := do
  let jsValue ← Lean.Vir.JsValue.ofFloat value
  Lean.Vir.JsValue.toFloat jsValue

-- Cross through a Lean array so runtime tests exercise the collection loops,
-- not just the JavaScript providers. The values themselves stay JavaScript-owned.
def arrayThroughLean (values : Lean.Vir.Js.Array Lean.Vir.Js.Any.Value) :
    Lean.Vir.RuntimeM (Lean.Vir.Js.Array Lean.Vir.Js.Any.Value) := do
  Lean.Vir.Js.Array.ofArray (← Lean.Vir.Js.Array.toLeanArray values)

def nodeListThroughLean (values : Lean.Vir.Js.NodeList Lean.Vir.Js.Any) :
    Lean.Vir.RuntimeM (Lean.Vir.Js.Array Lean.Vir.Js.Any.Value) := do
  Lean.Vir.Js.Array.ofArray (← Lean.Vir.Js.NodeList.toLeanArray values)

def querySelectorAllCount (selector : String) : DomM Nat := do
  let nodes ← Lean.Vir.Browser.Document.querySelectorAll
    (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)
  return (← Lean.Vir.JsValue.toFloat (← Lean.Vir.Js.NodeList.length nodes)).toUInt64.toNat

def querySelectorAllLeanCount (selector : String) : DomM Nat := do
  let nodes ← Lean.Vir.Browser.Document.querySelectorAll
    (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)
  let elements ← Lean.Vir.Js.NodeList.toLeanArray nodes
  pure elements.size

def querySelectorAllArrayCount (selector : String) : DomM Nat := do
  let nodes ← Lean.Vir.Browser.Document.querySelectorAll
    (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)
  let jsElements ← Lean.Vir.Js.NodeList.toArray nodes
  let elements ← Lean.Vir.Js.Array.toLeanArray jsElements
  pure elements.size

def querySelectorAllFirstText (selector : String) : DomM String := do
  let element? ← do
    let nodes ← Lean.Vir.Browser.Document.querySelectorAll
      (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)
    Lean.Vir.Js.Nullable.toOption (← Lean.Vir.Js.NodeList.item nodes (← Lean.Vir.JsValue.ofFloat 0.0))
  match element? with
  | none => pure ""
  | some element => Lean.Vir.JsValue.toString (← Lean.Vir.Browser.Element.getTextContent element)

partial def querySelectorAllCountLoopAux
    (selector : String) (remaining acc : Nat) : DomM Nat := do
  match remaining with
  | 0 => pure acc
  | n + 1 => do
      let count ← querySelectorAllCount selector
      querySelectorAllCountLoopAux selector n (acc + count)

def querySelectorAllCountLoop (selector : String) (count : Nat) : DomM Nat :=
  querySelectorAllCountLoopAux selector count 0

def elementQuerySelectorAllCount (selector childSelector : String) : DomM Nat := do
  match ← Lean.Vir.Js.Nullable.toOption (← Lean.Vir.Browser.Document.querySelector
      (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)) with
  | none => pure 0
  | some element =>
    let nodes ← Lean.Vir.Browser.Element.querySelectorAll element (← Lean.Vir.JsValue.ofString childSelector)
    return (← Lean.Vir.JsValue.toFloat (← Lean.Vir.Js.NodeList.length nodes)).toUInt64.toNat

def elementQuerySelectorText (selector childSelector : String) : DomM String := do
  match ← Lean.Vir.Js.Nullable.toOption (← Lean.Vir.Browser.Document.querySelector
      (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)) with
  | none => pure ""
  | some element =>
    match ← Lean.Vir.Js.Nullable.toOption (← Lean.Vir.Browser.Element.querySelector
        element (← Lean.Vir.JsValue.ofString childSelector)) with
    | none => pure ""
    | some child => Lean.Vir.JsValue.toString (← Lean.Vir.Browser.Element.getTextContent child)

def elementInnerHTMLRoundTrip (selector html : String) : DomM String := do
  match ← Lean.Vir.Js.Nullable.toOption (← Lean.Vir.Browser.Document.querySelector
      (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)) with
  | none => pure ""
  | some element =>
    let jsHtml ← Lean.Vir.JsValue.ofString html
    Lean.Vir.Browser.Element.setInnerHTML element jsHtml
    let _ ← Lean.Vir.JsValue.toString jsHtml
    Lean.Vir.JsValue.toString (← Lean.Vir.Browser.Element.getInnerHTML element)

def setInlineStyleProperty
    (selector name value : String) : DomM Bool := do
  match ← Lean.Vir.Js.Nullable.toOption (← Lean.Vir.Browser.Document.querySelector
      (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)) with
  | none => pure false
  | some element =>
      match ← Lean.Vir.Browser.ElementCSSInlineStyle.fromElement element with
      | none => pure false
      | some styledElement =>
          let declaration ← Lean.Vir.Browser.ElementCSSInlineStyle.getStyle styledElement
          let jsName ← Lean.Vir.JsValue.ofString name
          let jsValue ← Lean.Vir.JsValue.ofString value
          Lean.Vir.Browser.CSSStyleDeclaration.setProperty declaration jsName
            (← Lean.Vir.Js.Nullable.ofJs jsValue)
          pure true

def setElementClassList (selector classes : String) : DomM Bool := do
  match ← Lean.Vir.Js.Nullable.toOption (← Lean.Vir.Browser.Document.querySelector
      (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)) with
  | none => pure false
  | some element =>
      Lean.Vir.Browser.Element.setClassList element
        (← Lean.Vir.JsValue.ofString classes)
      pure true

def runtimeRefRoundTrip (value : Nat) : Lean.Vir.RuntimeM Nat := do
  let ref ← Lean.Vir.RuntimeRef.new value
  Lean.Vir.RuntimeRef.modify ref (· + 2)
  let previous ← Lean.Vir.RuntimeRef.modifyGet ref fun current => (current, current + 3)
  let current ← Lean.Vir.RuntimeRef.get ref
  Lean.Vir.RuntimeRef.set ref (current + 4)
  pure (previous * 100 + (← Lean.Vir.RuntimeRef.get ref))

partial def callbackRoundTripLoopAux : Nat → Nat → Lean.Vir.RuntimeM Nat
  | 0, acc => pure acc
  | n + 1, acc => do
      let value ← callbackRoundTrip (n % 256)
      callbackRoundTripLoopAux n (acc + value)

def callbackRoundTripLoop (count : Nat) : Lean.Vir.RuntimeM Nat :=
  callbackRoundTripLoopAux count 0

def mountCallbackEvent (selector : String) : DomM Nat := do
  match ← Lean.Vir.Js.Nullable.toOption (← Lean.Vir.Browser.Document.querySelector
      (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)) with
  | some element =>
      let event ← Lean.Vir.JsValue.ofString "click"
      let listener ← Lean.Vir.Browser.EventListener.ofLean fun _ => do
        recordNat 101
      Lean.Vir.Browser.Element.addEventListener element event listener
      pure 1
  | none => pure 0

def mountAndRemoveCallbackEvent (selector : String) : DomM Nat := do
  match ← Lean.Vir.Js.Nullable.toOption (← Lean.Vir.Browser.Document.querySelector
      (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)) with
  | some element =>
      let event ← Lean.Vir.JsValue.ofString "click"
      let listener ← Lean.Vir.Browser.EventListener.ofLean fun _ => do
        recordNat 102
      Lean.Vir.Browser.Element.addEventListener element event listener
      Lean.Vir.Browser.Element.removeEventListener element event listener
      pure 1
  | none => pure 0

partial def mountAndRemoveCallbackEventLoopAux (selector : String) (remaining acc : Nat) : DomM Nat := do
  match remaining with
  | 0 => pure acc
  | n + 1 => do
      let mounted ← mountAndRemoveCallbackEvent selector
      mountAndRemoveCallbackEventLoopAux selector n (acc + mounted)

def mountAndRemoveCallbackEventLoop (selector : String) (count : Nat) : DomM Nat :=
  mountAndRemoveCallbackEventLoopAux selector count 0

def mountCallbackText (selector : String) : DomM Nat := do
  match ← Lean.Vir.Js.Nullable.toOption (← Lean.Vir.Browser.Document.querySelector
      (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)) with
  | some element =>
      let event ← Lean.Vir.JsValue.ofString "click"
      let listener ← Lean.Vir.Browser.EventListener.ofLean fun _ => do
        let text ← Lean.Vir.JsValue.ofString "callback:clicked"
        Lean.Vir.Browser.Element.setTextContent element (← Lean.Vir.Js.Nullable.ofJs text)
      Lean.Vir.Browser.Element.addEventListener element event listener
      pure 1
  | none => pure 0

def mountAndRemoveCallbackText (selector : String) : DomM Nat := do
  match ← Lean.Vir.Js.Nullable.toOption (← Lean.Vir.Browser.Document.querySelector
      (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)) with
  | some element =>
      let event ← Lean.Vir.JsValue.ofString "click"
      let listener ← Lean.Vir.Browser.EventListener.ofLean fun _ => do
        let text ← Lean.Vir.JsValue.ofString "callback:removed-fired"
        Lean.Vir.Browser.Element.setTextContent element (← Lean.Vir.Js.Nullable.ofJs text)
      Lean.Vir.Browser.Element.addEventListener element event listener
      Lean.Vir.Browser.Element.removeEventListener element event listener
      pure 1
  | none => pure 0

def mountKeyTitle (selector : String) : DomM Nat := do
  match ← Lean.Vir.Js.Nullable.toOption (← Lean.Vir.Browser.Document.querySelector
      (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString selector)) with
  | some element =>
      let eventName ← Lean.Vir.JsValue.ofString "keydown"
      let listener ← Lean.Vir.Browser.EventListener.ofLean fun event => do
        let title ← match ← Lean.Vir.Browser.KeyboardEvent.fromEvent event with
          | none => do Lean.Vir.JsValue.ofString ""
          | some keyboard => Lean.Vir.Browser.KeyboardEvent.getKey keyboard
        Lean.Vir.Browser.Document.setTitle (← Lean.Vir.Browser.Document.current) title
      Lean.Vir.Browser.Element.addEventListener element eventName listener
      pure 1
  | none => pure 0

def timeoutRecord (value : Nat) : DomM Nat := do
  let _ ← Lean.Vir.Browser.Timer.setTimeout
    (recordNat (value + 1)) (← Lean.Vir.JsValue.ofFloat 0.0)
  pure 1

def timeoutTitle (label : String) : DomM Nat := do
  let _ ← Lean.Vir.Browser.Timer.setTimeout (do
    Lean.Vir.Browser.Document.setTitle (← Lean.Vir.Browser.Document.current)
      (← Lean.Vir.JsValue.ofString ("timeout:" ++ label)))
    (← Lean.Vir.JsValue.ofFloat 0.0)
  pure 1

def delayedTimeoutTitle (label : String) : DomM Nat := do
  let _ ← Lean.Vir.Browser.Timer.setTimeout (do
    Lean.Vir.Browser.Document.setTitle (← Lean.Vir.Browser.Document.current)
      (← Lean.Vir.JsValue.ofString ("timeout:" ++ label)))
    (← Lean.Vir.JsValue.ofFloat 80.0)
  pure 1

def clearTimeoutTitle (label : String) : DomM Nat := do
  let timeout ← Lean.Vir.Browser.Timer.setTimeout (do
    Lean.Vir.Browser.Document.setTitle (← Lean.Vir.Browser.Document.current)
      (← Lean.Vir.JsValue.ofString ("timeout:" ++ label)))
    (← Lean.Vir.JsValue.ofFloat 20.0)
  Lean.Vir.Browser.Timer.clearTimeout timeout
  pure 1

def clearTimeoutRecord (value : Nat) : DomM Nat := do
  let timeout ← Lean.Vir.Browser.Timer.setTimeout
    (recordNat (value + 10)) (← Lean.Vir.JsValue.ofFloat 20.0)
  Lean.Vir.Browser.Timer.clearTimeout timeout
  pure 1

def timeoutLoop : Nat → DomM Unit
  | 0 => recordNat 0
  | n + 1 => do
      recordNat (n + 1)
      let _ ← Lean.Vir.Browser.Timer.setTimeout (timeoutLoop n) (← Lean.Vir.JsValue.ofFloat 0.0)
      pure ()

def startTimeoutLoop (count : Nat) : DomM Nat := do
  let _ ← Lean.Vir.Browser.Timer.setTimeout (timeoutLoop count) (← Lean.Vir.JsValue.ofFloat 0.0)
  pure 1

def animationRecord (value : Nat) : DomM Nat := do
  let _ ← Lean.Vir.Browser.Animation.requestAnimationFrame fun _ => do
    recordNat (value + 2)
  pure 1

def animationTitle (label : String) : DomM Nat := do
  let _ ← Lean.Vir.Browser.Animation.requestAnimationFrame fun _ => do
    Lean.Vir.Browser.Document.setTitle (← Lean.Vir.Browser.Document.current)
      (← Lean.Vir.JsValue.ofString ("frame:" ++ label))
  pure 1

def cancelAnimationTitle (label : String) : DomM Nat := do
  let frame ← Lean.Vir.Browser.Animation.requestAnimationFrame fun _ => do
    Lean.Vir.Browser.Document.setTitle (← Lean.Vir.Browser.Document.current)
      (← Lean.Vir.JsValue.ofString ("frame:" ++ label))
  Lean.Vir.Browser.Animation.cancelAnimationFrame frame
  pure 1

def cancelAnimationRecord (value : Nat) : DomM Nat := do
  let frame ← Lean.Vir.Browser.Animation.requestAnimationFrame fun _ => do
    recordNat (value + 20)
  Lean.Vir.Browser.Animation.cancelAnimationFrame frame
  pure 1

def animationLoop : Nat → Float → DomM Unit
  | 0, _ => recordNat 0
  | n + 1, _ => do
      recordNat (n + 1)
      let _ ← Lean.Vir.Browser.Animation.requestAnimationFrame fun timestamp => do
        animationLoop n (← Lean.Vir.JsValue.toFloat timestamp)
      pure ()

def startAnimationLoop (count : Nat) : DomM Nat := do
  let _ ← Lean.Vir.Browser.Animation.requestAnimationFrame fun timestamp => do
    animationLoop count (← Lean.Vir.JsValue.toFloat timestamp)
  pure 1

end HostInterop
