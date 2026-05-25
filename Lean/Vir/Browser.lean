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

In a browser this returns `document.title`. In non-browser runtimes using the
default binding, it returns the runtime's virtual document title.

Reference: [MDN `Document.title`](https://developer.mozilla.org/en-US/docs/Web/API/Document/title).
-/
@[vir_js "browser.document.getTitle"]
opaque getTitle : IO String

/--
Sets the current document title through the JavaScript host.

In a browser this writes `document.title`. In non-browser runtimes using the
default binding, it updates the runtime's virtual document title.

Reference: [MDN `Document.title`](https://developer.mozilla.org/en-US/docs/Web/API/Document/title).
-/
@[vir_js "browser.document.setTitle"]
opaque setTitle (title : @& String) : IO Unit

end Document

end Lean.Vir.Browser
