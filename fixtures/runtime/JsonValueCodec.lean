/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module
public import JsonRpcFoo
public import Vir.Infoview.JsonRpc
public section

namespace JsonValueCodec
open Lean Lean.Vir JsonRpcFixture

def copy (value : Js.Any) : RuntimeM (Except String Js.Any) := do
  match ← JsonValue.fromJs value with
  | .error error => return .error error
  | .ok json => JsonValue.toJs json

def sampleWire : RuntimeM (Except String Js.Any) := JsonValue.encodeJs sample

def roundtripFoo (value : Js.Any) : RuntimeM (Except String Js.Any) := do
  match ← JsonValue.decodeJs (α := Foo) value with
  | .error error => return .error error
  | .ok foo => JsonValue.encodeJs foo

def integerWire (mantissa : Int) (exponent : Nat) : RuntimeM (Except String Js.Any) :=
  JsonValue.toJs (.num ⟨mantissa, exponent⟩)

def leanHandle : RuntimeM (JSL Nat) := LeanRef.toJSL 42

def call (session : Js Infoview.RpcSession) (method : Js String) (title : String)
    (options : Js Infoview.ClientRequestOptions) (count : Nat) :
    RuntimeM (Except String (Js.Promise (LeanRef.Handle (Except String Foo)))) :=
  Infoview.JsonRpc.callValue session method
    { sample with title, primary := { sample.primary with count } } (some options)

def resultSummary (value : JSL (Except String Foo)) : RuntimeM (Except String String) := do
  match ← LeanRef.fromJSL value with
  | .error error => return .error error
  | .ok foo =>
    if foo.primary.label != sample.primary.label || foo.primary.enabled != sample.primary.enabled ||
        foo.rows != sample.rows || foo.selected != sample.selected then
      return .error "shared Foo fields changed in transit"
    return .ok s!"{foo.title}:{foo.primary.count}:{foo.rows.size}"

end JsonValueCodec
