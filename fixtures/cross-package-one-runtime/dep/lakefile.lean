import Lake

open Lake DSL

package «cross-package-contribution»

require lean_vir from "../../.."

@[default_target]
lean_lib CrossPackageContribution where
  roots := #[`Dep.Contribution]
