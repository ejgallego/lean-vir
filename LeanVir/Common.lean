/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import LeanVir.Host

namespace Lean.Vir.Common

/--
Returns the supplied string through the JavaScript host.

This is a small cross-environment host import useful for smoke tests and custom
bindings. It runs only when packaged and executed by the VIR JavaScript runtime;
it is not a native Lean implementation.
-/
@[vir_js "common.echoString"]
opaque echoString (value : @& String) : String

/--
Adds two natural numbers through the JavaScript host.

The default JavaScript runtime binding uses `BigInt` and returns the exact
decimal result expected by Lean's `Nat` boundary.
-/
@[vir_js "common.addNat"]
opaque addNat (lhs rhs : Nat) : Nat

end Lean.Vir.Common
