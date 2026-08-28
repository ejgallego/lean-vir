import Lake
open Lake DSL

package lean_vir where
  version := v!"0.1.0"
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

lean_exe vir_web_assets where
  root := `tools.VirWebAssets
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

private def virPackageSetVersion : Nat := 1

private def virPackageFormatVersion : Nat := 10

private def virInterfaceManifestVersion : Nat := 7

private def virRuntimeAbiVersion : Nat := 1

private def virWebAssetsConfigFormat : String := "lean-vir-web-assets-config"

private def virWebAssetsConfigVersion : Nat := 1

private def virWebAssetProgramIdChar (char : Char) : Bool :=
  let code := char.toNat
  (code >= 'A'.toNat && code <= 'Z'.toNat) ||
    (code >= 'a'.toNat && code <= 'z'.toNat) ||
    (code >= '0'.toNat && code <= '9'.toNat) ||
    char == '.' || char == '_' || char == '-'

private def virValidateWebAssetProgramId (id : String) : IO Unit := do
  if id.isEmpty || id == "." || id == ".." || !id.all virWebAssetProgramIdChar then
    throw <| IO.userError <|
      s!"VIR web-assets program `id` must be a URL-safe slug using letters, digits, '.', '_', or '-': {id}"

private def virValidatePortableWebAssetProgramId
    (ids : Array String) (id : String) : IO Unit := do
  virValidateWebAssetProgramId id
  if let some existing := ids.find? (fun candidate => candidate.toLower == id.toLower) then
    throw <| IO.userError <|
      "VIR web-assets program IDs must be unique under ASCII case-folding for portable " ++
        s!"filesystems: `{existing}` conflicts with `{id}`"

private structure VirSourceIdentity where
  version : String
  commit : String
  exactTag? : Option String
  dir : System.FilePath
  toolchain : String

private def virGitCommit? (dir : System.FilePath) : IO (Option String) := do
  try
    let output ← IO.Process.output {
      cmd := "git"
      args := #["-C", dir.toString, "rev-parse", "--show-toplevel", "HEAD"]
    }
    let lines := output.stdout.splitOn "\n"
    let some root := lines[0]? | return none
    let some commit := lines[1]? | return none
    let root ← IO.FS.realPath (System.FilePath.mk root.trimAscii.toString)
    let dir ← IO.FS.realPath dir
    let commit := commit.trimAscii.toString
    if output.exitCode == 0 && root == dir && !commit.isEmpty then
      return some commit
    return none
  catch _ =>
    return none

private def virGitExactTag? (dir : System.FilePath) : IO (Option String) := do
  try
    let output ← IO.Process.output {
      cmd := "git"
      args := #["-C", dir.toString, "describe", "--tags", "--exact-match", "HEAD"]
    }
    let tag := output.stdout.trimAscii.toString
    if output.exitCode == 0 && !tag.isEmpty then
      return some tag
    return none
  catch _ =>
    return none

private def virGitIsClean (dir : System.FilePath) : IO Bool := do
  try
    let output ← IO.Process.output {
      cmd := "git"
      args := #["-C", dir.toString, "status", "--porcelain", "--untracked-files=normal"]
    }
    return output.exitCode == 0 && output.stdout.trimAscii.isEmpty
  catch _ =>
    return false

private def virSourceIdentity : FetchM VirSourceIdentity := do
  let some virPkg ← findPackageByName? `lean_vir
    | error "the VIR facets require the `lean_vir` package in this workspace"
  let toolchainPath := virPkg.dir / "lean-toolchain"
  unless (← toolchainPath.pathExists) do
    error s!"the resolved lean_vir package is missing {toolchainPath}"
  let some commit ← virGitCommit? virPkg.dir
    | error <| s!"the resolved lean_vir package at {virPkg.dir} has no exact Git identity; " ++
        "VIR web assets require a clean Git checkout so the selected SDK cannot be mistaken " ++
        "for a different source tree"
  unless ← virGitIsClean virPkg.dir do
    error <| s!"the resolved lean_vir package at {virPkg.dir} has uncommitted or untracked changes; " ++
      "commit or remove them before composing VIR web assets, or provide a clean dependency checkout"
  return {
    version := virPkg.version.toString
    commit
    exactTag? := ← virGitExactTag? virPkg.dir
    dir := virPkg.dir
    toolchain := (← IO.FS.readFile toolchainPath).trimAscii.toString
  }

