/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module
public import JsonRpcFoo
public import Vir.Infoview.Surface
public import Vir.JsonValue
public import Vir.Js
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
    RuntimeM (Except String (Js.Promise Js.Any.Value)) := do
  let request := { sample with title, primary := { sample.primary with count } }
  match ← JsonValue.encodeJs request with
  | .error error => return .error error
  | .ok params => return .ok (← Infoview.RpcSession.callWithOptions session method params options)

/-- Decode and use Foo inside a Lean continuation; only its display text returns to JS. -/
def resultSummary : RuntimeM (Js.Function1 Js.Any (Js String)) :=
  Js.Function.ofLean fun value => do
    let text ← match ← JsonValue.decodeJs (α := Foo) value with
      | .error error => pure s!"error: {error}"
      | .ok foo =>
        if foo.primary.label != sample.primary.label || foo.primary.enabled != sample.primary.enabled ||
            foo.rows != sample.rows || foo.selected != sample.selected then
          pure "error: shared Foo fields changed in transit"
        else
          pure s!"{foo.title}:{foo.primary.count}:{foo.rows.size}"
    JsValue.ofString text

end JsonValueCodec
