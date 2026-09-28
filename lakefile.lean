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

/-- Resource data/tools must never depend on the optional runtime carrier. -/
lean_lib VirResourceCore where
  roots := #[]
  globs := #[.one `Vir.Resources, .one `Vir.Resources.Types, .one `Vir.Resources.Bytes,
    .one `Vir.Resources.Sha256, .one `Vir.Resources.Validate, .one `Vir.Resources.Pack,
    .one `Vir.Resources.Build]

lean_lib VirResourceEmbed where
  roots := #[]
  globs := #[.one `Vir.Resources.Embed]

lean_lib VirResourceBrowserFixture where
  roots := #[`tests.resources.BrowserProgram]

/-- Optional Lean infoview integration and its generated JavaScript shell. -/
lean_lib VirInfoview where
  roots := #[`Vir.Infoview]
  needs := #[infoviewBundle]

/-- Non-default, buildable sources used by the public VIR examples. -/
lean_lib VirExamples where
  srcDir := "examples"
  roots := #[`SlidesCanvas, `Fib, `Quickstart, `MergeSort, `HostInterop,
    `Tamagotchi, `VirNativeInfoview, `ReactTamagotchiWidget, `tutorials.ReactProofWidgetHello,
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
    `CollectionTypeFidelity, `ObjectTypeFidelity, `PromiseTypeFidelity, `BindingApi, `OptionalProps,
    `HostErrorPropagation]

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

/-- Pure resource-format regression tests, independent of runtime acquisition. -/
lean_exe vir_resource_tests where
  root := `tests.resources.Unit

/-- Native preparation only; never depends on a resource carrier. -/
lean_exe vir_resource_pack where
  root := `tools.VirResourcePack

/-- Compiled program production; kept below both carrier libraries. -/
lean_exe vir_resource_program where
  root := `tools.VirResourceProgram
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

/- One compiled-input boundary for loose package sets and embedded resources.
Callers resolve/check the import graph first (resource carriers must stay out of
it). This job carries implementation contents as well as their resolved paths;
serializing its result must not replace that semantic dependency trace. -/
private def fetchVirCompiledSetup
    (mod : Module) (imports : Array Module) : FetchM (Job Lean.ModuleSetup) := do
  -- Lean 4.33's importAllArts facet returns exportInfo.arts, not allArts,
  -- despite using allArtsTrace. Extract both explicitly so private artifact
  -- groups reach the generator as well as participating in invalidation.
  let jobs ← (imports.push mod).mapM fun input => do
    (← input.exportInfo.fetch).mapM fun info => do
      addTrace info.allArtsTrace
      return (input.name, info.allArts)
  (Job.collectArray jobs "VIR compiled inputs").mapM fun artifacts => do
    let importArts := artifacts.foldl (init := ({} : Lean.NameMap Lean.ImportArtifacts))
      fun arts (name, paths) => arts.insert name paths
    let setup : Lean.ModuleSetup := { name := mod.name, importArts }
    addLeanTrace
    -- Cache relocation can change paths without changing implementation bytes.
    addPureTrace (Lean.toJson setup).compress "VIR resolved input locations"
    return setup

private def buildVirPackageSetFacet
    (mod : Module) : FetchM (Job System.FilePath) := do
  let generatorJob ← vir_irpkg.fetch
  let inputsJob ← (← mod.transImports.fetch).bindM fun imports =>
    fetchVirCompiledSetup mod imports
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
    inputsJob.mapM fun setup => do
      unless (setup.importArts.find? mod.name).any (·.ir?.isSome) do
        -- Rejection must also invalidate an older successful source package.
        removeFileIfExists descriptorPath
        removeFileIfExists packagePath
        removeFileIfExists reportPath
        removeDirAllIfExists shardDir
        error s!"VIR package input `{moduleName}` requires a `module` header and compiled IR"
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

/- Embedded resource preparation. These declarations use Lake/Lean only: no
import of an unbuilt VIR implementation into downstream lake configurations. -/

input_file virResourceCompatibility where
  path := "vir-resources/compatibility.json"
  text := true

input_file virResourceRuntimeLock where
  path := "vir-resources/runtime.json"
  text := true

target virRuntimePack (pkg) : System.FilePath := do
  let tool ← vir_resource_pack.fetch
  let profile ← virResourceCompatibility.fetch
  let lock ← virResourceRuntimeLock.fetch
  tool.bindM fun tool => profile.bindM fun profile => lock.mapM fun lock => do
      let plan ← captureProc {
        cmd := tool.toString
        args := #["runtime-plan", profile.toString, lock.toString, pkg.dir.toString] }
      let json ← IO.ofExcept (Lean.Json.parse plan)
      let contentId ← IO.ofExcept <| json.getObjValAs? String "contentId"
      let source ← IO.ofExcept <| json.getObjValAs? String "source"
      if source != "-" && !source.startsWith "https://" then
        addTrace (← computeTrace (System.FilePath.mk source))
      addLeanTrace
      let cache := pkg.buildDir / "vir/resources/runtime" / s!"{contentId}.virres"
      let stage := pkg.dir / ".vir-generated/VirResourceRuntime.virres"
      -- Check the full profile before installation, in the same acquisition pass.
      proc { cmd := tool.toString, args := #["acquire", profile.toString, contentId, source,
        cache.toString, stage.toString] }
      addTrace (← computeTrace stage)
      return stage

/-- Optional carrier: no other VIR library or native tool imports it. -/
lean_lib VirResourceRuntime where
  roots := #[]
  globs := #[.one `Vir.Resources.Runtime]
  needs := #[virRuntimePack]

