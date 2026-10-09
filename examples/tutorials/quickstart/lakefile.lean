import Lake
open Lake DSL

require lean_vir from git "https://github.com/ejgallego/lean-vir.git" @
  "aa465b873387a0bf46669031da1af99f59b0f3b9"

package quickstart

input_dir webSources where
  path := "web"
  text := true

lean_lib QuickstartProgram where
  roots := #[`QuickstartApp.Program]

lean_lib QuickstartResources where
  roots := #[`QuickstartApp.Resources]
  needs := #[`+QuickstartApp.Program:virResourcePack]

@[default_target]
lean_exe publish where
  root := `Main
  needs := #[webSources]
