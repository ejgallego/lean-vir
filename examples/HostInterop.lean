/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.Browser

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

def titleHandshake (label : String) : DomM String := do
  let title := "Lean VIR host: " ++ label
  Lean.Vir.Browser.Document.setTitle title
  Lean.Vir.Browser.Document.getTitle

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
  Lean.Vir.Js.NodeList.length (← Lean.Vir.Browser.Document.querySelectorAll selector)

def querySelectorAllLeanCount (selector : String) : DomM Nat := do
  pure (← Lean.Vir.Browser.Document.querySelectorAllSnapshot selector).size

def querySelectorAllArrayCount (selector : String) : DomM Nat := do
  let nodes ← Lean.Vir.Browser.Document.querySelectorAll selector
  let jsElements ← Lean.Vir.Js.NodeList.toArray nodes
  let elements ← Lean.Vir.Js.Array.toLeanArray jsElements
  pure elements.size

def querySelectorAllFirstText (selector : String) : DomM String := do
  match (← Lean.Vir.Browser.Document.querySelectorAllSnapshot selector)[0]? with
  | none => pure ""
  | some element => Lean.Vir.Browser.Element.getTextContent element

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
  match ← Lean.Vir.Browser.Document.querySelector selector with
  | none => pure 0
  | some element =>
    Lean.Vir.Js.NodeList.length (← Lean.Vir.Browser.Element.querySelectorAll element childSelector)

def elementQuerySelectorText (selector childSelector : String) : DomM String := do
  match ← Lean.Vir.Browser.Document.querySelector selector with
  | none => pure ""
  | some element =>
    match ← Lean.Vir.Browser.Element.querySelector element childSelector with
    | none => pure ""
    | some child => Lean.Vir.Browser.Element.getTextContent child

def elementInnerHTMLRoundTrip (selector html : String) : DomM String := do
  match ← Lean.Vir.Browser.Document.querySelector selector with
  | none => pure ""
  | some element =>
    Lean.Vir.Browser.Element.setInnerHTMLUnsafe element html
    Lean.Vir.Browser.Element.getInnerHTML element

def runtimeRefRoundTrip (value : Nat) : Lean.Vir.RuntimeM Nat := do
  let ref ← Lean.Vir.RuntimeM.Ref.new value
  Lean.Vir.RuntimeM.Ref.modify ref (· + 2)
  let previous ← Lean.Vir.RuntimeM.Ref.swap ref (value + 5)
  let current ← Lean.Vir.RuntimeM.Ref.modifyGet ref fun current => (current, current + 3)
  Lean.Vir.RuntimeM.Ref.set ref (current + 4)
  pure (previous * 100 + (← Lean.Vir.RuntimeM.Ref.get ref))

def mountRetainedElementIndex
    (selector childSelector replacementHTML : String) : DomM Nat := do
  let some container ← Lean.Vir.Browser.Document.querySelector selector | pure 0
  let targets ← Lean.Vir.Browser.Element.querySelectorAllSnapshot container childSelector
  let state ← Lean.Vir.RuntimeM.Ref.new targets
  let _ ← Lean.Vir.Browser.Element.addEventListener container "vir-check-index" fun _ => do
    match (← Lean.Vir.RuntimeM.Ref.get state)[0]? with
    | none => Lean.Vir.Browser.Document.setTitle "index:empty"
    | some element =>
        Lean.Vir.Browser.Document.setTitle (← Lean.Vir.Browser.Element.getTextContent element)
  let _ ← Lean.Vir.Browser.Element.addEventListener container "vir-drop-index" fun _ =>
    Lean.Vir.RuntimeM.Ref.set state #[]
  let _ ← Lean.Vir.Browser.Element.addEventListener container "vir-replace-index" fun event => do
    let some container ← Lean.Vir.Browser.Event.currentTarget event | pure ()
    Lean.Vir.RuntimeM.Ref.set state #[]
    Lean.Vir.Browser.Element.setInnerHTMLUnsafe container replacementHTML
    let replacement ← Lean.Vir.Browser.Element.querySelectorAllSnapshot container childSelector
    Lean.Vir.RuntimeM.Ref.set state replacement
  pure targets.size

partial def callbackRoundTripLoopAux : Nat → Nat → Lean.Vir.RuntimeM Nat
  | 0, acc => pure acc
  | n + 1, acc => do
      let value ← callbackRoundTrip (n % 256)
      callbackRoundTripLoopAux n (acc + value)

def callbackRoundTripLoop (count : Nat) : Lean.Vir.RuntimeM Nat :=
  callbackRoundTripLoopAux count 0

def mountCallbackEvent (selector : String) : DomM Nat := do
  match ← Lean.Vir.Browser.Document.querySelector selector with
  | some element =>
      let _ ← Lean.Vir.Browser.Element.addEventListener element "click" fun _ => do
        recordNat 101
      pure 1
  | none => pure 0

