import Lake
open Lake DSL

package lean_vir where
  releaseRepo := "https://github.com/ejgallego/lean-vir"

@[default_target]
lean_lib Vir where
  globs := #[.andSubmodules `Vir]

/-- Non-default, buildable sources used by the public VIR examples. -/
lean_lib VirExamples where
  srcDir := "examples"
  roots := #[`SlidesCanvas]

/-- Module-system fixtures for composable package-set regression tests. -/
lean_lib VirModuleFixtures where
  srcDir := "fixtures/module-set"
  globs := #[.andSubmodules `ModuleSetFixture]

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

private def virPackageSetComplete (descriptorPath : System.FilePath) : IO Bool := do
  if !(← descriptorPath.pathExists) then
    return false
  let .ok descriptor := Lean.Json.parse (← IO.FS.readFile descriptorPath)
    | return false
  let .ok packagesJson := descriptor.getObjVal? "packages"
    | return false
  let .ok packages := packagesJson.getArr?
    | return false
  let baseDir := descriptorPath.parent.getD "."
  for packageJson in packages do
    let .ok (.str path) := packageJson.getObjVal? "path"
      | return false
    if !(← (baseDir / path).pathExists) then
      return false
  return true

private def buildVirPackageSetFacet
    (mod : Module) : FetchM (Job System.FilePath) := do
  let generatorJob ← vir_irpkg.fetch
  let moduleJob ← mod.leanArts.fetch
  let importsJob ← mod.transImports.fetch
  let importArtsJob ← importsJob.bindM fun imports => do
    let jobs ← imports.mapM fun imported => imported.leanArts.fetch
    return Job.collectArray jobs "VIR imported module IR"
  let packagePath := virModuleOutput mod "module-sets" "irpkg"
  let reportPath := virModuleOutput mod "module-sets" "report.md"
  let descriptorPath := virModuleOutput mod "module-sets" "irpkg-set.json"
  let shardDir := virModuleOutput mod "module-sets" "parts"
  let driverPath := virModuleOutput mod "drivers" "lean"
  let moduleName := mod.name.toString
  generatorJob.bindM fun generator =>
    moduleJob.bindM fun artifacts =>
      importArtsJob.mapM fun _ => do
        addLeanTrace
        addTrace (← computeTrace generator)
        addPureTrace moduleName "VIR module"
        let packageSetComplete ← virPackageSetComplete descriptorPath
        if (← descriptorPath.pathExists) &&
            (!(← reportPath.pathExists) || !packageSetComplete) then
          IO.FS.removeFile descriptorPath
        buildFileUnlessUpToDate' descriptorPath do
          createParentDirs driverPath
          createParentDirs packagePath
          createParentDirs reportPath
          createParentDirs descriptorPath
          IO.FS.createDirAll shardDir
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
            ] ++ #[
              "--module-set-output", descriptorPath.toString, shardDir.toString, moduleName,
              mod.fileName "irpkg", shardDir.fileName.getD shardDir.toString
            ] ++ targetArgs
            env := ← getAugmentedEnv
          }
        return descriptorPath

/--
Build a composable VIR package set from the module's `@[vir_export]` and
`@[vir_startup]` declarations. Reached imported module IR is emitted into
dependency members and the root member owns the public interface manifest.
-/
module_facet vir (mod : Module) : System.FilePath :=
  buildVirPackageSetFacet mod

/--
Install and verify the matching VIR browser SDK under the package build
directory.
-/
package_facet virSdk (pkg : Package) : System.FilePath := do
  let fetcherJob ← vir_fetch_sdk.fetch
  let sdkDir := pkg.buildDir / "vir" / "sdk"
  let manifestPath := sdkDir / "lean-vir-artifact.json"
  let archive? ← IO.getEnv "VIR_SDK_ARCHIVE"
  let url? ← IO.getEnv "VIR_SDK_URL"
  let tag? ← IO.getEnv "VIR_SDK_TAG"
  let commit? ← IO.getEnv "VIR_SDK_COMMIT"
  let expectCommit? ← IO.getEnv "VIR_SDK_EXPECT_COMMIT"
  let repo? ← IO.getEnv "VIR_SDK_REPO"
  let sourceConfig := String.intercalate "\n" [
    s!"archive={archive?.getD ""}",
    s!"url={url?.getD ""}",
    s!"tag={tag?.getD ""}",
    s!"commit={commit?.getD ""}",
    s!"expectCommit={expectCommit?.getD ""}",
    s!"repo={repo?.getD ""}"
  ]
  fetcherJob.mapM fun fetcher => do
    addTrace (← computeTrace fetcher)
    addPureTrace virSdkVersion "VIR SDK version"
    addPureTrace sourceConfig "VIR SDK source"
    if let some archive := archive? then
      addTrace (← computeTrace (System.FilePath.mk archive))
    if ← manifestPath.pathExists then
      let verification ← IO.Process.output {
        cmd := fetcher.toString
        args := #["--verify-installed", sdkDir.toString, "--expect-version", virSdkVersion]
        env := ← getAugmentedEnv
      }
      if verification.exitCode != 0 then
        IO.FS.removeFile manifestPath
    buildFileUnlessUpToDate' (text := true) manifestPath do
      createParentDirs manifestPath
      proc {
        cmd := fetcher.toString
        args := #["--out", sdkDir.toString]
        env := ← getAugmentedEnv
      }
    return manifestPath
