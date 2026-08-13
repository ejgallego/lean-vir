/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

namespace InfoviewFixtures.ImportedHelper

@[noinline] def labelBefore (_ : Unit) : String :=
  "imported helper before"

@[noinline] def labelAfter (_ : Unit) : String :=
  "imported helper after"

end InfoviewFixtures.ImportedHelper
