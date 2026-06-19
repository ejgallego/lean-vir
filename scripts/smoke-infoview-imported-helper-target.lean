import Vir.Infoview.ImportedHelperSmoke

namespace SmokeInfoviewImportedHelperTarget

@[noinline] def before : String :=
  Lean.Vir.Infoview.ImportedHelperSmoke.labelBefore ()

@[noinline] def after : String :=
  Lean.Vir.Infoview.ImportedHelperSmoke.labelAfter ()

end SmokeInfoviewImportedHelperTarget
