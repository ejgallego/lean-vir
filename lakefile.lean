import Lake
open Lake DSL

package lean_vir where
  releaseRepo := "https://github.com/ejgallego/lean-vir"

def npmCmd : String :=
  if System.Platform.isWindows then "npm.cmd" else "npm"

def runNpmScript (scriptName : String) : LogIO Unit :=
  proc {
    cmd := npmCmd
    args := #["run", "--silent", scriptName]
  }

input_dir infoviewBundleSources where
  path := "web/src"
  filter := .extension <| .mem #["js"]
  text := true

target infoviewBundle : System.FilePath := do
  let sources ← infoviewBundleSources.fetch
  let output := (← getRootPackage).dir / "build/generated/infoview/vir-infoview-widget.js"
  buildFileAfterDep (text := true) output sources (extraDepTrace := do
    let scriptTrace ← computeTrace (System.FilePath.mk "scripts/build-infoview-widget.mjs")
    let packageTrace ← computeTrace (System.FilePath.mk "package.json")
    let lockTrace ← computeTrace (System.FilePath.mk "package-lock.json")
    return mixTrace scriptTrace (mixTrace packageTrace lockTrace)) fun _ =>
    runNpmScript "build:infoview"

@[default_target]
lean_lib Vir where
  roots := #[`Vir]

/-- Optional Lean infoview integration and its generated JavaScript shell. -/
lean_lib VirInfoview where
  roots := #[`Vir.Infoview]
  needs := #[infoviewBundle]

/-- Non-default, buildable sources used by the public VIR examples. -/
lean_lib VirExamples where
  srcDir := "examples"
  roots := #[`SlidesCanvas]

/-- Module-system fixtures for composable package-set regression tests. -/
lean_lib VirModuleFixtures where
  srcDir := "fixtures/module-set"
  globs := #[.andSubmodules `ModuleSetFixture]

/-- Infoview-only regression fixtures kept outside the public library. -/
lean_lib VirInfoviewFixtures where
  srcDir := "fixtures/infoview"
  roots := #[`InfoviewFixtures.ImportedHelper]

lean_exe vir_irpkg where
  root := `tools.GeneratePackage
  supportInterpreter := true

lean_exe vir_fetch_sdk where
  root := `tools.VirFetchSdk
  supportInterpreter := true

lean_exe vir_native_wrappers where
  root := `tools.GenerateNativeWrappers
  supportInterpreter := true

lean_exe vir_surface where
  root := `tools.AnalyzeSurface
  supportInterpreter := true

