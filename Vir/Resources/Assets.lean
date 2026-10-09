/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/
module

public import Vir.Resources.Runtime

/-! The ordinary application include: Lake prepares each program, and this
elaborator embeds it with the library-owned runtime. No build or acquisition
occurs during elaboration. Runtime imports Embed, never the reverse. -/

namespace Vir.Resources
open Lean Elab Term

meta section

/-- Include prepared programs in the given semantic module-name order. The asset
library must declare each +Module:virResourcePack in its ordinary Lake needs. -/
elab "include_vir_assets" "(" "modules" ":=" "#[" modules:ident,* "]" ")" : term => do
  let searchPath ← searchPathRef.get
  let programs ← modules.getElems.mapM fun id => do
    let name := id.getId
    let path? ← searchPath.findSomeM? fun root => do
      let path := modToFilePath (root / "vir-assets") name "virres"
      return if ← path.pathExists then some path else none
    let some path := path?
      | throwError "VIR_RESOURCE_NOT_PREPARED: {name}; declare +{name}:virResourcePack in the asset library's needs and build it"
    embedPrepared path
  return mkApp2 (mkConst ``ResourceSet.mk) (mkConst ``Runtime.bundle)
    (← Meta.mkArrayLit (mkConst ``Bundle) programs.toList)

end
end Vir.Resources
