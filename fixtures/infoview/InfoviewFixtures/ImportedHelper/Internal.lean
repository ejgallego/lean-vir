/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

namespace InfoviewFixtures.ImportedHelper.Internal

private initialize beforeText : String ← pure "imported helper before"

@[noinline] public def labelBefore (_ : Unit) : String :=
  beforeText

@[noinline] public def labelAfter (_ : Unit) : String :=
  "imported helper after"

end InfoviewFixtures.ImportedHelper.Internal
