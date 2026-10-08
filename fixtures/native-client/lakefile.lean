import Lake
open Lake DSL

require lean_vir from "../.."

package native_client where
  precompileModules := true

lean_lib NativeClient

lean_lib GeneratorClient

@[default_target]
lean_exe native_client where
  root := `Main

/-- Check producer module ownership through Lake's actual loaded configuration. -/
script checkOwners (args) do
  let some pkg ← findPackageByName? `lean_vir
    | throw <| IO.userError "missing VIR dependency"
  for spelling in args do
    let name := spelling.toName
    let owners := pkg.leanLibs.filter (·.isBuildableModule name)
    unless owners.size == 1 do
      throw <| IO.userError s!"{name}: expected one owner, got {owners.map (·.name)}"
    let some actual := pkg.findModule? name
      | throw <| IO.userError s!"unowned module: {name}"
    unless some actual.lib.name == owners[0]?.map (·.name) do
      throw <| IO.userError s!"owner lookup mismatch: {name}"
  IO.println s!"PASS {args.length} modules have one order-independent owner"
  return 0
