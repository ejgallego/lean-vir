/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.Infoview

public section

namespace Vir.Fixtures.ShellLifetime

open Lean.Vir Lean.Vir.React Lean.Vir.Browser

-- Test-only host observations. The state and stale branch live in Lean.
@[vir_js "test.shell.label"]
opaque labelJs : RuntimeM (Js String)

@[vir_js "test.shell.record"]
opaque recordJs (event : Js String) : RuntimeM Unit

def record (event : String) : RuntimeM Unit := do
  recordJs (← JsValue.ofString event)

@[vir_js "test.shell.capture"]
opaque capture
    (success failure : Js.Function1 Js.Any Unit)
    (schedule : Js EventListener)
    (payload : JSL String) : RuntimeM Unit

def continuation (stale : RuntimeRef Bool) (owner kind : String) (_ : Js.Any) : RuntimeM Unit := do
  record ("body:" ++ kind ++ ":" ++ owner)
  if ← stale.get then
    record ("stale:" ++ kind ++ ":" ++ owner)
  else
    record ("mutation:" ++ kind ++ ":" ++ owner)

def schedule (owner : String) (_ : Js Event) : DomM Unit := do
  let token ← Timer.setTimeout 60000 (record ("timer:" ++ owner))
  Timer.clearTimeout token
  record ("scheduled:" ++ owner)

def createComponent : RuntimeM (Js (Component Lean.Vir.Infoview.Surface)) := do
  let owner ← JsValue.toString (← labelJs)
  let stale ← RuntimeRef.new false
  capture (← Js.Function.ofLeanVoid (continuation stale owner "success"))
    (← Js.Function.ofLeanVoid (continuation stale owner "failure"))
    (← EventListener.ofLean (schedule owner)) (← LeanRef.toJSL owner)
  Component.ofLean fun _ => do
    Hooks.useLeanEffectWithArrayDeps
      (do record ("setup:" ++ owner); JsValue.ofString owner)
      (fun _ => do stale.set true; record ("cleanup:" ++ owner))
      (#[] : Array (Js String))
    Node.spanText owner

def mount (root : Js Root) (component : Js (Component Lean.Vir.Infoview.Surface))
    (surface : Lean.Vir.Infoview.Surface) : DomM Unit :=
  Root.renderComponent root component surface

end Vir.Fixtures.ShellLifetime
