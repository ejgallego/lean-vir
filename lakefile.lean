import Lake
open Lake DSL

package lean_vir where
  releaseRepo := "https://github.com/ejgallego/lean-vir"

def npmCmd : String :=
  if System.Platform.isWindows then "npm.cmd" else "npm"

def runNpmScript (cwd : System.FilePath) (scriptName : String) : LogIO Unit :=
  proc {
    cmd := npmCmd
    args := #["run", "--silent", scriptName]
    cwd := some cwd
  }

input_dir infoviewBundleSources where
  path := "web/src"
  filter := .extension <| .mem #["js"]
  text := true

target infoviewBundle (pkg) : System.FilePath := do
  let sources ← infoviewBundleSources.fetch
  let root := pkg.dir
  let output := root / "build/generated/infoview/vir-infoview-widget.js"
  buildFileAfterDep (text := true) output sources (extraDepTrace := do
    let entryTrace ← computeTrace (root / "web/app/vir-infoview-widget.js")
    let scriptTrace ← computeTrace (root / "scripts/build-infoview-widget.mjs")
    let packageTrace ← computeTrace (root / "package.json")
    let lockTrace ← computeTrace (root / "package-lock.json")
    return mixTrace entryTrace (mixTrace scriptTrace (mixTrace packageTrace lockTrace))) fun _ =>
    runNpmScript root "build:infoview"

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
  roots := #[`SlidesCanvas, `Fib, `Quickstart, `MergeSort, `HostInterop,
    `Tamagotchi, `VirNativeInfoview, `tutorials.ReactProofWidgetHello,
    `tutorials.RpcReferenceWidget]

/-- Authored browser fixtures; paths are preserved for source navigation. -/
lean_lib VirBrowserFixtures where
  roots := #[`fixtures.Basic, `fixtures.ListOption, `fixtures.InterfaceShapes,
    `fixtures.RecursiveTypes, `fixtures.Boundary, `fixtures.ExprPrinter,
    `fixtures.FormatPretty, `fixtures.JsonCompress, `fixtures.LeanParser,
    `fixtures.LeanParserHeader, `fixtures.Task, `fixtures.ReactCounter,
    `fixtures.ReactInput, `fixtures.HostInterop, `fixtures.ProofWidgetsHtml,
    `fixtures.ProofWidgetsJsxSubset]

/-- Module-system fixtures for composable package-set regression tests. -/
lean_lib VirModuleFixtures where
  srcDir := "fixtures/module-set"
  globs := #[.submodules `ModuleSetFixture]

/-- Infoview-only regression fixtures kept outside the public library. -/
lean_lib VirInfoviewFixtures where
  srcDir := "fixtures/infoview"
  roots := #[`InfoviewFixtures.ImportedHelper, `InfoviewFixtures.PrivateHost]

/-- Non-default runtime fixtures acquired through complete compiled modules. -/
lean_lib VirRuntimeFixtures where
  srcDir := "fixtures/runtime"
  roots := #[`ShellLifetime, `InfoviewRpcPromise, `JsNatNumber,
    `CollectionTypeFidelity, `ObjectTypeFidelity, `PromiseTypeFidelity, `BindingApi,
    `JsonRpcFoo, `JsonValueCodec]

/-- Standalone descriptor-forcing fixture, not a shipped binding authority. -/
lean_lib VirTypeAnchorFixtures where
  srcDir := "fixtures/type-anchors"
  roots := #[`TypeAnchorFixture]

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

private def virNodeCmd : String :=
  if System.Platform.isWindows then "node.exe" else "node"

private def virSha256Script : String :=
  "import { readFileSync } from \"node:fs\";" ++
  "import { createHash } from \"node:crypto\";" ++
  "for (const path of process.argv.slice(1)) {" ++
  "process.stdout.write(createHash(\"sha256\").update(readFileSync(path)).digest(\"hex\") + \"\\n\");" ++
  "}"

private def virSha256Files? (paths : Array System.FilePath) : IO (Option (Array String)) := do
  if paths.isEmpty then
    return some #[]
  try
    let out ← IO.Process.output {
      cmd := virNodeCmd
      args := #["--input-type=module", "--eval", virSha256Script, "--"] ++
        paths.map (fun path => path.toString)
    }
    if out.exitCode != 0 then
      return none
    let hashes := out.stdout.splitOn "\n" |>.filter (fun hash => !hash.isEmpty) |>.toArray
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
  -- Lean 4.33's importAllArts facet returns exportInfo.arts, not allArts,
  -- despite using allArtsTrace. Extract both explicitly so private artifact
  -- groups reach the generator as well as participating in invalidation.
  let moduleJob ← mod.exportInfo.fetch
  let importsJob ← mod.transImports.fetch
  let importArtsJob ← importsJob.bindM fun imports => do
    let jobs ← imports.mapM fun imported => do
      (← imported.exportInfo.fetch).mapM fun info => do
        addTrace info.allArtsTrace
        return (imported.name, info.allArts)
    return Job.collectArray jobs "VIR imported module IR"
  let packagePath := virModuleOutput mod "module-sets" "irpkg"
  let reportPath := virModuleOutput mod "module-sets" "report.md"
  let descriptorPath := virModuleOutput mod "module-sets" "irpkg-set.json"
  let shardDir := virModuleOutput mod "module-sets" "parts"
  let setupPath := virModuleOutput mod "module-sets" "setup.json"
  let moduleName := mod.name.toString
  let rootRelativePath := mod.fileName "irpkg"
  let shardRelativeDir := shardDir.fileName.getD shardDir.toString
  let clientNativeManifest? ← IO.getEnv "VIR_NATIVE_EXTERN_MANIFEST"
  generatorJob.bindM fun generator =>
    moduleJob.bindM fun artifacts =>
      importArtsJob.mapM fun imports => do
        unless artifacts.allArts.ir?.isSome do
          -- Rejection must also invalidate an older successful source package.
          removeFileIfExists descriptorPath
          removeFileIfExists packagePath
          removeFileIfExists reportPath
          removeDirAllIfExists shardDir
          error s!"VIR package input `{moduleName}` requires a `module` header and compiled IR"
        addLeanTrace
        addTrace artifacts.allArtsTrace
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
          createParentDirs packagePath
          createParentDirs reportPath
          createParentDirs descriptorPath
          IO.FS.createDirAll shardDir
          -- Keep Lake's resolved paths, including private data and full IR.
          -- Cache-only builds need not restore conventional .lake/build files.
          let importArts := imports.foldl (init := ({} : Lean.NameMap Lean.ImportArtifacts))
            fun arts (name, paths) => arts.insert name paths
          let setup : Lean.ModuleSetup := {
            name := mod.name
            importArts := importArts.insert mod.name artifacts.allArts
          }
          IO.FS.writeFile setupPath (Lean.toJson setup).compress
          proc {
            cmd := generator.toString
            args := #[
              packagePath.toString,
              reportPath.toString,
              "--setup", setupPath.toString
            ] ++ #[
              "--module-set-output", descriptorPath.toString, shardDir.toString, moduleName,
              rootRelativePath, shardRelativeDir
            ] ++ #["--target-marked-module", moduleName]
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
