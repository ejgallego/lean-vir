/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

import InfoviewFixtures.ImportedHelper.Internal

namespace InfoviewFixtures.ImportedHelper

@[noinline] public def labelBefore (_ : Unit) : String :=
  Internal.labelBefore ()

@[noinline] public def labelAfter (_ : Unit) : String :=
  Internal.labelAfter ()

end InfoviewFixtures.ImportedHelper
