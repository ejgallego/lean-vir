/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Lean.LabelAttribute

public section

/-!
# VIR package markers

These attributes select the declarations that a Lake `:vir` module facet
exports to JavaScript. Importing `Vir` also imports this module.
-/

/--
Marks a declaration as a JavaScript-callable export in a VIR package.

The declaration is available through `vir.call(...)`. It is not selected as a
startup hook unless it is marked `@[vir_startup]`.
-/
register_label_attr vir_export

/--
Marks a declaration as a VIR package startup hook.

Startup hooks are also JavaScript-callable exports and carry `startup: true` in
the package manifest. The browser host invokes them with
`vir.runStartupEntries()`. Package generation requires each hook to take no
JavaScript arguments and return `Unit`, possibly through a supported effect
such as `DomM`.
-/
register_label_attr vir_startup
