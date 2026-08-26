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

private structure VirSourceIdentity where
  version : String
  commit? : Option String

private def virGitCommit? (dir : System.FilePath) : IO (Option String) := do
  try
    let output ← IO.Process.output {
      cmd := "git"
      args := #["-C", dir.toString, "rev-parse", "--show-toplevel", "HEAD"]
    }
    let lines := output.stdout.splitOn "\n"
    let some root := lines[0]? | return none
    let some commit := lines[1]? | return none
    let root := (System.FilePath.mk root.trimAscii.toString).normalize
    let commit := commit.trimAscii.toString
    if output.exitCode == 0 && root == dir.normalize && !commit.isEmpty then
      return some commit
    return none
  catch _ =>
    return none

private def virSourceIdentity : FetchM VirSourceIdentity := do
  let some virPkg ← findPackageByName? `lean_vir
    | error "the VIR facets require the `lean_vir` package in this workspace"
  return {
    version := virPkg.version.toString
    commit? := ← virGitCommit? virPkg.dir
  }

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
    if let some derived := identity.commit? then
      if configured != derived then
        error s!"VIR_SDK_EXPECT_COMMIT={configured} does not match lean_vir at {derived}"
  let expectedCommit? := identity.commit?.orElse fun _ => expectCommit?
  let sourceConfig := String.intercalate "\n" [
    s!"archive={archive?.getD ""}",
    s!"url={url?.getD ""}",
    s!"tag={tag?.getD ""}",
    s!"commit={commit?.getD ""}",
    s!"expectCommit={expectedCommit?.getD ""}",
    s!"repo={repo?.getD ""}"
  ]
  fetcherJob.mapM fun fetcher => do
    addTrace (← computeTrace fetcher)
    addPureTrace identity.version "VIR SDK version"
    if let some commit := identity.commit? then
      addPureTrace commit "lean_vir source revision"
    addPureTrace sourceConfig "VIR SDK source"
    if let some archive := archive? then
      addTrace (← computeTrace (System.FilePath.mk archive))
    if ← manifestPath.pathExists then
      let verification ← IO.Process.output {
        cmd := fetcher.toString
        args := #["--verify-installed", sdkDir.toString, "--expect-version", identity.version] ++
          (expectedCommit?.map fun commit => #["--expect-commit", commit]).getD #[]
        env := ← getAugmentedEnv
      }
      if verification.exitCode != 0 then
        IO.FS.removeFile manifestPath
    buildFileUnlessUpToDate' (text := true) manifestPath do
      createParentDirs manifestPath
      proc {
        cmd := fetcher.toString
        args := #["--out", sdkDir.toString, "--expect-version", identity.version] ++
          (expectedCommit?.map fun commit => #["--expect-commit", commit]).getD #[]
        env := ← getAugmentedEnv
      }
    return manifestPath

private structure VirWebProgramConfig where
  id : String
  package? : Option Lean.Name
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
    if ids.contains id then
      throw <| IO.userError s!"duplicate VIR web-assets program id: {id}"
    ids := ids.push id
    let package? := (← virOptionalJsonString "VIR web-assets program" programJson "package").map
      String.toName
    programs := programs.push { id, package?, moduleName }
  return programs

private structure VirResolvedWebProgram where
  config : VirWebProgramConfig
  module : Module

private def virResolveWebProgram (config : VirWebProgramConfig) : FetchM VirResolvedWebProgram := do
  let module ← match config.package? with
  | some packageName =>
      let some programPkg ← findPackageByName? packageName
        | error s!"VIR web-assets package `{packageName}` was not found"
      let some module := programPkg.findTargetModule? config.moduleName
        | error s!"VIR web-assets module `{config.moduleName}` was not found in package `{packageName}`"
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

/--
Compose the root application's `vir-web-assets.json` into one deployable
directory containing one matching SDK and one or more VIR package sets.
-/
package_facet virWebAssets (pkg : Package) : System.FilePath := do
  let identity ← virSourceIdentity
  let configPath := pkg.dir / "vir-web-assets.json"
  let configs ← virReadWebAssetsConfig configPath
  let programs ← configs.mapM virResolveWebProgram
  let composerJob ← vir_web_assets.fetch
  let sdkJob ← pkg.fetchFacetJob `virSdk
  let descriptorJobs ← programs.mapM fun program => program.module.fetchFacetJob `vir
  let descriptorsJob := Job.collectArray descriptorJobs "VIR web programs"
  let sdkManifest := pkg.buildDir / "vir" / "sdk" / "lean-vir-artifact.json"
  let outputDir := pkg.buildDir / "vir" / "web-assets"
  let outputManifest := outputDir / "VIR_WEB_ASSETS.json"
  composerJob.bindM fun composer =>
    sdkJob.bindM fun _ =>
      descriptorsJob.mapM fun _ => do
        addTrace (← computeTrace composer)
        addTrace (← computeTrace configPath)
        addTrace (← computeTrace sdkManifest)
        addPureTrace identity.version "lean_vir version"
        if let some commit := identity.commit? then
          addPureTrace commit "lean_vir source revision"
        let mut args := #[
          "--out", outputDir.toString,
          "--sdk-manifest", sdkManifest.toString,
          "--vir-version", identity.version,
          "--vir-commit", identity.commit?.getD "",
          "--host-package", pkg.baseName.toString
        ]
        for program in programs do
          let descriptor := virModuleOutput program.module "module-sets" "irpkg-set.json"
          addTrace (← computeTrace descriptor)
          args := args ++ #[
            "--program",
            program.config.id,
            program.module.pkg.baseName.toString,
            program.module.name.toString,
            descriptor.toString
          ]
        proc {
          cmd := composer.toString
          args
          env := ← getAugmentedEnv
        }
        return outputManifest
