/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Lean.LabelAttribute

public section

/-- Marks a declaration as a JavaScript-callable export in a VIR package. -/
register_label_attr vir_export

/--
Marks a declaration as a VIR package startup entrypoint.

Startup entrypoints are also exported. Package generation requires them to take
no JavaScript arguments and return `Unit` (possibly through a supported effect
such as `DomM`).
-/
register_label_attr vir_entry
