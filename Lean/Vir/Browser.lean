/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Lean.Vir.Common

namespace Lean.Vir.Browser

namespace Console

@[vir_js "browser.console.log"]
opaque log (message : @& String) : IO Unit

end Console

namespace Document

@[vir_js "browser.document.getTitle"]
opaque getTitle : IO String

@[vir_js "browser.document.setTitle"]
opaque setTitle (title : @& String) : IO Unit

end Document

end Lean.Vir.Browser
