/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import LeanVir.Common

namespace Lean.Vir.Browser

/--
Opaque browser DOM element handle.

Lean code receives element values from `Document.querySelector` and passes them
to `Element` or more-specific element APIs. The current `wasm32-wasip1`
runtime represents this as a private resource handle; Lean programs should not
construct or persist assumptions about the handle representation.

Reference: [MDN `Element`](https://developer.mozilla.org/en-US/docs/Web/API/Element).
-/
@[vir_resource "Element"]
opaque Element : Type

/--
Opaque browser event handle.

The v1 listener API passes event values to exported Lean entrypoints as private
resources. The event resource is only valid for the duration of that listener
callback.

Reference: [MDN `Event`](https://developer.mozilla.org/en-US/docs/Web/API/Event).
-/
@[vir_resource "Event"]
opaque Event : Type

/--
Opaque browser event listener registration handle.

`Element.addEventListener` returns listener handles so Lean code can remove the
registered listener later with `Element.removeEventListener`.

Reference: [MDN `EventTarget.addEventListener`](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener).
-/
@[vir_resource "EventListener"]
opaque EventListener : Type

/--
Opaque browser `HTMLInputElement` handle.

Use `HTMLInputElement.fromElement` to narrow an `Element` before reading or
writing input-specific DOM properties.

Reference: [MDN `HTMLInputElement`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement).
-/
@[vir_resource "HTMLInputElement"]
opaque HTMLInputElement : Type

/--
Opaque browser timeout handle returned by `setTimeout`.

The JavaScript host owns the timer registration and the retained Lean callback
until the timer fires, is cleared, or the runtime is disposed.
-/
@[vir_resource "Timeout"]
opaque Timeout : Type

/--
Opaque browser animation-frame handle returned by `requestAnimationFrame`.

The JavaScript host owns the frame registration and the retained Lean callback
until the frame fires, is cancelled, or the runtime is disposed.
-/
@[vir_resource "AnimationFrame"]
opaque AnimationFrame : Type

namespace Event

/--
Returns the event target as a DOM element when the target is an element.

The returned element resource may be used after the callback, but the event
resource itself remains callback-scoped.

Reference: [MDN `Event.target`](https://developer.mozilla.org/en-US/docs/Web/API/Event/target).
-/
@[vir_js "browser.event.target"]
opaque target (event : @& Event) : IO (Option Element)

/--
Returns the current event target as a DOM element when the current target is an
element.

The returned element resource may be used after the callback, but the event
resource itself remains callback-scoped.

Reference: [MDN `Event.currentTarget`](https://developer.mozilla.org/en-US/docs/Web/API/Event/currentTarget).
-/
@[vir_js "browser.event.currentTarget"]
opaque currentTarget (event : @& Event) : IO (Option Element)

/--
Prevents the default action for this event when the underlying browser event is
cancelable.

Reference: [MDN `Event.preventDefault`](https://developer.mozilla.org/en-US/docs/Web/API/Event/preventDefault).
-/
@[vir_js "browser.event.preventDefault"]
opaque preventDefault (event : @& Event) : IO Unit

/--
Stops propagation of this event to further listeners.

Reference: [MDN `Event.stopPropagation`](https://developer.mozilla.org/en-US/docs/Web/API/Event/stopPropagation).
-/
@[vir_js "browser.event.stopPropagation"]
opaque stopPropagation (event : @& Event) : IO Unit

end Event

namespace Console

/--
Logs a message through the JavaScript host's console binding.

The default browser/runtime binding calls `console.log`. The host call is
synchronous and returns `Unit`.

Reference: [MDN `console.log`](https://developer.mozilla.org/en-US/docs/Web/API/console/log_static).
-/
@[vir_js "browser.console.log"]
opaque log (message : @& String) : IO Unit

end Console

namespace Document

/--
Reads the current document title through the JavaScript host.

In a browser this returns `document.title`. In Node tests, use the
`lean-vir/vir-runtime-node` wrapper for virtual document state.

Reference: [MDN `Document.title`](https://developer.mozilla.org/en-US/docs/Web/API/Document/title).
-/
@[vir_js "browser.document.getTitle"]
opaque getTitle : IO String

/--
Sets the current document title through the JavaScript host.

In a browser this writes `document.title`. In Node tests, use the
`lean-vir/vir-runtime-node` wrapper for virtual document state.

Reference: [MDN `Document.title`](https://developer.mozilla.org/en-US/docs/Web/API/Document/title).
-/
@[vir_js "browser.document.setTitle"]
opaque setTitle (title : @& String) : IO Unit

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
opaque querySelector (selector : @& String) : IO (Option Element)

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
opaque getTextContent (element : @& Element) : IO String

/--
Sets an element's text content through the JavaScript host.

In a browser this writes `element.textContent`. In Node tests, use the
`lean-vir/vir-runtime-node` wrapper for virtual document state.

Reference: [MDN `Node.textContent`](https://developer.mozilla.org/en-US/docs/Web/API/Node/textContent).
-/
@[vir_js "browser.element.setTextContent"]
opaque setTextContent (element : @& Element) (text : @& String) : IO Unit

/--
Reads an element attribute through the JavaScript host.

In a browser this calls `element.getAttribute(name)`. The result is `none` when
the attribute is absent. In Node tests, use the `lean-vir/vir-runtime-node`
wrapper for virtual document state.

Reference: [MDN `Element.getAttribute`](https://developer.mozilla.org/en-US/docs/Web/API/Element/getAttribute).
-/
@[vir_js "browser.element.getAttribute"]
opaque getAttribute (element : @& Element) (name : @& String) : IO (Option String)

/--
Sets an element attribute through the JavaScript host.

In a browser this calls `element.setAttribute(name, value)`. In Node tests, use
the `lean-vir/vir-runtime-node` wrapper for virtual document state.

Reference: [MDN `Element.setAttribute`](https://developer.mozilla.org/en-US/docs/Web/API/Element/setAttribute).
-/
@[vir_js "browser.element.setAttribute"]
opaque setAttribute (element : @& Element) (name value : @& String) : IO Unit

/--
Registers a browser event listener backed by a Lean callback closure.

The host retains the callback until `Element.removeEventListener` is called or
the owning runtime is disposed. The callback receives an opaque event resource
that is valid only during that event dispatch.

Reference: [MDN `EventTarget.addEventListener`](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener).
-/
@[vir_js "browser.element.addEventListener"]
opaque addEventListener
    (element : @& Element) (event : @& String) (callback : Event → IO Unit) :
    IO EventListener

/--
Removes a listener previously registered by `Element.addEventListener`.

Reference: [MDN `EventTarget.removeEventListener`](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/removeEventListener).
-/
@[vir_js "browser.element.removeEventListener"]
opaque removeEventListener (listener : @& EventListener) : IO Unit

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
opaque fromElement (element : @& Element) : IO (Option HTMLInputElement)

/--
Reads the `checked` property of a checkbox or radio input.

In a browser this reads `input.checked`. In Node tests, use the
`lean-vir/vir-runtime-node` wrapper for virtual document state.

Reference: [MDN `HTMLInputElement.checked`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/checked).
-/
@[vir_js "browser.htmlInputElement.getChecked"]
opaque getChecked (input : @& HTMLInputElement) : IO Bool

/--
Sets the `checked` property of a checkbox or radio input.

In a browser this writes `input.checked`. In Node tests, use the
`lean-vir/vir-runtime-node` wrapper for virtual document state.

Reference: [MDN `HTMLInputElement.checked`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/checked).
-/
@[vir_js "browser.htmlInputElement.setChecked"]
opaque setChecked (input : @& HTMLInputElement) (checked : Bool) : IO Unit

/--
Reads the `value` property of an input element.

In a browser this reads `input.value`. In Node tests, use the
`lean-vir/vir-runtime-node` wrapper for virtual document state.

Reference: [MDN `HTMLInputElement.value`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/value).
-/
@[vir_js "browser.htmlInputElement.getValue"]
opaque getValue (input : @& HTMLInputElement) : IO String

/--
Sets the `value` property of an input element.

In a browser this writes `input.value`. In Node tests, use the
`lean-vir/vir-runtime-node` wrapper for virtual document state.

Reference: [MDN `HTMLInputElement.value`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/value).
-/
@[vir_js "browser.htmlInputElement.setValue"]
opaque setValue (input : @& HTMLInputElement) (value : @& String) : IO Unit

end HTMLInputElement

namespace Event

/--
Returns the current input element for an input-like event.

This checks `currentTarget` first, then falls back to `target`, and narrows the
element with `HTMLInputElement.fromElement`.
-/
def inputElement? (event : @& Event) : IO (Option HTMLInputElement) := do
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
def inputValue? (event : @& Event) : IO (Option String) := do
  match ← inputElement? event with
  | none => pure none
  | some input => some <$> HTMLInputElement.getValue input

/--
Returns the current checked state for an input-like event.

This is the usual helper for controlled checkbox/radio handlers. It checks
`currentTarget` before `target`.
-/
def inputChecked? (event : @& Event) : IO (Option Bool) := do
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
opaque setTimeout (delayMs : UInt32) (callback : IO Unit) : IO Timeout

/--
Cancels a pending timeout and releases its retained callback.

Reference: [MDN `clearTimeout`](https://developer.mozilla.org/en-US/docs/Web/API/clearTimeout).
-/
@[vir_js "browser.timer.clearTimeout"]
opaque clearTimeout (timeout : @& Timeout) : IO Unit

end Timer

namespace Animation

/--
Runs `callback` at the next animation frame.

The callback receives the browser frame timestamp. The host releases the
retained callback after it fires or when the frame is cancelled.

Reference: [MDN `requestAnimationFrame`](https://developer.mozilla.org/en-US/docs/Web/API/window/requestAnimationFrame).
-/
@[vir_js "browser.animation.requestAnimationFrame"]
opaque requestAnimationFrame (callback : Float → IO Unit) : IO AnimationFrame

/--
Cancels a pending animation frame and releases its retained callback.

Reference: [MDN `cancelAnimationFrame`](https://developer.mozilla.org/en-US/docs/Web/API/window/cancelAnimationFrame).
-/
@[vir_js "browser.animation.cancelAnimationFrame"]
opaque cancelAnimationFrame (frame : @& AnimationFrame) : IO Unit

end Animation

end Lean.Vir.Browser