private def virNormalizeLeanToolchain (toolchain : String) : String :=
  if toolchain.startsWith "leanprover/lean4:v" then
    "leanprover/lean4:" ++ toolchain.drop "leanprover/lean4:v".length
  else
    toolchain

private partial def virInvalidateWebAssetsManifests (root : System.FilePath) : IO Unit := do
  unless ← root.pathExists do
    return
  for entry in ← root.readDir do
    if ← entry.path.isDir then
      virInvalidateWebAssetsManifests entry.path
    else if entry.fileName == "VIR_WEB_ASSETS.json" then
      IO.FS.removeFile entry.path

private def virJsonStringField? (json : Lean.Json) (field : String) : Option String :=
  match json.getObjVal? field with
  | .ok (.str value) => some value
  | _ => none

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
  let .ok compatibility := descriptor.getObjVal? "compatibility"
    | return false
  let .ok packageFormatJson := compatibility.getObjVal? "packageFormatVersion"
    | return false
  let .ok packageFormat := packageFormatJson.getNat?
    | return false
  if packageFormat != virPackageFormatVersion then
    return false
  let .ok manifestVersionJson := compatibility.getObjVal? "manifestVersion"
    | return false
  let .ok manifestVersion := manifestVersionJson.getNat?
    | return false
  if manifestVersion != virInterfaceManifestVersion then
    return false
  let .ok runtimeAbiJson := compatibility.getObjVal? "runtimeAbiVersion"
    | return false
  let .ok runtimeAbi := runtimeAbiJson.getNat?
    | return false
  if runtimeAbi != virRuntimeAbiVersion then
    return false
  for field in #["leanVersion", "leanToolchain", "leanGithash"] do
    let some value := virJsonStringField? compatibility field
      | return false
    if value.isEmpty then
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
  let mut index := 0
  for packageJson in packages do
    let some moduleName := virJsonStringField? packageJson "module"
      | return false
    if moduleName.trimAscii.toString.isEmpty || modules.contains moduleName then
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
        (System.FilePath.mk expectedShardDir / s!"{moduleName}.irpkg").toString
    if path != expectedPath then
      return false
    paths := paths.push path
    let memberPath := baseDir / path
    if !(← memberPath.pathExists) || (← memberPath.isDir) then
      return false
    index := index + 1
  return true

