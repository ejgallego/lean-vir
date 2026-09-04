/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

import ModuleSetFixture.InternalBase

namespace ModuleSetFixture.Facade

public initialize value : Nat ← pure (ModuleSetFixture.InternalBase.value + 1)

end ModuleSetFixture.Facade
