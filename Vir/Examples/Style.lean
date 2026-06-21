/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.React

namespace Lean.Vir.Examples.Style

open Lean.Vir.React

def style (entries : Array (String × String)) : Property :=
  Property.stylePairs entries

def vscodeColor (name fallback : String) : String :=
  "var(--vscode-" ++ name ++ ", " ++ fallback ++ ")"

def border (color : String) : String :=
  "1px solid " ++ color

end Lean.Vir.Examples.Style
