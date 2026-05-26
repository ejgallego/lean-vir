/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Lean.Vir.Common

namespace Lean.Vir.Browser

/--
Opaque browser DOM element handle.

Lean code receives element values from `Document.querySelector` and passes them
to `Element` or more-specific element APIs. The current `wasm32-wasip1`
runtime represents this as a private resource handle; Lean programs should not
construct or persist assumptions about the handle representation.

Reference: [MDN `Element`](https://developer.mozilla.org/en-US/docs/Web/API/Element).
-/
opaque Element : Type

/--
Opaque browser `HTMLInputElement` handle.

Use `HTMLInputElement.fromElement` to narrow an `Element` before reading or
writing input-specific DOM properties.

Reference: [MDN `HTMLInputElement`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement).
-/
opaque HTMLInputElement : Type

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
the `lean-vir/vir-runtime-node` wrapper for virtual document state.

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

end Lean.Vir.Browser
