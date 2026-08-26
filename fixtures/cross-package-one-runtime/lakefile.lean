import Lake

open Lake DSL

package «cross-package-app»

require lean_vir from "../.."
require «cross-package-contribution» from "dep"

@[default_target]
lean_lib CrossPackageApp where
  roots := #[`App.Root]