def mountAndRemoveCallbackEvent (selector : String) : DomM Nat := do
  match ← Lean.Vir.Browser.Document.querySelector selector with
  | some element =>
      let listener ← Lean.Vir.Browser.Element.addEventListener element "click" fun _ => do
        recordNat 102
      Lean.Vir.Browser.Element.removeEventListener listener
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
  match ← Lean.Vir.Browser.Document.querySelector selector with
  | some element =>
      let _ ← Lean.Vir.Browser.Element.addEventListener element "click" fun _ => do
        Lean.Vir.Browser.Element.setTextContent element "callback:clicked"
      pure 1
  | none => pure 0

def mountAndRemoveCallbackText (selector : String) : DomM Nat := do
  match ← Lean.Vir.Browser.Document.querySelector selector with
  | some element =>
      let listener ← Lean.Vir.Browser.Element.addEventListener element "click" fun _ => do
        Lean.Vir.Browser.Element.setTextContent element "callback:removed-fired"
      Lean.Vir.Browser.Element.removeEventListener listener
      pure 1
  | none => pure 0

def mountKeyTitle (selector : String) : DomM Nat := do
  match ← Lean.Vir.Browser.Document.querySelector selector with
  | some element =>
      let _ ← Lean.Vir.Browser.Element.addEventListener element "keydown" fun event => do
        match ← Lean.Vir.Browser.Event.key? event with
        | none => Lean.Vir.Browser.Document.setTitle "key:none"
        | some key => Lean.Vir.Browser.Document.setTitle key
      pure 1
  | none => pure 0

def timeoutRecord (value : Nat) : DomM Nat := do
  let _ ← Lean.Vir.Browser.Timer.setTimeout 0 do
    recordNat (value + 1)
  pure 1

def timeoutTitle (label : String) : DomM Nat := do
  let _ ← Lean.Vir.Browser.Timer.setTimeout 0 do
    Lean.Vir.Browser.Document.setTitle ("timeout:" ++ label)
  pure 1

def delayedTimeoutTitle (label : String) : DomM Nat := do
  let _ ← Lean.Vir.Browser.Timer.setTimeout 80 do
    Lean.Vir.Browser.Document.setTitle ("timeout:" ++ label)
  pure 1

def clearTimeoutTitle (label : String) : DomM Nat := do
  let timeout ← Lean.Vir.Browser.Timer.setTimeout 20 do
    Lean.Vir.Browser.Document.setTitle ("timeout:" ++ label)
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
    Lean.Vir.Browser.Document.setTitle ("frame:" ++ label)
  pure 1

def cancelAnimationTitle (label : String) : DomM Nat := do
  let frame ← Lean.Vir.Browser.Animation.requestAnimationFrame fun _ => do
    Lean.Vir.Browser.Document.setTitle ("frame:" ++ label)
  Lean.Vir.Browser.Animation.cancelAnimationFrame frame
  pure 1

def cancelAnimationRecord (value : Nat) : DomM Nat := do
  let frame ← Lean.Vir.Browser.Animation.requestAnimationFrame fun _ => do
    recordNat (value + 20)
  Lean.Vir.Browser.Animation.cancelAnimationFrame frame
  pure 1

def mountCancelableAnimationRecord (selector : String) (value : Nat) : DomM Nat := do
  let some element ← Lean.Vir.Browser.Document.querySelector selector | pure 0
  let pending ← Lean.Vir.RuntimeM.Ref.new (none : Option (Lean.Vir.Js Lean.Vir.Browser.AnimationFrame))
  let frame ← Lean.Vir.Browser.Animation.requestAnimationFrame fun _ => do
    Lean.Vir.RuntimeM.Ref.set pending none
    recordNat value
  Lean.Vir.RuntimeM.Ref.set pending (some frame)
  let _ ← Lean.Vir.Browser.Element.addEventListener element "vir-cancel-frame" fun _ => do
    let frame? ← Lean.Vir.RuntimeM.Ref.swap pending none
    if let some frame := frame? then
      Lean.Vir.Browser.Animation.cancelAnimationFrame frame
  pure 1

def mountCancelableAnimationTitle (selector label : String) : DomM Nat := do
  let some element ← Lean.Vir.Browser.Document.querySelector selector | pure 0
  let pending ← Lean.Vir.RuntimeM.Ref.new (none : Option (Lean.Vir.Js Lean.Vir.Browser.AnimationFrame))
  let frame ← Lean.Vir.Browser.Animation.requestAnimationFrame fun _ => do
    Lean.Vir.RuntimeM.Ref.set pending none
    Lean.Vir.Browser.Document.setTitle ("uncancelled:" ++ label)
  Lean.Vir.RuntimeM.Ref.set pending (some frame)
  let _ ← Lean.Vir.Browser.Element.addEventListener element "vir-cancel-frame" fun _ => do
    let frame? ← Lean.Vir.RuntimeM.Ref.swap pending none
    if let some frame := frame? then
      Lean.Vir.Browser.Animation.cancelAnimationFrame frame
      Lean.Vir.Browser.Document.setTitle ("cancelled:" ++ label)
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
