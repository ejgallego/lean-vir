import Lake
open Lake DSL

package lean_vir where
  releaseRepo := "https://github.com/ejgallego/lean-vir"

private def npmCmd : String :=
  if System.Platform.isWindows then "npm.cmd" else "npm"

private def runNpmScript (cwd : System.FilePath) (scriptName : String) : LogIO Unit :=
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

-- Library ownership

/- Lake roots claim all descendants, even when globs build only the root.
Use explicit owners so native imports never load the browser library by accident.
The cold native-client regression checks one owner for every Vir module. -/
/-- Browser bindings and example support; native APIs have separate owners. -/
@[default_target]
lean_lib Vir where
  roots := #[]
  globs := #[.one `Vir, .one `Vir.Runtime, .andSubmodules `Vir.Js,
    .andSubmodules `Vir.Browser, .andSubmodules `Vir.React,
    .andSubmodules `Vir.ProofWidgets, .submodules `Vir.Examples]

/-- Pure format, JSON, Name and hashing utilities shared by native libraries. -/
lean_lib VirPackageFormat where
  roots := #[]
  globs := #[.submodules `Vir.Package, .one `Vir.Hash]

/-- Native compiler APIs and the public authoring attributes. No browser externs. -/
lean_lib VirCompiler where
  roots := #[]
  globs := #[.submodules `Vir.Compiler, .one `Vir.Attributes,
    .one `Vir.Host, .one `Vir.ExternFallback]

/-- Native package generation, independent of resource preparation and carriers. -/
lean_lib VirPackage where
  roots := #[]
  globs := #[.andSubmodules `Vir.GeneratePackage]

/-- Resource data/tools must never depend on the optional runtime carrier. -/
lean_lib VirResourceCore where
  roots := #[]
  globs := #[.one `Vir.BinaryLiteral, .one `Vir.Resources, .one `Vir.Resources.Types,
    .one `Vir.Resources.Validate, .one `Vir.Resources.Site, .one `Vir.Resources.Pack,
    .one `Vir.Resources.Build, .one `Vir.Resources.Program, .one `Vir.NativePayload]

lean_lib VirResourceEmbed where
  roots := #[]
  globs := #[.one `Vir.BinaryLiteral.ToExpr, .one `Vir.Resources.Embed]

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

-- Native tools

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

-- Compiled program facets and their cache dependencies

private def virModuleOutput (mod : Module) (kind ext : String) : System.FilePath :=
  mod.filePath (mod.pkg.buildDir / "vir" / kind) ext

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
  -- The importAllArts behavior first observed in Lean 4.33 still holds in
  -- pinned 4.34: it returns exportInfo.arts despite using allArtsTrace.
  -- Extract allArts explicitly so private artifact groups reach the generator
  -- as well as participating in invalidation.
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

/-- Internal bridge for repository package producers. Selection and output stay
with the generator; Lake returns executable and full compiled-artifact paths.
This is not an additional application build workflow or public module facet. -/
script virPrepare (args) do
  let noBuild := args.head? == some "--no-build"
  let names := (if noBuild then args.drop 1 else args).toArray
  let pkg ← getRootPackage
  let result ← runBuild (cfg := { noBuild, verbosity := .quiet }) do
    let generator ← vir_irpkg.fetch
    let inputs ← names.mapM fun name => do
      let some mod ← findModule? name.toName
        | error s!"VIR compiled input `{name}` is not Lake-registered"
      (← mod.transImports.fetch).bindM fun imports => fetchVirCompiledSetup mod imports
    generator.bindM fun generator => (Job.collectArray inputs "VIR producer inputs").mapM fun inputs => do
      let setup : Lean.ModuleSetup := {
        name := .anonymous
        importArts := inputs.foldl (init := {}) fun arts setup =>
          setup.importArts.foldl (fun arts name paths => arts.insert name paths) arts }
      let setupPath := pkg.buildDir / "vir/compiled-inputs" /
        s!"{(Hash.ofString (Lean.toJson names).compress).hex}.setup.json"
      let inputTrace ← getTrace
      if !names.isEmpty then
        buildFileUnlessUpToDate' setupPath do
          createParentDirs setupPath
          IO.FS.writeFile setupPath (Lean.toJson setup).compress
        -- The writer replaces the job trace with its file-content trace. Retain
        -- implementation identity even when private edits leave the JSON equal.
        addTrace inputTrace
      return Lean.Json.mkObj [
        ("path", Lean.toJson generator.toString),
        ("setup", if names.isEmpty then .null else Lean.toJson setupPath.toString),
        ("leanPath", Lean.toJson (← getAugmentedLeanPath).toString)]
  IO.println result.compress
  return 0

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

