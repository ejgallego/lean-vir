import Lake
open Lake DSL

package lean_vir where
  releaseRepo := "https://github.com/ejgallego/lean-vir"

@[default_target]
lean_lib LeanVir where
  globs := #[.andSubmodules `LeanVir]

lean_exe vir_irpkg where
  root := `tools.GeneratePackage
  supportInterpreter := true

lean_exe vir_fetch_sdk where
  root := `tools.VirFetchSdk
  supportInterpreter := true