private def virAddPackageSetTraces (descriptorPath : System.FilePath) : JobM Unit := do
  addTrace (← computeTrace descriptorPath)
  let .ok descriptor := Lean.Json.parse (← IO.FS.readFile descriptorPath)
    | error s!"failed to parse VIR package-set descriptor: {descriptorPath}"
  let .ok packagesJson := descriptor.getObjVal? "packages"
    | error s!"VIR package-set descriptor is missing `packages`: {descriptorPath}"
  let .ok packages := packagesJson.getArr?
    | error s!"VIR package-set descriptor `packages` must be an array: {descriptorPath}"
  let baseDir := descriptorPath.parent.getD "."
  for packageJson in packages do
    let some path := virJsonStringField? packageJson "path"
      | error s!"VIR package-set member is missing `path`: {descriptorPath}"
    addTrace (← computeTrace (baseDir / path))

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
  generatorJob.bindM fun generator =>
    moduleJob.bindM fun artifacts =>
      importArtsJob.mapM fun _ => do
        addLeanTrace
        addTrace (← computeTrace generator)
        addPureTrace moduleName "VIR module"
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
  let identity ← virSourceIdentity
  if identity.version != virSdkVersion then
    error s!"lean_vir package version {identity.version} does not match SDK contract {virSdkVersion}"
  let fetcherJob ← vir_fetch_sdk.fetch
  let sdkDir := pkg.buildDir / "vir" / "sdk"
  let manifestPath := sdkDir / "lean-vir-artifact.json"
  let archive? ← IO.getEnv "VIR_SDK_ARCHIVE"
  let url? ← IO.getEnv "VIR_SDK_URL"
  let tag? ← IO.getEnv "VIR_SDK_TAG"
  let commit? ← IO.getEnv "VIR_SDK_COMMIT"
  let expectCommit? ← IO.getEnv "VIR_SDK_EXPECT_COMMIT"
  let repo? ← IO.getEnv "VIR_SDK_REPO"
  if let some configured := expectCommit? then
    if configured != identity.commit then
      error s!"VIR_SDK_EXPECT_COMMIT={configured} does not match lean_vir at {identity.commit}"
  let expectedCommit := identity.commit
  let explicitSource := archive?.isSome || url?.isSome || tag?.isSome || commit?.isSome
  let consumerToolchain := Lean.toolchain
  let localBuild := !explicitSource &&
    virNormalizeLeanToolchain identity.toolchain != virNormalizeLeanToolchain consumerToolchain
  let releaseTag := s!"v{identity.version}"
  let taggedRelease := identity.exactTag? == some releaseTag
  let automaticCommit? := if explicitSource || localBuild || taggedRelease then none else some identity.commit
  let sourceConfig := String.intercalate "\n" [
    s!"policy={if localBuild then "local-build" else if automaticCommit?.isSome then "dependency-commit" else "configured-or-release"}",
    s!"archive={archive?.getD ""}",
    s!"url={url?.getD ""}",
    s!"tag={tag?.getD ""}",
    s!"commit={commit?.getD ""}",
    s!"expectCommit={expectedCommit}",
    s!"repo={repo?.getD ""}",
    s!"exactTag={identity.exactTag?.getD ""}",
    s!"consumerToolchain={consumerToolchain}",
    s!"virToolchain={identity.toolchain}"
  ]
  fetcherJob.mapM fun fetcher => do
    addTrace (← computeTrace fetcher)
    addPureTrace identity.version "VIR SDK version"
    addPureTrace identity.commit "lean_vir source revision"
    addPureTrace sourceConfig "VIR SDK source"
    addTrace (← computeTrace (identity.dir / "lean-toolchain"))
    if localBuild || automaticCommit?.isSome then
      addTrace (← computeTrace (identity.dir / "scripts/packages/build-local-sdk.mjs"))
    if let some archive := archive? then
      addTrace (← computeTrace (System.FilePath.mk archive))
    let sourceArgs :=
      if localBuild then
        #["--local-source", identity.dir.toString]
      else
        (automaticCommit?.map fun commit =>
          #["--commit", commit, "--fallback-local-source", identity.dir.toString]).getD #[]
    let expectedArgs := #[
      "--expect-version", identity.version,
      "--expect-commit", expectedCommit,
      "--expect-current-lean"
    ]
    if ← manifestPath.pathExists then
      let verification ← IO.Process.output {
        cmd := fetcher.toString
        args := #["--verify-installed", sdkDir.toString] ++ expectedArgs
        env := ← getAugmentedEnv
      }
      if verification.exitCode != 0 then
        IO.FS.removeFile manifestPath
        virInvalidateWebAssetsManifests (pkg.buildDir / "vir" / "web-assets")
    buildFileUnlessUpToDate' (text := true) manifestPath do
      createParentDirs manifestPath
      try
        proc {
          cmd := fetcher.toString
          args := #["--out", sdkDir.toString] ++ sourceArgs ++ expectedArgs
          env := ← getAugmentedEnv
        }
      catch error =>
        virInvalidateWebAssetsManifests (pkg.buildDir / "vir" / "web-assets")
        throw error
    return manifestPath

