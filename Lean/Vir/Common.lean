/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Lean.Vir.Host

namespace Lean.Vir.Common

@[vir_js "common.echoString"]
opaque echoString (value : @& String) : String

@[vir_js "common.addNat"]
opaque addNat (lhs rhs : Nat) : Nat

end Lean.Vir.Common
