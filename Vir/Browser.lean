/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.Common
import Vir.Js

namespace Lean.Vir.Browser

/-- Browser/DOM effect used by Lean-authored browser code. -/
@[irreducible] def DomM (α : Type) : Type :=
  Lean.Vir.RuntimeM α

namespace DomM

/-- Runs a browser/DOM action at an exported `IO` boundary. -/
def run (action : DomM α) : IO α :=
  by
    unfold DomM at action
    exact action.run

instance : Monad DomM where
  pure value :=
    by
      unfold DomM
      exact pure value
  bind action next :=
    by
      unfold DomM at action
      unfold DomM
      exact action >>= fun value => by
        unfold DomM at next
        exact next value

instance : MonadLift Lean.Vir.RuntimeM DomM where
  monadLift action :=
    by
      unfold DomM
      exact action

instance : Nonempty (DomM α) :=
  by
    unfold DomM
    infer_instance

end DomM

/--
Browser DOM element object class.

Lean code receives element values from `Document.querySelector` and passes them
to `Element` or more-specific element APIs. The current `wasm32-wasip1` runtime
represents this as a typed JavaScript object resource; Lean programs should not
construct or persist assumptions about the resource representation.

Reference: [MDN `Element`](https://developer.mozilla.org/en-US/docs/Web/API/Element).
-/
opaque Element : Type

/--
Browser event object class.

Listener callbacks receive event values as private
resources. The event resource is only valid for the duration of that listener
callback.

Reference: [MDN `Event`](https://developer.mozilla.org/en-US/docs/Web/API/Event).
-/
opaque Event : Type

/--
Browser event listener registration object class.

`Element.addEventListener` returns listener handles so Lean code can remove the
registered listener later with `Element.removeEventListener`.

Reference: [MDN `EventTarget.addEventListener`](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener).
-/
opaque EventListener : Type

/--
Browser `HTMLInputElement` object class.

Use `HTMLInputElement.fromElement` to narrow an `Element` before reading or
writing input-specific DOM properties.

Reference: [MDN `HTMLInputElement`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement).
-/
opaque HTMLInputElement : Type

/-- Browser `HTMLCanvasElement` object class. -/
opaque HTMLCanvasElement : Type

/-- Browser two-dimensional canvas rendering context. -/
opaque CanvasRenderingContext2D : Type

/--
Browser timeout object class returned by `setTimeout`.

The JavaScript host owns the timer registration and the retained Lean callback
until the timer fires, is cleared, or the runtime is disposed.
-/
opaque Timeout : Type

/--
Browser interval object class returned by `setInterval`.

The JavaScript host owns the timer registration and the retained Lean callback
until the interval is cleared or the runtime is disposed.
-/
opaque Interval : Type

/--
Browser animation-frame object class returned by `requestAnimationFrame`.

The JavaScript host owns the frame registration and the retained Lean callback
until the frame fires, is cancelled, or the runtime is disposed.
-/
opaque AnimationFrame : Type

namespace Event

/--
Returns the event target as a DOM element when the target is an element.

The returned element resource may be used after the callback, but the event
resource itself remains callback-scoped.

Reference: [MDN `Event.target`](https://developer.mozilla.org/en-US/docs/Web/API/Event/target).
-/
@[vir_js "browser.event.target"]
private opaque targetNullable (event : @& Lean.Vir.Js Event) : DomM (Lean.Vir.Js.Nullable Element)

def target (event : @& Lean.Vir.Js Event) : DomM (Option (Lean.Vir.Js Element)) := do
  Lean.Vir.Js.Nullable.toOption (← targetNullable event)

/--
Returns the current event target as a DOM element when the current target is an
element.

The returned element resource may be used after the callback, but the event
resource itself remains callback-scoped.

Reference: [MDN `Event.currentTarget`](https://developer.mozilla.org/en-US/docs/Web/API/Event/currentTarget).
-/
@[vir_js "browser.event.currentTarget"]
private opaque currentTargetNullable (event : @& Lean.Vir.Js Event) :
    DomM (Lean.Vir.Js.Nullable Element)

def currentTarget (event : @& Lean.Vir.Js Event) : DomM (Option (Lean.Vir.Js Element)) := do
  Lean.Vir.Js.Nullable.toOption (← currentTargetNullable event)

/--
Prevents the default action for this event when the underlying browser event is
cancelable.

Reference: [MDN `Event.preventDefault`](https://developer.mozilla.org/en-US/docs/Web/API/Event/preventDefault).
-/
@[vir_js "browser.event.preventDefault"]
opaque preventDefault (event : @& Lean.Vir.Js Event) : DomM Unit

/--
Stops propagation of this event to further listeners.

Reference: [MDN `Event.stopPropagation`](https://developer.mozilla.org/en-US/docs/Web/API/Event/stopPropagation).
-/
@[vir_js "browser.event.stopPropagation"]
opaque stopPropagation (event : @& Lean.Vir.Js Event) : DomM Unit

end Event

namespace Console

/--
Logs a message through the JavaScript host's console binding.

The default browser/runtime binding calls `console.log`. The host call is
synchronous and returns `Unit`.

Reference: [MDN `console.log`](https://developer.mozilla.org/en-US/docs/Web/API/console/log_static).
-/
@[vir_js "browser.console.log"]
private opaque logJs (message : @& Lean.Vir.Js String) : Lean.Vir.RuntimeM Unit

def log (message : @& String) : IO Unit :=
  Lean.Vir.RuntimeM.run do
    let jsMessage ← Lean.Vir.JsValue.ofString message
    logJs jsMessage

end Console

namespace Document

/--
Reads the current document title through the JavaScript host.

In a browser this returns `document.title`. In Node tests, use the
`lean-vir/vir-runtime-node` wrapper for virtual document state.

Reference: [MDN `Document.title`](https://developer.mozilla.org/en-US/docs/Web/API/Document/title).
-/
@[vir_js "browser.document.getTitle"]
private opaque getTitleJs : DomM (Lean.Vir.Js String)

def getTitle : DomM String := do
  let title ← getTitleJs
  Lean.Vir.JsValue.toString title

/--
Sets the current document title through the JavaScript host.

In a browser this writes `document.title`. In Node tests, use the
`lean-vir/vir-runtime-node` wrapper for virtual document state.

Reference: [MDN `Document.title`](https://developer.mozilla.org/en-US/docs/Web/API/Document/title).
-/
@[vir_js "browser.document.setTitle"]
private opaque setTitleJs (title : @& Lean.Vir.Js String) : DomM Unit

def setTitle (title : @& String) : DomM Unit := do
  let jsTitle ← Lean.Vir.JsValue.ofString title
  setTitleJs jsTitle

/--
Returns the first element matching a CSS selector.

In a browser this calls `document.querySelector(selector)`. In Node tests, use
the `lean-vir/vir-runtime-node` wrapper for virtual document state. The virtual
binding follows DOM lookup behavior: a missing selector returns `none`. Tests
that need an element fixture should pre-seed it from JavaScript with
`ensureVirtualElementState`.

Reference: [MDN `Document.querySelector`](https://developer.mozilla.org/en-US/docs/Web/API/Document/querySelector).
-/
@[vir_js "browser.document.querySelector"]
private opaque querySelectorNullable
    (selector : @& Lean.Vir.Js String) :
    DomM (Lean.Vir.Js.Nullable Element)

def querySelector (selector : @& String) : DomM (Option (Lean.Vir.Js Element)) := do
  let jsSelector ← Lean.Vir.JsValue.ofString selector
  Lean.Vir.Js.Nullable.toOption (← querySelectorNullable jsSelector)

/-- Creates a DOM element with the given HTML tag name. -/
@[vir_js "browser.document.createElement"]
private opaque createElementJs (tagName : @& Lean.Vir.Js String) : DomM (Lean.Vir.Js Element)

def createElement (tagName : @& String) : DomM (Lean.Vir.Js Element) := do
  createElementJs (← Lean.Vir.JsValue.ofString tagName)

end Document

namespace Element

/--
Reads an element's text content through the JavaScript host.

In a browser this reads `element.textContent` and returns the empty string when
the property is `null`. In Node tests, use the `lean-vir/vir-runtime-node`
wrapper for virtual document state.

Reference: [MDN `Node.textContent`](https://developer.mozilla.org/en-US/docs/Web/API/Node/textContent).
-/
@[vir_js "browser.element.getTextContent"]
private opaque getTextContentJs (element : @& Lean.Vir.Js Element) : DomM (Lean.Vir.Js String)

def getTextContent (element : @& Lean.Vir.Js Element) : DomM String := do
  let text ← getTextContentJs element
  Lean.Vir.JsValue.toString text

/--
Sets an element's text content through the JavaScript host.

In a browser this writes `element.textContent`. In Node tests, use the
`lean-vir/vir-runtime-node` wrapper for virtual document state.

Reference: [MDN `Node.textContent`](https://developer.mozilla.org/en-US/docs/Web/API/Node/textContent).
-/
@[vir_js "browser.element.setTextContent"]
private opaque setTextContentJs
    (element : @& Lean.Vir.Js Element)
    (text : @& Lean.Vir.Js String) :
    DomM Unit

def setTextContent (element : @& Lean.Vir.Js Element) (text : @& String) : DomM Unit := do
  let jsText ← Lean.Vir.JsValue.ofString text
  setTextContentJs element jsText

/--
Reads an element attribute through the JavaScript host.

In a browser this calls `element.getAttribute(name)`. The result is `none` when
the attribute is absent. In Node tests, use the `lean-vir/vir-runtime-node`
wrapper for virtual document state.

Reference: [MDN `Element.getAttribute`](https://developer.mozilla.org/en-US/docs/Web/API/Element/getAttribute).
-/
@[vir_js "browser.element.getAttribute"]
private opaque getAttributeNullable
    (element : @& Lean.Vir.Js Element)
    (name : @& Lean.Vir.Js String) :
    DomM (Lean.Vir.Js.Nullable String)

def getAttribute (element : @& Lean.Vir.Js Element) (name : @& String) : DomM (Option String) := do
  let jsName ← Lean.Vir.JsValue.ofString name
  match ← Lean.Vir.Js.Nullable.toOption (← getAttributeNullable element jsName) with
  | none => pure none
  | some value =>
      let text ← Lean.Vir.JsValue.toString value
      pure (some text)

/--
Sets an element attribute through the JavaScript host.

In a browser this calls `element.setAttribute(name, value)`. In Node tests, use
the `lean-vir/vir-runtime-node` wrapper for virtual document state.

Reference: [MDN `Element.setAttribute`](https://developer.mozilla.org/en-US/docs/Web/API/Element/setAttribute).
-/
@[vir_js "browser.element.setAttribute"]
private opaque setAttributeJs
    (element : @& Lean.Vir.Js Element)
    (name value : @& Lean.Vir.Js String) :
    DomM Unit

def setAttribute (element : @& Lean.Vir.Js Element) (name value : @& String) : DomM Unit := do
  let jsName ← Lean.Vir.JsValue.ofString name
  let jsValue ← Lean.Vir.JsValue.ofString value
  setAttributeJs element jsName jsValue

/-- Appends `child` to `parent` and returns no ownership-bearing DOM value. -/
@[vir_js "browser.element.appendChild"]
opaque appendChild
    (parent child : @& Lean.Vir.Js Element) :
    DomM Unit

/-- Removes an element from its parent, if it has one. -/
@[vir_js "browser.element.remove"]
opaque remove (element : @& Lean.Vir.Js Element) : DomM Unit

namespace ClassList

@[vir_js "browser.element.classList.add"]
private opaque addJs
    (element : @& Lean.Vir.Js Element)
    (className : @& Lean.Vir.Js String) : DomM Unit

def add (element : @& Lean.Vir.Js Element) (className : @& String) : DomM Unit := do
  addJs element (← Lean.Vir.JsValue.ofString className)

@[vir_js "browser.element.classList.remove"]
private opaque removeJs
    (element : @& Lean.Vir.Js Element)
    (className : @& Lean.Vir.Js String) : DomM Unit

def remove (element : @& Lean.Vir.Js Element) (className : @& String) : DomM Unit := do
  removeJs element (← Lean.Vir.JsValue.ofString className)

@[vir_js "browser.element.classList.toggle"]
private opaque toggleJs
    (element : @& Lean.Vir.Js Element)
    (className : @& Lean.Vir.Js String) : DomM (Lean.Vir.Js Bool)

def toggle (element : @& Lean.Vir.Js Element) (className : @& String) : DomM Bool := do
  Lean.Vir.JsValue.toBool (← toggleJs element (← Lean.Vir.JsValue.ofString className))

end ClassList

namespace Style

/-- Calls `element.style.setProperty(name, value)`. -/
@[vir_js "browser.element.style.setProperty"]
private opaque setPropertyJs
    (element : @& Lean.Vir.Js Element)
    (name value : @& Lean.Vir.Js String) : DomM Unit

def setProperty
    (element : @& Lean.Vir.Js Element)
    (name value : @& String) : DomM Unit := do
  setPropertyJs element
    (← Lean.Vir.JsValue.ofString name)
    (← Lean.Vir.JsValue.ofString value)

end Style

/--
Registers a browser event listener backed by a Lean callback closure.

The host retains the callback until `Element.removeEventListener` is called or
the owning runtime is disposed. The callback receives an opaque event resource
that is valid only during that event dispatch.

Reference: [MDN `EventTarget.addEventListener`](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener).
-/
@[vir_js "browser.element.addEventListener"]
private opaque addEventListenerJs
    (element : @& Lean.Vir.Js Element)
    (event : @& Lean.Vir.Js String)
    (callback : Lean.Vir.Js Event → DomM Unit) :
    DomM (Lean.Vir.Js EventListener)

def addEventListener
    (element : @& Lean.Vir.Js Element)
    (event : @& String)
    (callback : Lean.Vir.Js Event → DomM Unit) :
    DomM (Lean.Vir.Js EventListener) := do
  let jsEvent ← Lean.Vir.JsValue.ofString event
  addEventListenerJs element jsEvent callback

/--
Removes a listener previously registered by `Element.addEventListener`.

Reference: [MDN `EventTarget.removeEventListener`](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/removeEventListener).
-/
@[vir_js "browser.element.removeEventListener"]
opaque removeEventListener (listener : @& Lean.Vir.Js EventListener) : DomM Unit

end Element

namespace HTMLInputElement

/--
Narrows a generic DOM element to an `HTMLInputElement` when possible.

In a browser this returns `some` exactly when the element is an
`HTMLInputElement`. In Node tests, use the `lean-vir/vir-runtime-node` wrapper
for virtual document state.

Reference: [MDN `HTMLInputElement`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement).
-/
@[vir_js "browser.htmlInputElement.fromElement"]
private opaque fromElementNullable
    (element : @& Lean.Vir.Js Element) :
    DomM (Lean.Vir.Js.Nullable HTMLInputElement)

def fromElement (element : @& Lean.Vir.Js Element) : DomM (Option (Lean.Vir.Js HTMLInputElement)) := do
  Lean.Vir.Js.Nullable.toOption (← fromElementNullable element)

/--
Reads the `checked` property of a checkbox or radio input.

In a browser this reads `input.checked`. In Node tests, use the
`lean-vir/vir-runtime-node` wrapper for virtual document state.

Reference: [MDN `HTMLInputElement.checked`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/checked).
-/
@[vir_js "browser.htmlInputElement.getChecked"]
private opaque getCheckedJs (input : @& Lean.Vir.Js HTMLInputElement) : DomM (Lean.Vir.Js Bool)

def getChecked (input : @& Lean.Vir.Js HTMLInputElement) : DomM Bool := do
  let checked ← getCheckedJs input
  Lean.Vir.JsValue.toBool checked

/--
Sets the `checked` property of a checkbox or radio input.

In a browser this writes `input.checked`. In Node tests, use the
`lean-vir/vir-runtime-node` wrapper for virtual document state.

Reference: [MDN `HTMLInputElement.checked`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/checked).
-/
@[vir_js "browser.htmlInputElement.setChecked"]
private opaque setCheckedJs
    (input : @& Lean.Vir.Js HTMLInputElement)
    (checked : @& Lean.Vir.Js Bool) :
    DomM Unit

def setChecked (input : @& Lean.Vir.Js HTMLInputElement) (checked : Bool) : DomM Unit := do
  let jsChecked ← Lean.Vir.JsValue.ofBool checked
  setCheckedJs input jsChecked

/--
Reads the `value` property of an input element.

In a browser this reads `input.value`. In Node tests, use the
`lean-vir/vir-runtime-node` wrapper for virtual document state.

Reference: [MDN `HTMLInputElement.value`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/value).
-/
@[vir_js "browser.htmlInputElement.getValue"]
private opaque getValueJs (input : @& Lean.Vir.Js HTMLInputElement) : DomM (Lean.Vir.Js String)

def getValue (input : @& Lean.Vir.Js HTMLInputElement) : DomM String := do
  let value ← getValueJs input
  Lean.Vir.JsValue.toString value

/--
Sets the `value` property of an input element.

In a browser this writes `input.value`. In Node tests, use the
`lean-vir/vir-runtime-node` wrapper for virtual document state.

Reference: [MDN `HTMLInputElement.value`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/value).
-/
@[vir_js "browser.htmlInputElement.setValue"]
private opaque setValueJs
    (input : @& Lean.Vir.Js HTMLInputElement)
    (value : @& Lean.Vir.Js String) :
    DomM Unit

def setValue (input : @& Lean.Vir.Js HTMLInputElement) (value : @& String) : DomM Unit := do
  let jsValue ← Lean.Vir.JsValue.ofString value
  setValueJs input jsValue

end HTMLInputElement

namespace HTMLCanvasElement

@[vir_js "browser.htmlCanvasElement.fromElement"]
private opaque fromElementNullable
    (element : @& Lean.Vir.Js Element) :
    DomM (Lean.Vir.Js.Nullable HTMLCanvasElement)

/-- Narrows a generic DOM element to an `HTMLCanvasElement`. -/
def fromElement
    (element : @& Lean.Vir.Js Element) :
    DomM (Option (Lean.Vir.Js HTMLCanvasElement)) := do
  Lean.Vir.Js.Nullable.toOption (← fromElementNullable element)

@[vir_js "browser.htmlCanvasElement.getWidth"]
private opaque getWidthJs
    (canvas : @& Lean.Vir.Js HTMLCanvasElement) : DomM (Lean.Vir.Js Nat)

def getWidth (canvas : @& Lean.Vir.Js HTMLCanvasElement) : DomM Nat := do
  Lean.Vir.JsValue.toNat (← getWidthJs canvas)

@[vir_js "browser.htmlCanvasElement.setWidth"]
private opaque setWidthJs
    (canvas : @& Lean.Vir.Js HTMLCanvasElement)
    (width : @& Lean.Vir.Js Nat) : DomM Unit

def setWidth (canvas : @& Lean.Vir.Js HTMLCanvasElement) (width : Nat) : DomM Unit := do
  setWidthJs canvas (← Lean.Vir.JsValue.ofNat width)

@[vir_js "browser.htmlCanvasElement.getHeight"]
private opaque getHeightJs
    (canvas : @& Lean.Vir.Js HTMLCanvasElement) : DomM (Lean.Vir.Js Nat)

def getHeight (canvas : @& Lean.Vir.Js HTMLCanvasElement) : DomM Nat := do
  Lean.Vir.JsValue.toNat (← getHeightJs canvas)

@[vir_js "browser.htmlCanvasElement.setHeight"]
private opaque setHeightJs
    (canvas : @& Lean.Vir.Js HTMLCanvasElement)
    (height : @& Lean.Vir.Js Nat) : DomM Unit

def setHeight (canvas : @& Lean.Vir.Js HTMLCanvasElement) (height : Nat) : DomM Unit := do
  setHeightJs canvas (← Lean.Vir.JsValue.ofNat height)

@[vir_js "browser.htmlCanvasElement.getContext2D"]
private opaque getContext2DNullable
    (canvas : @& Lean.Vir.Js HTMLCanvasElement) :
    DomM (Lean.Vir.Js.Nullable CanvasRenderingContext2D)

def getContext2D
    (canvas : @& Lean.Vir.Js HTMLCanvasElement) :
    DomM (Option (Lean.Vir.Js CanvasRenderingContext2D)) := do
  Lean.Vir.Js.Nullable.toOption (← getContext2DNullable canvas)

end HTMLCanvasElement

namespace CanvasRenderingContext2D

private def withFloat (value : Float)
    (next : Lean.Vir.Js Float → DomM α) : DomM α := do
  next (← Lean.Vir.JsValue.ofFloat value)

@[vir_js "browser.canvas2d.clearRect"]
private opaque clearRectJs
    (ctx : @& Lean.Vir.Js CanvasRenderingContext2D)
    (x y width height : @& Lean.Vir.Js Float) : DomM Unit

def clearRect
    (ctx : @& Lean.Vir.Js CanvasRenderingContext2D)
    (x y width height : Float) : DomM Unit :=
  withFloat x fun x => withFloat y fun y =>
  withFloat width fun width => withFloat height fun height =>
  clearRectJs ctx x y width height

@[vir_js "browser.canvas2d.fillRect"]
private opaque fillRectJs
    (ctx : @& Lean.Vir.Js CanvasRenderingContext2D)
    (x y width height : @& Lean.Vir.Js Float) : DomM Unit

/-- Fills an axis-aligned rectangle in the current fill style. -/
def fillRect
    (ctx : @& Lean.Vir.Js CanvasRenderingContext2D)
    (x y width height : Float) :
    DomM Unit :=
  withFloat x fun x => withFloat y fun y =>
  withFloat width fun width => withFloat height fun height =>
  fillRectJs ctx x y width height

@[vir_js "browser.canvas2d.strokeRect"]
private opaque strokeRectJs
    (ctx : @& Lean.Vir.Js CanvasRenderingContext2D)
    (x y width height : @& Lean.Vir.Js Float) : DomM Unit

def strokeRect
    (ctx : @& Lean.Vir.Js CanvasRenderingContext2D)
    (x y width height : Float) : DomM Unit :=
  withFloat x fun x => withFloat y fun y =>
  withFloat width fun width => withFloat height fun height =>
  strokeRectJs ctx x y width height

@[vir_js "browser.canvas2d.beginPath"]
opaque beginPath (ctx : @& Lean.Vir.Js CanvasRenderingContext2D) : DomM Unit

@[vir_js "browser.canvas2d.closePath"]
opaque closePath (ctx : @& Lean.Vir.Js CanvasRenderingContext2D) : DomM Unit

@[vir_js "browser.canvas2d.moveTo"]
private opaque moveToJs
    (ctx : @& Lean.Vir.Js CanvasRenderingContext2D)
    (x y : @& Lean.Vir.Js Float) : DomM Unit

def moveTo (ctx : @& Lean.Vir.Js CanvasRenderingContext2D) (x y : Float) : DomM Unit :=
  withFloat x fun x => withFloat y fun y => moveToJs ctx x y

@[vir_js "browser.canvas2d.lineTo"]
private opaque lineToJs
    (ctx : @& Lean.Vir.Js CanvasRenderingContext2D)
    (x y : @& Lean.Vir.Js Float) : DomM Unit

def lineTo (ctx : @& Lean.Vir.Js CanvasRenderingContext2D) (x y : Float) : DomM Unit :=
  withFloat x fun x => withFloat y fun y => lineToJs ctx x y

@[vir_js "browser.canvas2d.arc"]
private opaque arcJs
    (ctx : @& Lean.Vir.Js CanvasRenderingContext2D)
    (x y radius startAngle endAngle : @& Lean.Vir.Js Float) : DomM Unit

def arc
    (ctx : @& Lean.Vir.Js CanvasRenderingContext2D)
    (x y radius startAngle endAngle : Float) : DomM Unit :=
  withFloat x fun x => withFloat y fun y => withFloat radius fun radius =>
  withFloat startAngle fun startAngle => withFloat endAngle fun endAngle =>
  arcJs ctx x y radius startAngle endAngle

@[vir_js "browser.canvas2d.fill"]
opaque fill (ctx : @& Lean.Vir.Js CanvasRenderingContext2D) : DomM Unit

@[vir_js "browser.canvas2d.stroke"]
opaque stroke (ctx : @& Lean.Vir.Js CanvasRenderingContext2D) : DomM Unit

@[vir_js "browser.canvas2d.setFillStyle"]
private opaque setFillStyleJs
    (ctx : @& Lean.Vir.Js CanvasRenderingContext2D)
    (style : @& Lean.Vir.Js String) : DomM Unit

def setFillStyle
    (ctx : @& Lean.Vir.Js CanvasRenderingContext2D) (style : @& String) : DomM Unit := do
  setFillStyleJs ctx (← Lean.Vir.JsValue.ofString style)

@[vir_js "browser.canvas2d.setStrokeStyle"]
private opaque setStrokeStyleJs
    (ctx : @& Lean.Vir.Js CanvasRenderingContext2D)
    (style : @& Lean.Vir.Js String) : DomM Unit

def setStrokeStyle
    (ctx : @& Lean.Vir.Js CanvasRenderingContext2D) (style : @& String) : DomM Unit := do
  setStrokeStyleJs ctx (← Lean.Vir.JsValue.ofString style)

@[vir_js "browser.canvas2d.setLineWidth"]
private opaque setLineWidthJs
    (ctx : @& Lean.Vir.Js CanvasRenderingContext2D)
    (width : @& Lean.Vir.Js Float) : DomM Unit

def setLineWidth
    (ctx : @& Lean.Vir.Js CanvasRenderingContext2D) (width : Float) : DomM Unit :=
  withFloat width fun width => setLineWidthJs ctx width

@[vir_js "browser.canvas2d.save"]
opaque save (ctx : @& Lean.Vir.Js CanvasRenderingContext2D) : DomM Unit

@[vir_js "browser.canvas2d.restore"]
opaque restore (ctx : @& Lean.Vir.Js CanvasRenderingContext2D) : DomM Unit

@[vir_js "browser.canvas2d.translate"]
private opaque translateJs
    (ctx : @& Lean.Vir.Js CanvasRenderingContext2D)
    (x y : @& Lean.Vir.Js Float) : DomM Unit

def translate (ctx : @& Lean.Vir.Js CanvasRenderingContext2D) (x y : Float) : DomM Unit :=
  withFloat x fun x => withFloat y fun y => translateJs ctx x y

@[vir_js "browser.canvas2d.rotate"]
private opaque rotateJs
    (ctx : @& Lean.Vir.Js CanvasRenderingContext2D)
    (angle : @& Lean.Vir.Js Float) : DomM Unit

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
  match ← currentTarget event with
  | some element => HTMLInputElement.fromElement element
  | none =>
      match ← target event with
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
  | some input => some <$> HTMLInputElement.getValue input

/--
Returns the current value for a form-control event.

This checks `currentTarget` first, then falls back to `target`. In a browser it
returns `some value` for `HTMLInputElement`, `HTMLTextAreaElement`, and
`HTMLSelectElement` targets, and `none` for other elements.
-/
@[vir_js "browser.event.formValue"]
private opaque formValueNullable (event : @& Lean.Vir.Js Event) :
    DomM (Lean.Vir.Js.Nullable String)

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
  | some input => some <$> HTMLInputElement.getChecked input

end Event

namespace Timer

/--
Runs `callback` once after `delayMs` milliseconds.

The host releases the retained callback after it fires or when the timeout is
cleared.

Reference: [MDN `setTimeout`](https://developer.mozilla.org/en-US/docs/Web/API/setTimeout).
-/
@[vir_js "browser.timer.setTimeout"]
private opaque setTimeoutJs
    (delayMs : @& Lean.Vir.Js Nat)
    (callback : DomM Unit) :
    DomM (Lean.Vir.Js Timeout)

def setTimeout (delayMs : UInt32) (callback : DomM Unit) : DomM (Lean.Vir.Js Timeout) := do
  let jsDelay ← Lean.Vir.JsValue.ofNat delayMs.toNat
  setTimeoutJs jsDelay callback

/--
Cancels a pending timeout and releases its retained callback.

Reference: [MDN `clearTimeout`](https://developer.mozilla.org/en-US/docs/Web/API/clearTimeout).
-/
@[vir_js "browser.timer.clearTimeout"]
opaque clearTimeout (timeout : @& Lean.Vir.Js Timeout) : DomM Unit

/--
Runs `callback` every `delayMs` milliseconds until cleared.

The host retains the callback until `clearInterval` is called or the runtime is
disposed.

Reference: [MDN `setInterval`](https://developer.mozilla.org/en-US/docs/Web/API/setInterval).
-/
@[vir_js "browser.timer.setInterval"]
private opaque setIntervalJs
    (delayMs : @& Lean.Vir.Js Nat)
    (callback : DomM Unit) :
    DomM (Lean.Vir.Js Interval)

def setInterval (delayMs : UInt32) (callback : DomM Unit) : DomM (Lean.Vir.Js Interval) := do
  let jsDelay ← Lean.Vir.JsValue.ofNat delayMs.toNat
  setIntervalJs jsDelay callback

/--
Cancels a pending interval and releases its retained callback.

Reference: [MDN `clearInterval`](https://developer.mozilla.org/en-US/docs/Web/API/clearInterval).
-/
@[vir_js "browser.timer.clearInterval"]
opaque clearInterval (interval : @& Lean.Vir.Js Interval) : DomM Unit

end Timer

namespace Animation

/--
Runs `callback` at the next animation frame.

The callback receives the browser frame timestamp. The host releases the
retained callback after it fires or when the frame is cancelled.

Reference: [MDN `requestAnimationFrame`](https://developer.mozilla.org/en-US/docs/Web/API/window/requestAnimationFrame).
-/
@[vir_js "browser.animation.requestAnimationFrame"]
private opaque requestAnimationFrameJs
    (callback : Lean.Vir.Js Float → DomM Unit) :
    DomM (Lean.Vir.Js AnimationFrame)

def requestAnimationFrame (callback : Float → DomM Unit) : DomM (Lean.Vir.Js AnimationFrame) :=
  requestAnimationFrameJs fun timestamp => do
    let value ← Lean.Vir.JsValue.toFloat timestamp
    callback value

/--
Cancels a pending animation frame and releases its retained callback.

Reference: [MDN `cancelAnimationFrame`](https://developer.mozilla.org/en-US/docs/Web/API/window/cancelAnimationFrame).
-/
@[vir_js "browser.animation.cancelAnimationFrame"]
opaque cancelAnimationFrame (frame : @& Lean.Vir.Js AnimationFrame) : DomM Unit

end Animation

end Lean.Vir.Browser