private structure VirWebProgramConfig where
  id : String
  package? : Option String
  moduleName : Lean.Name

private def virRequiredJsonString (source : String) (json : Lean.Json) (field : String) : IO String := do
  match json.getObjVal? field >>= Lean.Json.getStr? with
  | .ok value => pure value
  | .error err => throw <| IO.userError s!"invalid {source} field `{field}`: {err}"

private def virOptionalJsonString (source : String) (json : Lean.Json) (field : String) : IO (Option String) := do
  match json.getObjVal? field with
  | .error _ => pure none
  | .ok value =>
      match value.getStr? with
      | .ok text => pure (some text)
      | .error err => throw <| IO.userError s!"invalid {source} field `{field}`: {err}"

private def virReadWebAssetsConfig (path : System.FilePath) : IO (Array VirWebProgramConfig) := do
  unless (← path.pathExists) do
    throw <| IO.userError s!"missing VIR web-assets configuration: {path}"
  let .ok json := Lean.Json.parse (← IO.FS.readFile path)
    | throw <| IO.userError s!"failed to parse {path}"
  let format ← virRequiredJsonString path.toString json "format"
  if format != virWebAssetsConfigFormat then
    throw <| IO.userError s!"unsupported VIR web-assets configuration format: {format}"
  let .ok versionJson := json.getObjVal? "version"
    | throw <| IO.userError "VIR web-assets configuration is missing `version`"
  let .ok version := versionJson.getNat?
    | throw <| IO.userError "VIR web-assets configuration `version` must be a natural number"
  if version != virWebAssetsConfigVersion then
    throw <| IO.userError s!"unsupported VIR web-assets configuration version: {version}"
  let .ok programsJson := json.getObjVal? "programs" >>= Lean.Json.getArr?
    | throw <| IO.userError "VIR web-assets configuration `programs` must be an array"
  if programsJson.isEmpty then
    throw <| IO.userError "VIR web-assets configuration must contain at least one program"
  let mut programs : Array VirWebProgramConfig := #[]
  let mut ids : Array String := #[]
  for programJson in programsJson do
    let moduleString ← virRequiredJsonString "VIR web-assets program" programJson "module"
    let moduleName := moduleString.toName
    if moduleName.isAnonymous then
      throw <| IO.userError "VIR web-assets program `module` must be a Lean module name"
    let id := (← virOptionalJsonString "VIR web-assets program" programJson "id").getD moduleString
    virValidatePortableWebAssetProgramId ids id
    ids := ids.push id
    let package? ← (← virOptionalJsonString "VIR web-assets program" programJson "package").mapM
      fun packageString => do
        if packageString.isEmpty then
          throw <| IO.userError "VIR web-assets program `package` must not be empty"
        return packageString
    programs := programs.push { id, package?, moduleName }
  return programs

private structure VirResolvedWebProgram where
  config : VirWebProgramConfig
  module : Module

private def virResolveWebProgram (config : VirWebProgramConfig) : FetchM VirResolvedWebProgram := do
  let module ← match config.package? with
  | some packageId =>
      let workspace ← getWorkspace
      let some programPkg := workspace.packages.find? (·.prettyName == packageId)
        | error s!"VIR web-assets package `{packageId}` was not found"
      let some module := programPkg.findTargetModule? config.moduleName
        | error s!"VIR web-assets module `{config.moduleName}` was not found in package `{packageId}`"
      pure module
  | none =>
      let modules ← findModules config.moduleName
      if modules.isEmpty then
        error s!"VIR web-assets module `{config.moduleName}` was not found"
      else if modules.size > 1 then
        error s!"VIR web-assets module `{config.moduleName}` is ambiguous; add its `package`"
      else
        let some module := modules[0]?
          | error s!"VIR web-assets module `{config.moduleName}` was not found"
        pure module
  return { config, module }

