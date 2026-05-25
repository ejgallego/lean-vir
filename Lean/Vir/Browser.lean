/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Lean.Vir.Common

namespace Lean.Vir.Browser

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
Reads an element's text content by CSS selector through the JavaScript host.

In a browser this reads `document.querySelector(selector)?.textContent` and
returns the empty string when the selector does not match. In Node tests, use
the `lean-vir/vir-runtime-node` wrapper for virtual document state.

Reference: [MDN `Document.querySelector`](https://developer.mozilla.org/en-US/docs/Web/API/Document/querySelector)
and [MDN `Node.textContent`](https://developer.mozilla.org/en-US/docs/Web/API/Node/textContent).
-/
@[vir_js "browser.document.getTextContent"]
opaque getTextContent (selector : @& String) : IO String

/--
Sets an element's text content by CSS selector through the JavaScript host.

In a browser this writes `document.querySelector(selector).textContent` when the
selector matches. In Node tests, use the `lean-vir/vir-runtime-node` wrapper
for virtual document state.

Reference: [MDN `Document.querySelector`](https://developer.mozilla.org/en-US/docs/Web/API/Document/querySelector)
and [MDN `Node.textContent`](https://developer.mozilla.org/en-US/docs/Web/API/Node/textContent).
-/
@[vir_js "browser.document.setTextContent"]
opaque setTextContent (selector text : @& String) : IO Unit

/--
Reads an element attribute by CSS selector through the JavaScript host.

In a browser this calls `getAttribute` on the first matching element. The result
is `none` when the selector does not match or the attribute is absent. In Node
tests, use the `lean-vir/vir-runtime-node` wrapper for virtual document state.

Reference: [MDN `Element.getAttribute`](https://developer.mozilla.org/en-US/docs/Web/API/Element/getAttribute).
-/
@[vir_js "browser.document.getAttribute"]
opaque getAttribute (selector name : @& String) : IO (Option String)

/--
Sets an element attribute by CSS selector through the JavaScript host.

In a browser this calls `setAttribute` on the first matching element when the
selector matches. In Node tests, use the `lean-vir/vir-runtime-node` wrapper
for virtual document state.

Reference: [MDN `Element.setAttribute`](https://developer.mozilla.org/en-US/docs/Web/API/Element/setAttribute).
-/
@[vir_js "browser.document.setAttribute"]
opaque setAttribute (selector name value : @& String) : IO Unit

/--
Reads the `checked` property of a checkbox or radio input by CSS selector
through the JavaScript host.

In a browser this reads `document.querySelector(selector)?.checked === true`.
In Node tests, use the `lean-vir/vir-runtime-node` wrapper for virtual document
state.

Reference: [MDN `HTMLInputElement.checked`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/checked).
-/
@[vir_js "browser.document.getChecked"]
opaque getChecked (selector : @& String) : IO Bool

/--
Sets the `checked` property of a checkbox or radio input by CSS selector through
the JavaScript host.

In a browser this writes `document.querySelector(selector).checked` when the
selector matches. In Node tests, use the `lean-vir/vir-runtime-node` wrapper for
virtual document state.

Reference: [MDN `HTMLInputElement.checked`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/checked).
-/
@[vir_js "browser.document.setChecked"]
opaque setChecked (selector : @& String) (checked : Bool) : IO Unit

end Document

end Lean.Vir.Browser
