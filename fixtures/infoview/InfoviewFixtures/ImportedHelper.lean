/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

import InfoviewFixtures.ImportedHelper.Internal

namespace InfoviewFixtures.ImportedHelper

-- Use a runtime argument so arity reduction cannot replace these named helpers
-- with compiler-generated wrappers. The smoke checks their imported ownership.
@[noinline] public def labelBefore (suffix : String) : String :=
  Internal.labelBefore () ++ suffix

@[noinline] public def labelAfter (suffix : String) : String :=
  Internal.labelAfter () ++ suffix

end InfoviewFixtures.ImportedHelper