private def sameResourceLibrary (a b : LeanLib) : Bool :=
  a.name == b.name && a.pkg.keyName == b.pkg.keyName

private def resourceLibraryStem (lib : LeanLib) : Except String String := do
  let stem := lib.name.toString
  unless !stem.isEmpty && stem.toList.all (fun c =>
      c.isAlphanum && c.toNat < 128 || c == '_') do
    throw "virResourcePack requires an ASCII alphanumeric/underscore library name"
  return stem

/- Keep this small preflight in the Lake configuration: importing the unbuilt
native tool here would create a bootstrap dependency. Lake may remove the output
or write its trace/hash *before* invoking the tool, including on cache hits.
This rejects accidental aliases, not concurrent hostile directory replacement. -/
private def resourceMetadata? (path : System.FilePath) : IO (Option IO.FS.Metadata) := do
  try return some (← path.symlinkMetadata)
  catch e => match e with
    | .noFileOrDirectory .. => return none
    | _ => throw e

private partial def checkResourceDirectory (path : System.FilePath) : IO Unit := do
  if let some parent := path.parent then
    if parent != path then checkResourceDirectory parent
  if let some metadata ← resourceMetadata? path then
    unless metadata.type == .dir do
      throw <| IO.userError s!"UNSAFE_RESOURCE_DIRECTORY: {path}"

private def checkResourceOutput (path : System.FilePath) : IO Unit := do
  checkResourceDirectory (path.parent.getD ".")
  if let some metadata ← resourceMetadata? path then
    unless metadata.type == .file do
      throw <| IO.userError s!"UNSAFE_RESOURCE_FILE: {path}"

/-- Resolve only independent program inputs; never fetch the carrier's modules
or extra dependencies while producing the prerequisite for that carrier. -/
library_facet virResourcePack (lib : LeanLib) : System.FilePath := do
  -- Enforce this before any cache lookup. Resource runtime capabilities come
  -- from the locked bundle, not an ambient custom native-provider selection.
  if (← IO.getEnv "VIR_NATIVE_EXTERN_MANIFEST").isSome then
    error "VIR_RESOURCE_NATIVE_PROFILE_UNSUPPORTED: unset VIR_NATIVE_EXTERN_MANIFEST; resource programs require the locked runtime profile"
  let stem ← IO.ofExcept (resourceLibraryStem lib)
  let recipe ← inputTextFile (lib.pkg.dir / "vir-resources" / s!"{stem}.json")
  let profile ← virResourceCompatibility.fetch
  let tool ← vir_resource_program.fetch
  let packTool ← vir_resource_pack.fetch
  tool.bindM fun tool => packTool.bindM fun packTool => profile.bindM fun profile =>
  recipe.bindM fun recipe => do
    let planText ← captureProc {
      cmd := tool.toString
      args := #["plan", recipe.toString, profile.toString, lib.pkg.dir.toString] }
    let plan ← IO.ofExcept (Lean.Json.parse planText)
    let moduleName ← IO.ofExcept <| plan.getObjValAs? String "module"
    let supportPaths ← IO.ofExcept <| plan.getObjValAs? (Array String) "supportFiles"
    let some mod ← findModule? moduleName.toName
      | error s!"VIR resource program module `{moduleName}` is not Lake-registered"
    if sameResourceLibrary mod.lib lib then
      error s!"VIR resource cycle: program `{moduleName}` belongs to its carrier library `{lib.name}`"
    let imports ← mod.transImports.fetch
    imports.bindM fun imports => do
      for imported in imports do
        if sameResourceLibrary imported.lib lib then
          error s!"VIR resource cycle: `{moduleName}` imports carrier module `{imported.name}` in `{lib.name}`"
      -- Source-only transImports was checked before requesting compilation, so
      -- the common carrier/program cycle produces a diagnostic, not a job wait.
      let inputs ← fetchVirCompiledSetup mod imports
      let support ← supportPaths.mapM fun path => inputBinFile (lib.pkg.dir / System.FilePath.mk path)
      let support := Job.collectArray support "VIR resource support files"
      inputs.bindM fun setup => support.mapM fun _ => do
        unless (setup.importArts.find? mod.name).any (·.ir?.isSome) do
          error s!"VIR resource program `{moduleName}` requires a module header and compiled IR"
        addPureTrace "virResourcePack/v1" "VIR resource producer contract"
        let setupText := (Lean.toJson setup).compress
        let output := lib.pkg.buildDir / "vir/resources/programs" / s!"{stem}.virres"
        let setupPath := output.addExtension "setup.json"
        for path in #[output, setupPath, output.addExtension "trace", output.addExtension "hash"] do
          checkResourceOutput path
        let inputTrace ← getTrace
        let artifact ← buildArtifactUnlessUpToDate output (ext := "virres") do
          createParentDirs output
          -- Setup files are private transport, never mutate another hardlink name.
          removeFileIfExists setupPath
          IO.FS.writeFile setupPath setupText
          proc {
            cmd := tool.toString
            args := #["build", recipe.toString, profile.toString, setupPath.toString,
              lib.pkg.dir.toString, output.toString], env := ← getAugmentedEnv }
        let stage := lib.pkg.dir / ".vir-generated" / s!"{stem}.virres"
        -- Always repair/verify staging, even when Lake returns a cached artifact
        -- somewhere other than output. No restoration of conventional IR paths.
        discard <| captureProc {
          cmd := packTool.toString
          args := #["stage", profile.toString, artifact.path.toString, stage.toString] }
        addTrace inputTrace
        addTrace (← computeTrace stage)
        return artifact.path
