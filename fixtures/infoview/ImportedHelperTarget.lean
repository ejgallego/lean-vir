module

public import InfoviewFixtures.ImportedHelper

namespace SmokeInfoviewImportedHelperTarget

@[noinline] public def before : String :=
  InfoviewFixtures.ImportedHelper.labelBefore ()

@[noinline] public def after : String :=
  InfoviewFixtures.ImportedHelper.labelAfter ()

end SmokeInfoviewImportedHelperTarget
