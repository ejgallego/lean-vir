/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.Browser

public section

namespace HostInterop

open Lean.Vir.Browser (DomM)

/-- Set the browser title and read its exact JavaScript value back. -/
def titleHandshake (label : String) : DomM String := do
  let title := "Lean VIR host: " ++ label
  Lean.Vir.Browser.Document.setTitle
    (← Lean.Vir.Browser.Document.current) (← Lean.Vir.JsValue.ofString title)
  Lean.Vir.JsValue.toString
    (← Lean.Vir.Browser.Document.getTitle (← Lean.Vir.Browser.Document.current))

end HostInterop