lean_exe vir_js_inventory where
  root := `tools.ExportVirJsInventory
  supportInterpreter := true

private def virModuleOutput (mod : Module) (kind ext : String) : System.FilePath :=
  mod.filePath (mod.pkg.buildDir / "vir" / kind) ext

private def virSdkVersion : String := "0.1.0"

private def virPackageSetFormat : String := "lean-vir-ir-package-set"

private def virPackageSetVersion : Nat := 2

private def virJsonStringField? (json : Lean.Json) (field : String) : Option String :=
  match json.getObjVal? field with
  | .ok (.str value) => some value
  | _ => none

private def virJsonNatField? (json : Lean.Json) (field : String) : Option Nat :=
  match json.getObjVal? field >>= Lean.Json.getNat? with
  | .ok value => some value
  | .error _ => none

private def virSha256Files? (paths : Array System.FilePath) : IO (Option (Array String)) := do
  if paths.isEmpty then
    return some #[]
  try
    let out ← IO.Process.output {
      cmd := "sha256sum"
      args := #["--zero"] ++ paths.map (fun path => path.toString)
    }
    if out.exitCode != 0 then
      return none
    let records := out.stdout.split (· == '\u0000') |>.filter (fun record => !record.isEmpty)
    let hashes := records.toArray.map (fun record => (record.take 64).toString)
    if hashes.size == paths.size && hashes.all (fun hash =>
        hash.length == 64 && hash.toList.all ("0123456789abcdef".contains ·)) then
      return some hashes
    return none
  catch _ =>
    return none

private def virPackageSetComplete
    (descriptorPath : System.FilePath)
    (expectedRootModule expectedRootPath expectedShardDir : String) : IO Bool := do
  if !(← descriptorPath.pathExists) then
    return false
  let .ok descriptor := Lean.Json.parse (← IO.FS.readFile descriptorPath)
    | return false
  let some format := virJsonStringField? descriptor "format"
    | return false
  if format != virPackageSetFormat then
    return false
  let .ok versionJson := descriptor.getObjVal? "version"
    | return false
  let .ok version := versionJson.getNat?
    | return false
  if version != virPackageSetVersion then
    return false
  let .ok packagesJson := descriptor.getObjVal? "packages"
    | return false
  let .ok packages := packagesJson.getArr?
    | return false
  if packages.isEmpty then
    return false
  let baseDir := descriptorPath.parent.getD "."
  let mut modules : Array String := #[]
  let mut paths : Array String := #[]
  let mut memberPaths : Array System.FilePath := #[]
  let mut expectedHashes : Array String := #[]
  let mut index := 0
  for packageJson in packages do
    let some moduleName := virJsonStringField? packageJson "module"
      | return false
    if moduleName.trimAscii.toString.isEmpty || moduleName.toName.isAnonymous ||
        moduleName.toName.toString != moduleName ||
        modules.contains moduleName then
      return false
    modules := modules.push moduleName
    let some role := virJsonStringField? packageJson "role"
      | return false
    let expectedRole := if index + 1 == packages.size then "root" else "dependency"
    if role != expectedRole || (role == "root" && moduleName != expectedRootModule) then
      return false
    let some path := virJsonStringField? packageJson "path"
      | return false
    if path.trimAscii.toString.isEmpty || paths.contains path then
      return false
    let expectedPath :=
      if role == "root" then
        expectedRootPath
      else
        (System.FilePath.mk expectedShardDir / s!"{index}.irpkg").toString
    if path != expectedPath then
      return false
    paths := paths.push path
    let some expectedByteLength := virJsonNatField? packageJson "byteLength"
      | return false
    let some expectedSha256 := virJsonStringField? packageJson "sha256"
      | return false
    if expectedSha256.length != 64 ||
        !expectedSha256.toList.all ("0123456789abcdef".contains ·) then
      return false
    let memberPath := baseDir / path
    if !(← memberPath.pathExists) || (← memberPath.isDir) then
      return false
    let metadata ← memberPath.metadata
    if metadata.byteSize.toNat != expectedByteLength then
      return false
    memberPaths := memberPaths.push memberPath
    expectedHashes := expectedHashes.push expectedSha256
    index := index + 1
  return (← virSha256Files? memberPaths) == some expectedHashes

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
  let rootRelativePath := mod.fileName "irpkg"
  let shardRelativeDir := shardDir.fileName.getD shardDir.toString
  let clientNativeManifest? ← IO.getEnv "VIR_NATIVE_EXTERN_MANIFEST"
  generatorJob.bindM fun generator =>
    moduleJob.bindM fun artifacts =>
      importArtsJob.mapM fun _ => do
        addLeanTrace
        addTrace (← computeTrace generator)
        addPureTrace moduleName "VIR module"
        addPureTrace (clientNativeManifest?.getD "<unset>") "VIR client-native extern manifest"
        if let some manifest := clientNativeManifest? then
          unless manifest.isEmpty do
            addTrace (← computeTrace (System.FilePath.mk manifest))
        let packageSetComplete ← virPackageSetComplete descriptorPath moduleName
          rootRelativePath shardRelativeDir
        if (← descriptorPath.pathExists) &&
            (!(← reportPath.pathExists) || !packageSetComplete) then
          IO.FS.removeFile descriptorPath
        buildFileUnlessUpToDate' descriptorPath do
          removeFileIfExists descriptorPath
          removeFileIfExists packagePath
          removeDirAllIfExists shardDir
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
              rootRelativePath, shardRelativeDir
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
