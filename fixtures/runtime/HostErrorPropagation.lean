/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.Js

public section

namespace Vir.Fixtures.HostErrorPropagation

open Lean.Vir

@[vir_js "test.hostError.fail"]
opaque failHost : RuntimeM Unit

@[vir_js "test.hostError.record"]
opaque recordHost (callback : Js.Function1 Js.Any Unit) : RuntimeM Unit

@[vir_js "test.hostError.invoke"]
opaque invokeHost (callback : Js.Function1 Js.Any Unit) : RuntimeM Unit

def newCounter : RuntimeM (JSL (RuntimeRef Nat)) := do
  LeanRef.toJSL (← RuntimeRef.new 0)

def readCounter (counter : JSL (RuntimeRef Nat)) : RuntimeM Nat := do
  (← LeanRef.fromJSL counter).get

def failThenWork (counter : JSL (RuntimeRef Nat)) : RuntimeM Unit := do
  let ref ← LeanRef.fromJSL counter
  failHost
  ref.set 1
  let callback ← Js.Function.ofLeanVoid fun (_ : Js.Any) => ref.set 2
  recordHost callback

def failureCallback (counter : JSL (RuntimeRef Nat)) : RuntimeM (Js.Function1 Js.Any Unit) :=
  Js.Function.ofLeanVoid fun (_ : Js.Any) => failThenWork counter

def invoke (callback : Js.Function1 Js.Any Unit) : RuntimeM Unit :=
  invokeHost callback

end Vir.Fixtures.HostErrorPropagation
