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
    let errorsTrace ← computeTrace (root / "web/app/vir-widget-errors.js")
    let scriptTrace ← computeTrace (root / "scripts/build-infoview-widget.mjs")
    let packageTrace ← computeTrace (root / "package.json")
    let lockTrace ← computeTrace (root / "package-lock.json")
    return mixTrace entryTrace (mixTrace errorsTrace (mixTrace scriptTrace (mixTrace packageTrace lockTrace)))) fun _ =>
    runNpmScript root "build:infoview"

@[default_target]
lean_lib Vir where
  roots := #[`Vir]

/-- Resource data/tools must never depend on the optional runtime carrier. -/
lean_lib VirResourceCore where
  roots := #[]
  globs := #[.one `Vir.Resources, .one `Vir.Resources.Types, .one `Vir.Resources.Bytes,
    .one `Vir.Resources.Sha256, .one `Vir.Resources.Validate, .one `Vir.Resources.Pack,
    .one `Vir.Resources.Build, .one `Vir.Resources.Program, .one `Vir.NativePayload]

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

/-- Internal canonical marked-program producer and output adapters. -/
lean_exe vir_program where
  root := `tools.VirProgram
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

/-- Resource wrapping only; does not import the compiler or interpreter. -/
lean_exe vir_resource_program where
  root := `tools.VirResourceProgram

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

/-- Internal shared cached result. Public adapters do not repeat IR analysis. -/
module_facet virProgram (mod : Module) : System.FilePath := do
  let generatorJob ← vir_program.fetch
  let inputsJob ← (← mod.transImports.fetch).bindM fun imports =>
    fetchVirCompiledSetup mod imports
  let output := virModuleOutput mod "programs" "virprogram"
  let setupPath := virModuleOutput mod "programs" "setup.json"
  let clientNativeManifest? ← IO.getEnv "VIR_NATIVE_EXTERN_MANIFEST"
  generatorJob.bindM fun generator => inputsJob.mapM fun setup => do
    -- A rejected non-module must not inherit an earlier generation diagnostic.
    let diagnostic := output.addExtension "report.md"
    checkResourceOutput diagnostic
    removeFileIfExists diagnostic
    unless (setup.importArts.find? mod.name).any (·.ir?.isSome) do
      error s!"VIR package input `{mod.name}` requires a `module` header and compiled IR"
    addTrace (← computeTrace generator)
    addPureTrace "virProgram/v1" "VIR compiled program contract"
    addPureTrace mod.name.toString "VIR module"
    addPureTrace (clientNativeManifest?.getD "<unset>") "VIR client-native extern manifest"
    if let some manifest := clientNativeManifest? then
      unless manifest.isEmpty do addTrace (← computeTrace (System.FilePath.mk manifest))
    for path in #[output, setupPath, output.addExtension "report.md",
        output.addExtension "trace", output.addExtension "hash"] do
      checkResourceOutput path
    let inputTrace ← getTrace
    let artifact ← buildArtifactUnlessUpToDate output (ext := "virprogram") do
      createParentDirs output
      removeFileIfExists setupPath
      IO.FS.writeFile setupPath (Lean.toJson setup).compress
      proc {
        cmd := generator.toString
        args := #["build", setupPath.toString, output.toString]
        env := ← getAugmentedEnv }
    -- An artifact-map path is authoritative, not necessarily the conventional output.
    proc { cmd := generator.toString, args := #["verify", artifact.path.toString, mod.name.toString] }
    addTrace inputTrace
    return artifact.path

private def buildVirPackageSetFacet (mod : Module) : FetchM (Job System.FilePath) := do
  let toolJob ← vir_program.fetch
  let programJob ← (mod.facet `virProgram).fetch
  -- The public descriptor must not survive a failed regeneration. Preserve the
  -- original job's diagnostics while giving this adapter a cleanup boundary.
  let programJob := programJob.mapResult fun
    | .ok value state => .ok (Except.ok value) state
    | .error err state => .ok (Except.error err) state
  let packagePath := virModuleOutput mod "module-sets" "irpkg"
  let reportPath := virModuleOutput mod "module-sets" "report.md"
  let descriptorPath := virModuleOutput mod "module-sets" "irpkg-set.json"
  let shardDir := virModuleOutput mod "module-sets" "parts"
  let rootRelativePath := mod.fileName "irpkg"
  let shardRelativeDir := shardDir.fileName.getD shardDir.toString
  let reportRelativePath := mod.fileName "report.md"
  toolJob.bindM fun tool => programJob.mapM fun result => do
    for path in #[descriptorPath, packagePath, reportPath,
        descriptorPath.addExtension "trace", descriptorPath.addExtension "hash"] do
      checkResourceOutput path
    checkResourceDirectory shardDir
    let program ← match result with
      | .ok program => pure program
      | .error err =>
        removeFileIfExists descriptorPath
        removeFileIfExists packagePath
        removeDirAllIfExists shardDir
        removeFileIfExists reportPath
        let diagnostic := (virModuleOutput mod "programs" "virprogram").addExtension "report.md"
        if (← diagnostic.pathExists) then
          proc { cmd := tool.toString, args := #["report", diagnostic.toString, reportPath.toString] }
        throw err
    let args := #[program.toString, mod.name.toString, descriptorPath.toString,
      rootRelativePath, shardRelativeDir, reportRelativePath]
    let checked ← IO.Process.output { cmd := tool.toString, args := #["check"] ++ args }
    if checked.exitCode != 0 then removeFileIfExists descriptorPath
    let inputTrace ← getTrace
    buildFileUnlessUpToDate' descriptorPath do
      removeFileIfExists descriptorPath
      removeDirAllIfExists shardDir
      createParentDirs descriptorPath
      proc { cmd := tool.toString, args := #["install"] ++ args }
    addTrace inputTrace
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
      let program ← (mod.facet `virProgram).fetch
      let support ← supportPaths.mapM fun path => inputBinFile (lib.pkg.dir / System.FilePath.mk path)
      let support := Job.collectArray support "VIR resource support files"
      program.bindM fun program => support.mapM fun _ => do
        addPureTrace "virResourcePack/v2" "VIR resource producer contract"
        let output := lib.pkg.buildDir / "vir/resources/programs" / s!"{stem}.virres"
        for path in #[output, output.addExtension "trace", output.addExtension "hash"] do
          checkResourceOutput path
        let inputTrace ← getTrace
        let artifact ← buildArtifactUnlessUpToDate output (ext := "virres") do
          createParentDirs output
          proc {
            cmd := tool.toString
            args := #["build", recipe.toString, profile.toString, program.toString,
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