-- Browser SDK acquisition

private def virSdkVersion : String := "0.1.0"

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
      let stage := pkg.srcDir / ".vir-generated/VirResourceRuntime.virres"
      -- Check the full profile before installation, in the same acquisition pass.
      proc { cmd := tool.toString, args := #["acquire", profile.toString, contentId, source,
        cache.toString, stage.toString] }
      addTrace (← computeTrace stage)
      return stage

/-- Optional carrier: no other VIR library or native tool imports it. -/
lean_lib VirResourceRuntime where
  roots := #[]
  globs := #[.one `Vir.Resources.Runtime, .one `Vir.Resources.Assets]
  needs := #[virRuntimePack]

private def needsResourcePack (lib : LeanLib) (mod : Module) : Bool :=
  lib.config.needs.any fun
    | .facet (.module name) facet =>
      facet == `virResourcePack && name == mod.name && lib.pkg.keyName == mod.pkg.keyName
    | .packageModuleFacet pkg name facet =>
      facet == `virResourcePack && name == mod.name &&
        (pkg == mod.pkg.keyName || pkg == mod.pkg.baseName)
    | _ => false

/-- One marked module produces one portable resource pack. Its actual Lake
artifact is also materialized as a private input on the Lean library search path. -/
module_facet virResourcePack (mod : Module) : System.FilePath := withCurrPackage mod.pkg do
  -- Enforce this before any cache lookup. Resource runtime capabilities come
  -- from the locked bundle, not an ambient custom native-provider selection.
  if (← IO.getEnv "VIR_NATIVE_EXTERN_MANIFEST").isSome then
    error "VIR_RESOURCE_NATIVE_PROFILE_UNSUPPORTED: unset VIR_NATIVE_EXTERN_MANIFEST; resource programs require the locked runtime profile"
  if needsResourcePack mod.lib mod then
    error s!"VIR resource cycle: program `{mod.name}` belongs to a library needing its own resource pack"
  -- Source-only header traversal precedes compiled jobs, so a program importing
  -- the asset library which needs it fails instead of waiting on its own build.
  let imports ← (← mod.transImports.fetch).await
  for imported in imports do
    if needsResourcePack imported.lib mod then
      error s!"VIR resource cycle: `{mod.name}` imports `{imported.name}` whose library needs its resource pack"
  let program ← (mod.facet `virProgram).fetch
  let profile ← virResourceCompatibility.fetch
  let tool ← vir_resource_program.fetch
  let packTool ← vir_resource_pack.fetch
  tool.bindM fun tool => packTool.bindM fun packTool => profile.bindM fun profile =>
      program.mapM fun program => do
        addPureTrace mod.name "VIR program root"
        addPureTrace "virResourcePack/module-v1" "VIR resource producer contract"
        let output := virModuleOutput mod "resources/programs" "virres"
        for path in #[output, output.addExtension "trace", output.addExtension "hash"] do
          checkResourceOutput path
        let inputTrace ← getTrace
        let artifact ← buildArtifactUnlessUpToDate output (ext := "virres") do
          createParentDirs output
          proc {
            cmd := tool.toString
            args := #["build", mod.name.toString, profile.toString,
              program.toString, output.toString], env := ← getAugmentedEnv }
        let stage := mod.filePath (mod.pkg.leanLibDir / "vir-assets") "virres"
        -- Always repair/verify staging, even when Lake returns a cached artifact
        -- somewhere other than output. No restoration of conventional IR paths.
        discard <| captureProc {
          cmd := packTool.toString
          args := #["stage", profile.toString, artifact.path.toString, stage.toString] }
        addTrace inputTrace
        addTrace (← computeTrace stage)
        return artifact.path
