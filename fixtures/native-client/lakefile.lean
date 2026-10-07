import Lake
open Lake DSL

require lean_vir from "../.."

package native_client where
  precompileModules := true

lean_lib NativeClient

@[default_target]
lean_exe native_client where
  root := `Main