private def virComposeWebAssets
    (pkg : Package)
    (outputDir : System.FilePath)
    (programs : Array VirResolvedWebProgram)
    (configPath? : Option System.FilePath := none) : FetchM (Job System.FilePath) := do
  let identity ← virSourceIdentity
  let outputManifest := outputDir / "VIR_WEB_ASSETS.json"
  let composerJob ← vir_web_assets.fetch
  let sdkJob ← pkg.fetchFacetJob `virSdk
  let descriptorJobs ← programs.mapM fun program => program.module.fetchFacetJob `vir
  let descriptorsJob := Job.collectArray descriptorJobs "VIR web programs"
  let sdkManifest := pkg.buildDir / "vir" / "sdk" / "lean-vir-artifact.json"
  composerJob.bindM fun composer =>
    sdkJob.bindM fun _ =>
      descriptorsJob.mapM fun _ => do
        addTrace (← computeTrace composer)
        if let some configPath := configPath? then
          addTrace (← computeTrace configPath)
        addTrace (← computeTrace sdkManifest)
        addPureTrace identity.version "lean_vir version"
        addPureTrace identity.commit "lean_vir source revision"
        let mut args := #[
          "--out", outputDir.toString,
          "--sdk-manifest", sdkManifest.toString,
          "--vir-version", identity.version,
          "--vir-commit", identity.commit,
          "--host-package", pkg.prettyName
        ]
        for program in programs do
          let descriptor := virModuleOutput program.module "module-sets" "irpkg-set.json"
          virAddPackageSetTraces descriptor
          args := args ++ #[
            "--program",
            program.config.id,
            program.module.pkg.prettyName,
            program.module.name.toString,
            descriptor.toString
          ]
        if ← outputManifest.pathExists then
          let verification ← IO.Process.output {
            cmd := composer.toString
            args := #["--verify-installed", outputDir.toString]
            env := ← getAugmentedEnv
          }
          if verification.exitCode != 0 then
            if ← outputManifest.isDir then
              IO.FS.removeDirAll outputManifest
            else
              IO.FS.removeFile outputManifest
        buildFileUnlessUpToDate' (text := true) outputManifest do
          proc {
            cmd := composer.toString
            args
            env := ← getAugmentedEnv
          }
        return outputManifest

/--
Compose the root application's `vir-web-assets.json` into one deployable
directory containing one matching SDK and one or more VIR package sets.
-/
package_facet virWebAssets (pkg : Package) : System.FilePath := do
  let configPath := pkg.dir / "vir-web-assets.json"
  let configs ← virReadWebAssetsConfig configPath
  let programs ← configs.mapM virResolveWebProgram
  virComposeWebAssets pkg (pkg.buildDir / "vir" / "web-assets") programs (some configPath)

/--
Compose a named application bundle from one or more explicit Lean library roots.
For a singleton bundle, the library name is the program ID. For a multi-program
bundle, each root module name is its program ID. Every bundle stages exactly one
SDK, and application-root wrappers remain responsible for exports and startup.
-/
library_facet virWebAssets (lib : LeanLib) : System.FilePath := do
  if lib.roots.isEmpty then
    error s!"VIR web-assets library `{lib.name}` must declare at least one root module"
  let bundleId := lib.name.toString (escape := false)
  virValidateWebAssetProgramId bundleId
  let programs ← lib.roots.mapM fun moduleName => do
    let id := if lib.roots.size == 1 then bundleId else moduleName.toString
    virValidateWebAssetProgramId id
    let some module := lib.pkg.findTargetModule? moduleName
      | error s!"VIR web-assets module `{moduleName}` was not found in package `{lib.pkg.prettyName}`"
    return {
      config := { id, package? := some lib.pkg.prettyName, moduleName }
      module
    }
  let ids := programs.map (·.config.id)
  let mut portableIds : Array String := #[]
  for id in ids do
    virValidatePortableWebAssetProgramId portableIds id
    portableIds := portableIds.push id
  let outputDir := lib.pkg.buildDir / "vir" / "web-assets" / bundleId
  virComposeWebAssets lib.pkg outputDir programs
