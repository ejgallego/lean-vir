/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.Common
import Vir.Js
import Vir.Browser.Generated

namespace Lean.Vir.Browser

namespace KeyboardEvent

/-- Checks whether an event is a keyboard event without changing its JavaScript identity. -/
def fromEvent
    (event : @& Lean.Vir.Js Event) :
    DomM (Option (Lean.Vir.Js KeyboardEvent)) := do
  Lean.Vir.Js.Nullable.toOption (← fromEventNullable event)

/-- Returns the exact JavaScript `key` string carried by a keyboard event. -/
def keyString (event : @& Lean.Vir.Js KeyboardEvent) : DomM String := do
  Lean.Vir.JsValue.toString (← getKey event)

end KeyboardEvent

namespace Event

/--
Returns the event target as a DOM element when the target is an element.

The returned element follows ordinary JavaScript reachability. VIR likewise
does not invalidate the event after callback return; its practical validity
follows browser semantics.

Reference: [MDN `Event.target`](https://developer.mozilla.org/en-US/docs/Web/API/Event/target).
-/
def targetOption (event : @& Lean.Vir.Js Event) : DomM (Option (Lean.Vir.Js Element)) := do
  Lean.Vir.Js.Nullable.toOption (← getTarget event)

/--
Returns the current event target as a DOM element when the current target is an
element.

The returned element follows ordinary JavaScript reachability. The browser
normally exposes `currentTarget` only while its handler runs; VIR adds no
stronger event lifetime.

Reference: [MDN `Event.currentTarget`](https://developer.mozilla.org/en-US/docs/Web/API/Event/currentTarget).
-/
def currentTargetOption (event : @& Lean.Vir.Js Event) : DomM (Option (Lean.Vir.Js Element)) := do
  Lean.Vir.Js.Nullable.toOption (← getCurrentTarget event)

/--
Returns the keyboard key represented by an event, or the empty string for
events that do not narrow to a keyboard event.

Reference: [MDN `KeyboardEvent.key`](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key).
-/
def keyString (event : @& Lean.Vir.Js Event) : DomM String := do
  match ← KeyboardEvent.fromEvent event with
  | none => pure ""
  | some keyboardEvent => KeyboardEvent.keyString keyboardEvent

end Event

namespace Console

/--
Logs a message through the JavaScript host's console binding.

The default browser/runtime binding calls `console.log`. The host call is
synchronous and returns `Unit`.

Reference: [MDN `console.log`](https://developer.mozilla.org/en-US/docs/Web/API/console/log_static).
-/
def log (message : @& String) : IO Unit :=
  Lean.Vir.RuntimeM.run do
    let jsMessage ← Lean.Vir.JsValue.ofString message
    logJs jsMessage

end Console

namespace Document

/--
Returns the first element matching a CSS selector.

In a browser this calls `document.querySelector(selector)`. In Node tests, use
the `lean-vir/vir-runtime-node` wrapper for virtual document state. The virtual
binding follows DOM lookup behavior: a missing selector returns `none`. Tests
that need an element fixture should pre-seed it from JavaScript with
`ensureVirtualElementState`.

Reference: [MDN `Document.querySelector`](https://developer.mozilla.org/en-US/docs/Web/API/Document/querySelector).
-/
def querySelectorString
    (selector : @& String) :
    DomM (Option (Lean.Vir.Js Element)) := do
  let jsSelector ← Lean.Vir.JsValue.ofString selector
  Lean.Vir.Js.Nullable.toOption (← querySelector jsSelector)

/--
Returns the static list of elements matching a CSS selector.

The returned `NodeList` remains in JavaScript land. Its element parameter is
the Lean view produced by `Lean.Vir.Js.NodeList.item`; extracted element
handles remain valid independently of the list.

Reference: [MDN `Document.querySelectorAll`](https://developer.mozilla.org/en-US/docs/Web/API/Document/querySelectorAll).
-/
def querySelectorAllString
    (selector : @& String) :
    DomM (Lean.Vir.Js.NodeList (Lean.Vir.Js Element)) := do
  querySelectorAll (← Lean.Vir.JsValue.ofString selector)

/-- Converts a Lean tag name before calling `document.createElement`. -/
def createElementString (tagName : @& String) : DomM (Lean.Vir.Js Element) := do
  createElement (← Lean.Vir.JsValue.ofString tagName)

end Document

namespace CSSStyleDeclaration

/-- Converts Lean strings around the exact `CSSStyleDeclaration.setProperty` binding. -/
def setPropertyString
    (declaration : @& Lean.Vir.Js CSSStyleDeclaration)
    (name value : @& String) : DomM Unit := do
  let jsName ← Lean.Vir.JsValue.ofString name
  let jsValue ← Lean.Vir.JsValue.ofString value
  setProperty declaration jsName (← Lean.Vir.Js.Nullable.ofJs jsValue)

end CSSStyleDeclaration

namespace ElementCSSInlineStyle

/--
Checks whether an element implements `ElementCSSInlineStyle` without changing
its JavaScript identity.
-/
def fromElement
    (element : @& Lean.Vir.Js Element) :
    DomM (Option (Lean.Vir.Js ElementCSSInlineStyle)) := do
  Lean.Vir.Js.Nullable.toOption (← fromElementNullable element)

/-- Converts a Lean string before replacing the element's inline style text. -/
def setStyleString
    (element : @& Lean.Vir.Js ElementCSSInlineStyle)
    (style : @& String) : DomM Unit := do
  setStyle element (← Lean.Vir.JsValue.ofString style)

/-- Sets a property through the element's exact `CSSStyleDeclaration` value. -/
def setPropertyString
    (element : @& Lean.Vir.Js ElementCSSInlineStyle)
    (name value : @& String) : DomM Unit := do
  CSSStyleDeclaration.setPropertyString (← getStyle element) name value

end ElementCSSInlineStyle

namespace Element

/-- Converts a Lean selector before calling the faithful `Element.querySelector` binding. -/
def querySelectorString
    (element : @& Lean.Vir.Js Element)
    (selector : @& String) :
    DomM (Option (Lean.Vir.Js Element)) := do
  let jsSelector ← Lean.Vir.JsValue.ofString selector
  Lean.Vir.Js.Nullable.toOption (← querySelector element jsSelector)

/-- Converts a Lean selector before calling the faithful `Element.querySelectorAll` binding. -/
def querySelectorAllString
    (element : @& Lean.Vir.Js Element)
    (selector : @& String) :
    DomM (Lean.Vir.Js.NodeList (Lean.Vir.Js Element)) := do
  querySelectorAll element (← Lean.Vir.JsValue.ofString selector)

/-- Converts a Lean-owned attribute name and result around the faithful `getAttribute` binding. -/
def getAttributeString
    (element : @& Lean.Vir.Js Element)
    (name : @& String) :
    DomM (Option String) := do
  let jsName ← Lean.Vir.JsValue.ofString name
  match ← Lean.Vir.Js.Nullable.toOption (← getAttribute element jsName) with
  | none => pure none
  | some value =>
      let text ← Lean.Vir.JsValue.toString value
      pure (some text)

/-- Converts Lean-owned attribute text around the faithful `setAttribute` binding. -/
def setAttributeString
    (element : @& Lean.Vir.Js Element)
    (name value : @& String) :
    DomM Unit := do
  let jsName ← Lean.Vir.JsValue.ofString name
  let jsValue ← Lean.Vir.JsValue.ofString value
  setAttribute element jsName jsValue

namespace ClassList

/-- Adds a CSS class through the element's exact `DOMTokenList` value. -/
def add (element : @& Lean.Vir.Js Element) (className : @& String) : DomM Unit := do
  let tokenList ← getClassList element
  DOMTokenList.add tokenList (← Lean.Vir.JsValue.ofString className)

/-- Removes a CSS class through the element's exact `DOMTokenList` value. -/
def remove (element : @& Lean.Vir.Js Element) (className : @& String) : DomM Unit := do
  let tokenList ← getClassList element
  DOMTokenList.remove tokenList (← Lean.Vir.JsValue.ofString className)

/-- Toggles a CSS class through the exact list and reports its resulting presence. -/
def toggle (element : @& Lean.Vir.Js Element) (className : @& String) : DomM Bool := do
  let tokenList ← getClassList element
  Lean.Vir.JsValue.toBool
    (← DOMTokenList.toggle tokenList (← Lean.Vir.JsValue.ofString className))

end ClassList

/--
Registers a browser event listener backed by a Lean callback closure.

The host retains the callback until `Element.removeEventListener` is called or
the owning runtime is disposed. The callback receives an opaque event resource
that is valid only during that event dispatch.

Reference: [MDN `EventTarget.addEventListener`](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener).
-/
def addEventListener
    (element : @& Lean.Vir.Js Element)
    (event : @& String)
    (callback : Lean.Vir.Js Event → DomM Unit) :
    DomM (Lean.Vir.Js EventListener) := do
  let jsEvent ← Lean.Vir.JsValue.ofString event
  addEventListenerJs element jsEvent callback

end Element

namespace HTMLInputElement

/--
Narrows a generic DOM element to an `HTMLInputElement` when possible.

In a browser this returns `some` exactly when the element is an
`HTMLInputElement`. In Node tests, use the `lean-vir/vir-runtime-node` wrapper
for virtual document state.

Reference: [MDN `HTMLInputElement`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement).
-/
def fromElement (element : @& Lean.Vir.Js Element) : DomM (Option (Lean.Vir.Js HTMLInputElement)) := do
  Lean.Vir.Js.Nullable.toOption (← fromElementNullable element)

/--
Reads the `checked` property of a checkbox or radio input.

In a browser this reads `input.checked`. In Node tests, use the
`lean-vir/vir-runtime-node` wrapper for virtual document state.

Reference: [MDN `HTMLInputElement.checked`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/checked).
-/
def getCheckedBool (input : @& Lean.Vir.Js HTMLInputElement) : DomM Bool := do
  let checked ← getChecked input
  Lean.Vir.JsValue.toBool checked

/--
Sets the `checked` property of a checkbox or radio input.

In a browser this writes `input.checked`. In Node tests, use the
`lean-vir/vir-runtime-node` wrapper for virtual document state.

Reference: [MDN `HTMLInputElement.checked`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/checked).
-/
def setCheckedBool (input : @& Lean.Vir.Js HTMLInputElement) (checked : Bool) : DomM Unit := do
  let jsChecked ← Lean.Vir.JsValue.ofBool checked
  setChecked input jsChecked

/--
Reads the `value` property of an input element.

In a browser this reads `input.value`. In Node tests, use the
`lean-vir/vir-runtime-node` wrapper for virtual document state.

Reference: [MDN `HTMLInputElement.value`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/value).
-/
def getValueString (input : @& Lean.Vir.Js HTMLInputElement) : DomM String := do
  let value ← getValue input
  Lean.Vir.JsValue.toString value

/--
Sets the `value` property of an input element.

In a browser this writes `input.value`. In Node tests, use the
`lean-vir/vir-runtime-node` wrapper for virtual document state.

Reference: [MDN `HTMLInputElement.value`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/value).
-/
def setValueString (input : @& Lean.Vir.Js HTMLInputElement) (value : @& String) : DomM Unit := do
  let jsValue ← Lean.Vir.JsValue.ofString value
  setValue input jsValue

end HTMLInputElement

namespace HTMLCanvasElement

/-- Narrows a generic DOM element to an `HTMLCanvasElement`. -/
def fromElement
    (element : @& Lean.Vir.Js Element) :
    DomM (Option (Lean.Vir.Js HTMLCanvasElement)) := do
  Lean.Vir.Js.Nullable.toOption (← fromElementNullable element)

/-- Returns the canvas bitmap width. -/
def getWidthNat (canvas : @& Lean.Vir.Js HTMLCanvasElement) : DomM Nat := do
  return (← Lean.Vir.JsValue.toFloat (← getWidth canvas)).toUInt64.toNat

/-- Sets the canvas bitmap width. -/
def setWidthNat (canvas : @& Lean.Vir.Js HTMLCanvasElement) (width : Nat) : DomM Unit := do
  setWidth canvas (← Lean.Vir.JsValue.ofFloat (UInt64.ofNat width).toFloat)

/-- Returns the canvas bitmap height. -/
def getHeightNat (canvas : @& Lean.Vir.Js HTMLCanvasElement) : DomM Nat := do
  return (← Lean.Vir.JsValue.toFloat (← getHeight canvas)).toUInt64.toNat

/-- Sets the canvas bitmap height. -/
def setHeightNat (canvas : @& Lean.Vir.Js HTMLCanvasElement) (height : Nat) : DomM Unit := do
  setHeight canvas (← Lean.Vir.JsValue.ofFloat (UInt64.ofNat height).toFloat)

/-- Returns the canvas's two-dimensional rendering context when available. -/
def getContext2D
    (canvas : @& Lean.Vir.Js HTMLCanvasElement) :
    DomM (Option (Lean.Vir.Js CanvasRenderingContext2D)) := do
  Lean.Vir.Js.Nullable.toOption (← getContext2DNullable canvas)

end HTMLCanvasElement

namespace CanvasRenderingContext2D

private def withFloat (value : Float)
    (next : Lean.Vir.Js Float → DomM α) : DomM α := do
  next (← Internal.ownedFloat value)

/-- Clears an axis-aligned rectangle to transparent black. -/
def clearRect
    (ctx : @& Lean.Vir.Js CanvasRenderingContext2D)
    (x y width height : Float) : DomM Unit :=
  withFloat x fun x => withFloat y fun y =>
  withFloat width fun width => withFloat height fun height =>
  clearRectJs ctx x y width height

/-- Fills an axis-aligned rectangle in the current fill style. -/
def fillRect
    (ctx : @& Lean.Vir.Js CanvasRenderingContext2D)
    (x y width height : Float) :
    DomM Unit :=
  withFloat x fun x => withFloat y fun y =>
  withFloat width fun width => withFloat height fun height =>
  fillRectJs ctx x y width height

/-- Strokes an axis-aligned rectangle in the current stroke style. -/
def strokeRect
    (ctx : @& Lean.Vir.Js CanvasRenderingContext2D)
    (x y width height : Float) : DomM Unit :=
  withFloat x fun x => withFloat y fun y =>
  withFloat width fun width => withFloat height fun height =>
  strokeRectJs ctx x y width height

/-- Moves the current path point without drawing. -/
def moveTo (ctx : @& Lean.Vir.Js CanvasRenderingContext2D) (x y : Float) : DomM Unit :=
  withFloat x fun x => withFloat y fun y => moveToJs ctx x y

/-- Adds a line from the current path point to `(x, y)`. -/
def lineTo (ctx : @& Lean.Vir.Js CanvasRenderingContext2D) (x y : Float) : DomM Unit :=
  withFloat x fun x => withFloat y fun y => lineToJs ctx x y

/-- Adds a clockwise circular arc to the current path. -/
def arc
    (ctx : @& Lean.Vir.Js CanvasRenderingContext2D)
    (x y radius startAngle endAngle : Float) : DomM Unit :=
  withFloat x fun x => withFloat y fun y => withFloat radius fun radius =>
  withFloat startAngle fun startAngle => withFloat endAngle fun endAngle =>
  arcJs ctx x y radius startAngle endAngle

/-- Sets the context's CSS fill style. -/
def setFillStyle
    (ctx : @& Lean.Vir.Js CanvasRenderingContext2D) (style : @& String) : DomM Unit := do
  setFillStyleJs ctx (← Internal.ownedString style)

/-- Sets the context's CSS stroke style. -/
def setStrokeStyle
    (ctx : @& Lean.Vir.Js CanvasRenderingContext2D) (style : @& String) : DomM Unit := do
  setStrokeStyleJs ctx (← Internal.ownedString style)

/-- Sets the context's stroke width. -/
def setLineWidth
    (ctx : @& Lean.Vir.Js CanvasRenderingContext2D) (width : Float) : DomM Unit :=
  withFloat width fun width => setLineWidthJs ctx width

/-- Translates the current transformation matrix. -/
def translate (ctx : @& Lean.Vir.Js CanvasRenderingContext2D) (x y : Float) : DomM Unit :=
  withFloat x fun x => withFloat y fun y => translateJs ctx x y

/-- Rotates the current transformation matrix by radians. -/
def rotate (ctx : @& Lean.Vir.Js CanvasRenderingContext2D) (angle : Float) : DomM Unit :=
  withFloat angle fun angle => rotateJs ctx angle

end CanvasRenderingContext2D

namespace Event

/--
Returns the current input element for an input-like event.

This checks `currentTarget` first, then falls back to `target`, and narrows the
element with `HTMLInputElement.fromElement`.
-/
def inputElement? (event : @& Lean.Vir.Js Event) : DomM (Option (Lean.Vir.Js HTMLInputElement)) := do
  match ← currentTargetOption event with
  | some element => HTMLInputElement.fromElement element
  | none =>
      match ← targetOption event with
      | none => pure none
      | some element => HTMLInputElement.fromElement element

/--
Returns the current input value for an input-like event.

This is the usual helper for controlled input handlers. It checks
`currentTarget` before `target`.
-/
def inputValue? (event : @& Lean.Vir.Js Event) : DomM (Option String) := do
  match ← inputElement? event with
  | none => pure none
  | some input => some <$> HTMLInputElement.getValueString input

/--
Returns the current value for a form-control event.

This checks `currentTarget` first, then falls back to `target`. In a browser it
returns `some value` for `HTMLInputElement`, `HTMLTextAreaElement`, and
`HTMLSelectElement` targets, and `none` for other elements.
-/
def formValue? (event : @& Lean.Vir.Js Event) : DomM (Option String) := do
  match ← Lean.Vir.Js.Nullable.toOption (← formValueNullable event) with
  | none => pure none
  | some value =>
      let text ← Lean.Vir.JsValue.toString value
      pure (some text)

/--
Returns the current checked state for an input-like event.

This is the usual helper for controlled checkbox/radio handlers. It checks
`currentTarget` before `target`.
-/
def inputChecked? (event : @& Lean.Vir.Js Event) : DomM (Option Bool) := do
  match ← inputElement? event with
  | none => pure none
  | some input => some <$> HTMLInputElement.getCheckedBool input

end Event

namespace Timer

/--
Runs `callback` once after `delayMs` milliseconds.

The host releases the retained callback after it fires or when the timeout is
cleared.

Reference: [MDN `setTimeout`](https://developer.mozilla.org/en-US/docs/Web/API/setTimeout).
-/
def setTimeout (delayMs : UInt32) (callback : DomM Unit) : DomM (Lean.Vir.Js Timeout) := do
  let jsDelay ← Lean.Vir.JsValue.ofNat delayMs.toNat
  setTimeoutJs jsDelay callback

/--
Runs `callback` every `delayMs` milliseconds until cleared.

The host retains the callback until `clearInterval` is called or the runtime is
disposed.

Reference: [MDN `setInterval`](https://developer.mozilla.org/en-US/docs/Web/API/setInterval).
-/
def setInterval (delayMs : UInt32) (callback : DomM Unit) : DomM (Lean.Vir.Js Interval) := do
  let jsDelay ← Lean.Vir.JsValue.ofNat delayMs.toNat
  setIntervalJs jsDelay callback

end Timer

namespace Animation

/--
Runs `callback` at the next animation frame.

The callback receives the browser frame timestamp. The host releases the
retained callback after it fires or when the frame is cancelled.

Reference: [MDN `requestAnimationFrame`](https://developer.mozilla.org/en-US/docs/Web/API/window/requestAnimationFrame).
-/
def requestAnimationFrame (callback : Float → DomM Unit) : DomM (Lean.Vir.Js AnimationFrame) :=
  requestAnimationFrameJs fun timestamp => do
    let value ← Lean.Vir.JsValue.toFloat timestamp
    callback value

end Animation

end Lean.Vir.Browser
