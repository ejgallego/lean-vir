/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.Browser
public import Vir.Infoview.Surface.Generated
import all Vir.Infoview.Surface.Generated

public section

namespace Lean.Vir.Infoview

/-- The upstream hook. Omitted dependencies and an empty JS array remain distinct. -/
def useClientNotificationEffect {params : Type}
    (method : @& Js String)
    (callback : @& Js.Function1 (Js params) Unit)
    (dependencies : Option (Js React.DependencyList) := none) : React.ReactM Unit :=
  match dependencies with
  | none => useClientNotificationEffectWithoutDeps method callback
  | some deps => useClientNotificationEffectWithDeps method callback deps

end Lean.Vir.Infoview
