/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.React

namespace InfoviewFixtures.PrivateHost

open Lean.Vir Lean.Vir.React

-- Exercise private imported host metadata independently of the public React API.
@[vir_js "react.useEffect"]
private opaque effect (setup : @& Js EffectCallback)
    (deps : @& Js.UndefinedOr DependencyList) : ReactM Unit

public def call (setup : Js EffectCallback) (deps : Js DependencyList) : ReactM Unit := do
  effect setup (← Js.UndefinedOr.undefined)
  effect setup (Js.UndefinedOr.ofJs deps)

end InfoviewFixtures.PrivateHost
