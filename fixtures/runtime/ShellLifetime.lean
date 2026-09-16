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
open scoped Lean.Vir.Js

-- Test-only host observations. The state and stale branch live in Lean.
@[vir_js "test.shell.label"]
opaque labelJs : RuntimeM (Js String)

@[vir_js "test.shell.record"]
opaque recordJs (event : Js String) : RuntimeM Unit

def record (event : String) : RuntimeM Unit := do
  recordJs (← JsValue.ofString event)

@[vir_js "test.shell.context"]
opaque context : RuntimeM Unit

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
  let token ← Timer.setTimeout (record ("timer:" ++ owner)) (← JsValue.ofFloat 60000)
  Timer.clearTimeout token
  record ("scheduled:" ++ owner)

def createComponent : RuntimeM (FunctionComponent Lean.Vir.Infoview.PanelWidgetProps) := do
  let owner ← JsValue.toString (← labelJs)
  let stale ← RuntimeRef.new false
  capture (← Js.Function.ofLeanVoid (continuation stale owner "success"))
    (← Js.Function.ofLeanVoid (continuation stale owner "failure"))
    (← EventListener.ofLean (schedule owner)) (← LeanRef.toJSL owner)
  FunctionComponent.ofLean fun _ => do
    context
    let effect ← Js.Function.ofLean0 do
      record ("setup:" ++ owner)
      let cleanup ← Js.Function.ofLean0Void do
        stale.set true
        record ("cleanup:" ++ owner)
      pure (Js.UndefinedOr.ofJs cleanup)
    Hooks.useEffect effect (Js.UndefinedOr.ofJs (← js#[]))
    Node.createElement (← ElementType.tag (← JsValue.ofString "span"))
      (← Js.Object.empty) (← Js.Array.ofArray #[← Node.text (← JsValue.ofString owner)])

end Vir.Fixtures.ShellLifetime
