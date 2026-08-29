/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.Common.Generated

namespace Lean.Vir.Common

/--
Returns the supplied string through the JavaScript host.

This is a small cross-environment host import useful for smoke tests and custom
bindings. It runs only when packaged and executed by the VIR JavaScript runtime;
it is not a native Lean implementation.
-/
def echoString (value : @& String) : Lean.Vir.RuntimeM String := do
  let jsValue ← Lean.Vir.JsValue.ofString value
  let result ← echoStringJs jsValue
  Lean.Vir.JsValue.toString result

/--
Adds two natural numbers through the JavaScript host.

The public wrapper converts both operands to explicit `Js Nat` resources,
calls the JavaScript host, and converts the result back to Lean's `Nat`.
-/
def addNat (lhs rhs : Nat) : Lean.Vir.RuntimeM Nat := do
  let jsLhs ← Lean.Vir.JsValue.ofNat lhs
  let jsRhs ← Lean.Vir.JsValue.ofNat rhs
  let result ← addNatJs jsLhs jsRhs
  Lean.Vir.JsValue.toNat result

end Lean.Vir.Common
