/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.Browser

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

private def setDocumentTitle (title : String) : DomM Unit := do
  Lean.Vir.Browser.Document.setTitle
    (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString title)

private def getElementText
    (element : Lean.Vir.Js Lean.Vir.Browser.Element) : DomM String := do
  Lean.Vir.JsValue.toString (← Lean.Vir.Browser.Element.getTextContent element)

private def setElementText
    (element : Lean.Vir.Js Lean.Vir.Browser.Element)
    (text : String) : DomM Unit := do
  let jsText ← Lean.Vir.JsValue.ofString text
  Lean.Vir.Browser.Element.setTextContent element (← Lean.Vir.Js.Nullable.ofJs jsText)

def titleHandshake (label : String) : DomM String := do
  let title := "Lean VIR host: " ++ label
  setDocumentTitle title
  Lean.Vir.JsValue.toString
    (← Lean.Vir.Browser.Document.getTitle (← Lean.Vir.Browser.Document.current))

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

def querySelectorAllCount (selector : String) : DomM Nat := do
  let nodes ← Lean.Vir.Browser.Document.querySelectorAllString
    (← Lean.Vir.Browser.Document.current) selector
  Lean.Vir.Js.NodeList.length nodes

def querySelectorAllLeanCount (selector : String) : DomM Nat := do
  let nodes ← Lean.Vir.Browser.Document.querySelectorAllString
    (← Lean.Vir.Browser.Document.current) selector
  let elements ← Lean.Vir.Js.NodeList.toLeanArray nodes
  pure elements.size

def querySelectorAllArrayCount (selector : String) : DomM Nat := do
  let nodes ← Lean.Vir.Browser.Document.querySelectorAllString
    (← Lean.Vir.Browser.Document.current) selector
  let jsElements ← Lean.Vir.Js.NodeList.toArray nodes
  let elements ← Lean.Vir.Js.Array.toLeanArray jsElements
  pure elements.size

def querySelectorAllFirstText (selector : String) : DomM String := do
  let element? ← do
    let nodes ← Lean.Vir.Browser.Document.querySelectorAllString
      (← Lean.Vir.Browser.Document.current) selector
    Lean.Vir.Js.NodeList.item nodes 0
  match element? with
  | none => pure ""
  | some element => getElementText element

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
  match ← Lean.Vir.Browser.Document.querySelectorString
      (← Lean.Vir.Browser.Document.current) selector with
  | none => pure 0
  | some element =>
    let nodes ← Lean.Vir.Browser.Element.querySelectorAllString element childSelector
    Lean.Vir.Js.NodeList.length nodes

def elementQuerySelectorText (selector childSelector : String) : DomM String := do
  match ← Lean.Vir.Browser.Document.querySelectorString
      (← Lean.Vir.Browser.Document.current) selector with
  | none => pure ""
  | some element =>
    match ← Lean.Vir.Browser.Element.querySelectorString element childSelector with
    | none => pure ""
    | some child => getElementText child

def elementInnerHTMLRoundTrip (selector html : String) : DomM String := do
  match ← Lean.Vir.Browser.Document.querySelectorString
      (← Lean.Vir.Browser.Document.current) selector with
  | none => pure ""
  | some element =>
    let jsHtml ← Lean.Vir.JsValue.ofString html
    Lean.Vir.Browser.Element.setInnerHTML element jsHtml
    let _ ← Lean.Vir.JsValue.toString jsHtml
    Lean.Vir.JsValue.toString (← Lean.Vir.Browser.Element.getInnerHTML element)

def setInlineStyleProperty
    (selector name value : String) : DomM Bool := do
  match ← Lean.Vir.Browser.Document.querySelectorString
      (← Lean.Vir.Browser.Document.current) selector with
  | none => pure false
  | some element =>
      match ← Lean.Vir.Browser.ElementCSSInlineStyle.fromElement element with
      | none => pure false
      | some styledElement =>
          Lean.Vir.Browser.ElementCSSInlineStyle.setPropertyString
            styledElement name value
          pure true

def setElementClassList (selector classes : String) : DomM Bool := do
  match ← Lean.Vir.Browser.Document.querySelectorString
      (← Lean.Vir.Browser.Document.current) selector with
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
  match ← Lean.Vir.Browser.Document.querySelectorString
      (← Lean.Vir.Browser.Document.current) selector with
  | some element =>
      let _ ← Lean.Vir.Browser.Element.addEventListener element "click" fun _ => do
        recordNat 101
      pure 1
  | none => pure 0

