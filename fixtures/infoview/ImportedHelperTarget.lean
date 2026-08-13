import InfoviewFixtures.ImportedHelper

namespace SmokeInfoviewImportedHelperTarget

@[noinline] def before : String :=
  InfoviewFixtures.ImportedHelper.labelBefore ()

@[noinline] def after : String :=
  InfoviewFixtures.ImportedHelper.labelAfter ()

end SmokeInfoviewImportedHelperTarget
