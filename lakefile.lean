import Lake
open Lake DSL

package lean_vir where
  releaseRepo := "https://github.com/ejgallego/lean-vir"

@[default_target]
lean_lib Vir where
  globs := #[.andSubmodules `Vir]

lean_exe vir_irpkg where
  root := `tools.GeneratePackage
  supportInterpreter := true

lean_exe vir_fetch_sdk where
  root := `tools.VirFetchSdk
  supportInterpreter := true

lean_exe vir_native_wrappers where
  root := `tools.GenerateNativeWrappers
  supportInterpreter := true

private def virModuleOutput (mod : Module) (kind ext : String) : System.FilePath :=
  mod.filePath (mod.pkg.buildDir / "vir" / kind) ext

private def virSdkVersion : String := "0.1.0"

/-- Build a marked VIR package for one compiled Lean module. -/
module_facet vir (mod : Module) : System.FilePath := do
  let generatorJob ← vir_irpkg.fetch
  let moduleJob ← mod.leanArts.fetch
  let packagePath := virModuleOutput mod "modules" "irpkg"
  let reportPath := virModuleOutput mod "reports" "report.md"
  let driverPath := virModuleOutput mod "drivers" "lean"
  let moduleName := mod.name.toString
  generatorJob.bindM fun generator =>
    moduleJob.mapM fun artifacts => do
      addLeanTrace
      addTrace (← computeTrace generator)
      addPureTrace moduleName "VIR module"
      buildFileUnlessUpToDate' packagePath do
        createParentDirs driverPath
        createParentDirs packagePath
        createParentDirs reportPath
        let sourcePath ←
          if artifacts.ir?.isSome then
            IO.FS.writeFile driverPath s!"module\nimport all {moduleName}\n"
            pure driverPath
          else
            pure mod.leanFile
        let targetArgs :=
          if artifacts.ir?.isSome then
            #["--target-marked-module", sourcePath.toString, moduleName]
          else
            #["--target-marked", sourcePath.toString]
        proc {
          cmd := generator.toString
          args := #[
            packagePath.toString,
            reportPath.toString
          ] ++ targetArgs
          env := ← getAugmentedEnv
        }
      return packagePath

/-- Install the matching browser runtime SDK under the package build directory. -/
package_facet virSdk (pkg : Package) : System.FilePath := do
  let fetcherJob ← vir_fetch_sdk.fetch
  let sdkDir := pkg.buildDir / "vir" / "sdk"
  let manifestPath := sdkDir / "lean-vir-artifact.json"
  fetcherJob.mapM fun fetcher => do
    addTrace (← computeTrace fetcher)
    addPureTrace virSdkVersion "VIR SDK version"
    buildFileUnlessUpToDate' (text := true) manifestPath do
      createParentDirs manifestPath
      proc {
        cmd := fetcher.toString
        args := #["--out", sdkDir.toString]
        env := ← getAugmentedEnv
      }
    return manifestPath