def mountAndRemoveCallbackEvent (selector : String) : DomM Nat := do
  match ← Lean.Vir.Browser.Document.querySelectorString
      (← Lean.Vir.Browser.Document.current) selector with
  | some element =>
      let listener ← Lean.Vir.Browser.Element.addEventListener element "click" fun _ => do
        recordNat 102
      Lean.Vir.Browser.Element.removeEventListener element "click" listener
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
  match ← Lean.Vir.Browser.Document.querySelectorString
      (← Lean.Vir.Browser.Document.current) selector with
  | some element =>
      let _ ← Lean.Vir.Browser.Element.addEventListener element "click" fun _ => do
        setElementText element "callback:clicked"
      pure 1
  | none => pure 0

def mountAndRemoveCallbackText (selector : String) : DomM Nat := do
  match ← Lean.Vir.Browser.Document.querySelectorString
      (← Lean.Vir.Browser.Document.current) selector with
  | some element =>
      let listener ← Lean.Vir.Browser.Element.addEventListener element "click" fun _ => do
        setElementText element "callback:removed-fired"
      Lean.Vir.Browser.Element.removeEventListener element "click" listener
      pure 1
  | none => pure 0

def mountKeyTitle (selector : String) : DomM Nat := do
  match ← Lean.Vir.Browser.Document.querySelectorString
      (← Lean.Vir.Browser.Document.current) selector with
  | some element =>
      let _ ← Lean.Vir.Browser.Element.addEventListener element "keydown" fun event => do
        setDocumentTitle (← Lean.Vir.Browser.Event.keyString event)
      pure 1
  | none => pure 0

def timeoutRecord (value : Nat) : DomM Nat := do
  let _ ← Lean.Vir.Browser.Timer.setTimeout 0 do
    recordNat (value + 1)
  pure 1

def timeoutTitle (label : String) : DomM Nat := do
  let _ ← Lean.Vir.Browser.Timer.setTimeout 0 do
    setDocumentTitle ("timeout:" ++ label)
  pure 1

def delayedTimeoutTitle (label : String) : DomM Nat := do
  let _ ← Lean.Vir.Browser.Timer.setTimeout 80 do
    setDocumentTitle ("timeout:" ++ label)
  pure 1

def clearTimeoutTitle (label : String) : DomM Nat := do
  let timeout ← Lean.Vir.Browser.Timer.setTimeout 20 do
    setDocumentTitle ("timeout:" ++ label)
  Lean.Vir.Browser.Timer.clearTimeout timeout
  pure 1

def clearTimeoutRecord (value : Nat) : DomM Nat := do
  let timeout ← Lean.Vir.Browser.Timer.setTimeout 20 do
    recordNat (value + 10)
  Lean.Vir.Browser.Timer.clearTimeout timeout
  pure 1

def timeoutLoop : Nat → DomM Unit
  | 0 => recordNat 0
  | n + 1 => do
      recordNat (n + 1)
      let _ ← Lean.Vir.Browser.Timer.setTimeout 0 (timeoutLoop n)
      pure ()

def startTimeoutLoop (count : Nat) : DomM Nat := do
  let _ ← Lean.Vir.Browser.Timer.setTimeout 0 (timeoutLoop count)
  pure 1

def animationRecord (value : Nat) : DomM Nat := do
  let _ ← Lean.Vir.Browser.Animation.requestAnimationFrame fun _ => do
    recordNat (value + 2)
  pure 1

def animationTitle (label : String) : DomM Nat := do
  let _ ← Lean.Vir.Browser.Animation.requestAnimationFrame fun _ => do
    setDocumentTitle ("frame:" ++ label)
  pure 1

def cancelAnimationTitle (label : String) : DomM Nat := do
  let frame ← Lean.Vir.Browser.Animation.requestAnimationFrame fun _ => do
    setDocumentTitle ("frame:" ++ label)
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
      let _ ← Lean.Vir.Browser.Animation.requestAnimationFrame (animationLoop n)
      pure ()

def startAnimationLoop (count : Nat) : DomM Nat := do
  let _ ← Lean.Vir.Browser.Animation.requestAnimationFrame (animationLoop count)
  pure 1

end HostInterop
