/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Lean

open Lean
open System

namespace Vir.FetchSdk

def sdkVersion : String := "0.1.0"

def sdkRuntimeAbiVersion : Nat := 1

structure Options where
  out : FilePath := "web/public/vendor/lean-vir"
  archive? : Option String := none
  url? : Option String := none
  tag? : Option String := none
  commit? : Option String := none
  localSource? : Option String := none
  fallbackLocalSource? : Option String := none
  expectCommit? : Option String := none
  expectVersion : String := sdkVersion
  artifactName : String := "lean-vir-sdk"
  repo : String := "ejgallego/lean-vir"
  verifyInstalled : Bool := false
  expectCurrentLean : Bool := false

def usage : String :=
  "usage: lake exe lean_vir/vir_fetch_sdk [--out DIR] [--archive FILE | --url URL | --tag TAG | --commit SHA [--repo OWNER/REPO] [--fallback-local-source DIR] | --local-source DIR]\n" ++
  "       lake exe lean_vir/vir_fetch_sdk --verify-installed DIR [--expect-version VERSION] [--expect-commit SHA] [--expect-current-lean]\n\n" ++
  "Installs a lean-vir-sdk.tar.gz archive into DIR and verifies lean-vir-artifact.json checksums.\n\n" ++
  s!"The default source is release v{sdkVersion}. Use --local-source to build an SDK for the current Lean toolchain.\n" ++
  "Use --expect-version VERSION, --expect-commit SHA, and --expect-current-lean to reject a mismatched SDK.\n\n" ++
  "Environment fallbacks: VIR_SDK_ARCHIVE, VIR_SDK_URL, VIR_SDK_TAG, VIR_SDK_COMMIT, VIR_SDK_EXPECT_COMMIT, VIR_SDK_REPO."

partial def parseArgs (args : List String) (opts : Options := {}) : Except String Options :=
  match args with
  | [] => .ok opts
  | "--out" :: value :: rest => parseArgs rest { opts with out := FilePath.mk value }
  | "--archive" :: value :: rest => parseArgs rest { opts with archive? := some value }
  | "--url" :: value :: rest => parseArgs rest { opts with url? := some value }
  | "--tag" :: value :: rest => parseArgs rest { opts with tag? := some value }
  | "--commit" :: value :: rest => parseArgs rest { opts with commit? := some value }
  | "--local-source" :: value :: rest => parseArgs rest { opts with localSource? := some value }
  | "--fallback-local-source" :: value :: rest =>
      parseArgs rest { opts with fallbackLocalSource? := some value }
  | "--expect-commit" :: value :: rest => parseArgs rest { opts with expectCommit? := some value }
  | "--expect-version" :: value :: rest => parseArgs rest { opts with expectVersion := value }
  | "--expect-current-lean" :: rest => parseArgs rest { opts with expectCurrentLean := true }
  | "--artifact-name" :: value :: rest => parseArgs rest { opts with artifactName := value }
  | "--repo" :: value :: rest => parseArgs rest { opts with repo := value }
  | "--verify-installed" :: value :: rest =>
      parseArgs rest { opts with out := FilePath.mk value, verifyInstalled := true }
  | "--help" :: _ => .error usage
  | "-h" :: _ => .error usage
  | arg :: _ => .error s!"unknown argument: {arg}\n\n{usage}"

inductive Source where
  | archive (path : String)
  | url (url : String)
  | commit (sha : String)
  | local (sourceDir : FilePath)

def redactCommandArgs (args : Array String) : Array String :=
  args.map fun arg =>
    if arg.startsWith "Authorization:" then
      "Authorization: <redacted>"
    else
      arg

def run (cmd : String) (args : Array String) : IO String := do
  let out ← IO.Process.output { cmd := cmd, args := args }
  if out.exitCode != 0 then
    let stderr := out.stderr.trimAscii.toString
    let stdout := out.stdout.trimAscii.toString
    let detail :=
      if stderr.isEmpty then stdout else stderr
    let displayArgs := redactCommandArgs args
    throw <| IO.userError s!"{cmd} {String.intercalate " " displayArgs.toList} failed ({out.exitCode}): {detail}"
  return out.stdout.trimAscii.toString

def jsonField (json : Json) (field : String) (read : Json → Except String α) : IO α := do
  match json.getObjVal? field >>= read with
  | .ok value => pure value
  | .error err => throw <| IO.userError s!"invalid lean-vir-artifact.json field `{field}`: {err}"

def readJsonFile (path : FilePath) : IO Json := do
  let text ← IO.FS.readFile path
  match Json.parse text with
  | .ok json => pure json
  | .error err => throw <| IO.userError s!"failed to parse {path}: {err}"

def sourceFromOptions (opts : Options) : IO Source := do
  match opts.archive? with
  | some archive => return .archive archive
  | none =>
      match opts.url? with
      | some url => return .url url
      | none =>
          match opts.tag? with
          | some tag =>
              return .url s!"https://github.com/{opts.repo}/releases/download/{tag}/lean-vir-sdk.tar.gz"
          | none =>
              match opts.commit? with
              | some commit => return .commit commit
              | none =>
                  match opts.localSource? with
                  | some sourceDir => return .local (FilePath.mk sourceDir)
                  | none =>
                      let archive? ← IO.getEnv "VIR_SDK_ARCHIVE"
                      match archive? with
                      | some archive => return .archive archive
                      | none =>
                          let url? ← IO.getEnv "VIR_SDK_URL"
                          match url? with
                          | some url => return .url url
                          | none =>
                              let tag? ← IO.getEnv "VIR_SDK_TAG"
                              let commit? ← IO.getEnv "VIR_SDK_COMMIT"
                              let repo ← IO.getEnv "VIR_SDK_REPO"
                              match tag? with
                              | some tag =>
                                  let repo := repo.getD opts.repo
                                  return .url s!"https://github.com/{repo}/releases/download/{tag}/lean-vir-sdk.tar.gz"
                              | none =>
                                  match commit? with
                                  | some commit => return .commit commit
                                  | none =>
                                      let repo := repo.getD opts.repo
                                      return .url s!"https://github.com/{repo}/releases/download/v{sdkVersion}/lean-vir-sdk.tar.gz"

def expectedCommitFromOptions (opts : Options) : IO (Option String) := do
  match opts.expectCommit? with
  | some commit => return some commit
  | none =>
      match opts.commit? with
      | some commit => return some commit
      | none =>
          match (← IO.getEnv "VIR_SDK_EXPECT_COMMIT") with
          | some commit => return some commit
          | none => IO.getEnv "VIR_SDK_COMMIT"

def githubToken? : IO (Option String) := do
  match (← IO.getEnv "GITHUB_TOKEN") with
  | some token => return some token
  | none =>
      try
        let token ← run "gh" #["auth", "token"]
        let token := token.trimAscii.toString
        if token.isEmpty then
          return none
        else
          return some token
      catch _ =>
        return none

def needsGitHubAuthentication (url : String) : Bool :=
  url.startsWith "https://api.github.com/"

def fetchUrl (url : String) (dest : FilePath) : IO Unit := do
  if let some parent := dest.parent then
    IO.FS.createDirAll parent
  let mut args := #[
    "--fail",
    "--location",
    "--show-error",
    "--silent",
    "-H", "Accept: application/vnd.github+json",
    "-H", "X-GitHub-Api-Version: 2022-11-28"
  ]
  if needsGitHubAuthentication url then
    if let some token ← githubToken? then
      args := (args.push "-H").push s!"Authorization: Bearer {token}"
  args := ((args.push "--output").push dest.toString).push url
  discard <| run "curl" args

def sha256 (path : FilePath) : IO String :=
  run "node" #[
    "-e",
    "const fs=require('node:fs'),c=require('node:crypto');process.stdout.write(c.createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex'))",
    path.toString
  ]

def findArtifactUrl? (json : Json) (artifactName : String) : IO (Option String × Bool) := do
  let artifacts ← jsonField json "artifacts" Json.getArr?
  let mut found? := none
  let mut sawExpired := false
  for artifact in artifacts do
    let name ← jsonField artifact "name" Json.getStr?
    if name == artifactName then
      let expired ← jsonField artifact "expired" Json.getBool?
      if expired then
        sawExpired := true
      else if found?.isNone then
        found? := some (← jsonField artifact "archive_download_url" Json.getStr?)
  return (found?, sawExpired)

def workflowRunIds (json : Json) : IO (Array Nat) := do
  let runs ← jsonField json "workflow_runs" Json.getArr?
  runs.mapM fun workflowRun => jsonField workflowRun "id" Json.getNat?

partial def collectWorkflowRunPages
    (loadPage : Nat → IO Json)
    (page : Nat := 1)
    (ids : Array Nat := #[]) : IO (Array Nat) := do
  let pageIds ← workflowRunIds (← loadPage page)
  let ids := ids ++ pageIds
  if pageIds.size < 100 then
    return ids
  collectWorkflowRunPages loadPage (page + 1) ids

partial def findArtifactAcrossPages
    (artifactName : String)
    (loadPage : Nat → IO Json)
    (page : Nat := 1)
    (sawExpired : Bool := false) : IO (Option String × Bool) := do
  let json ← loadPage page
  let artifacts ← jsonField json "artifacts" Json.getArr?
  let (url?, pageExpired) ← findArtifactUrl? json artifactName
  let sawExpired := sawExpired || pageExpired
  if let some url := url? then
    return (some url, sawExpired)
  if artifacts.size < 100 then
    return (none, sawExpired)
  findArtifactAcrossPages artifactName loadPage (page + 1) sawExpired

def fetchWorkflowRunIds
    (opts : Options)
    (commit : String)
    (tmpRoot : FilePath) : IO (Array Nat) := do
  collectWorkflowRunPages fun page => do
    let listingPath := tmpRoot / s!"workflow-runs-{page}.json"
    let url := s!"https://api.github.com/repos/{opts.repo}/actions/runs?head_sha={commit}&per_page=100&page={page}"
    fetchUrl url listingPath
    readJsonFile listingPath

def findWorkflowArtifactUrl
    (opts : Options)
    (runId : Nat)
    (tmpRoot : FilePath) : IO (Option String × Bool) := do
  findArtifactAcrossPages opts.artifactName fun page => do
    let listingPath := tmpRoot / s!"artifacts-{runId}-{page}.json"
    let url := s!"https://api.github.com/repos/{opts.repo}/actions/runs/{runId}/artifacts?name={opts.artifactName}&per_page=100&page={page}"
    fetchUrl url listingPath
    readJsonFile listingPath

def fetchCommitArchive (opts : Options) (commit : String) (dest : FilePath) : IO Unit := do
  let tmpRoot ← IO.FS.createTempDir
  let zipPath := tmpRoot / "artifact.zip"
  let unpackDir := tmpRoot / "artifact"
  try
    let runIds ← fetchWorkflowRunIds opts commit tmpRoot
    let mut downloadUrl? := none
    let mut sawExpired := false
    for runId in runIds do
      let (url?, runExpired) ← findWorkflowArtifactUrl opts runId tmpRoot
      sawExpired := sawExpired || runExpired
      if downloadUrl?.isNone then
        downloadUrl? := url?
    let some downloadUrl := downloadUrl? | do
      if sawExpired then
        throw <| IO.userError s!"GitHub Actions artifact `{opts.artifactName}` for commit {commit} has expired"
      throw <| IO.userError <| s!"no GitHub Actions artifact `{opts.artifactName}` found for " ++
        s!"{opts.repo}@{commit}; commit artifacts require GitHub authentication and are retained only temporarily"
    fetchUrl downloadUrl zipPath
    IO.FS.createDirAll unpackDir
    discard <| run "unzip" #["-q", zipPath.toString, "-d", unpackDir.toString]
    let archive := unpackDir / "lean-vir-sdk.tar.gz"
    unless (← archive.pathExists) do
      throw <| IO.userError s!"GitHub Actions artifact `{opts.artifactName}` did not contain lean-vir-sdk.tar.gz"
    if let some parent := dest.parent then
      IO.FS.createDirAll parent
    IO.FS.writeBinFile dest (← IO.FS.readBinFile archive)
  finally
    try
      IO.FS.removeDirAll tmpRoot
    catch _ =>
      pure ()

def verifySdkFiles (sdkDir : FilePath) (manifest : Json) : IO Unit := do
  let files ← jsonField manifest "files" Json.getArr?
  for file in files do
    let relPath ← jsonField file "path" Json.getStr?
    let expected ← jsonField file "sha256" Json.getStr?
    let filePath := sdkDir / FilePath.mk relPath
    let actual ← sha256 filePath
    if actual != expected then
      throw <| IO.userError s!"checksum mismatch for {relPath}: expected {expected}, got {actual}"

def verifyInstalledSdk
    (sdkDir : FilePath)
    (expectVersion : String)
    (expectCommit? : Option String)
    (expectCurrentLean : Bool) : IO Unit := do
  let manifestPath := sdkDir / "lean-vir-artifact.json"
  let manifest ← readJsonFile manifestPath
  let name ← jsonField manifest "name" Json.getStr?
  if name != "lean-vir-sdk" then
    throw <| IO.userError s!"expected SDK manifest name `lean-vir-sdk`, got `{name}`"
  let version ← jsonField manifest "version" Json.getStr?
  if version != expectVersion then
    throw <| IO.userError s!"SDK version mismatch: expected {expectVersion}, got {version}"
  let abi ← jsonField manifest "runtimeAbiVersion" Json.getNat?
  if abi != sdkRuntimeAbiVersion then
    throw <| IO.userError s!"unsupported SDK runtime ABI version: {abi}"
  let actualCommit ← jsonField manifest "gitCommit" Json.getStr?
  if actualCommit.isEmpty then
    throw <| IO.userError "SDK manifest gitCommit must not be empty"
  if let some expectCommit := expectCommit? then
    if actualCommit != expectCommit then
      throw <| IO.userError s!"SDK commit mismatch: expected {expectCommit}, got {actualCommit}"
  let gitDirty ← jsonField manifest "gitDirty" Json.getBool?
  if gitDirty then
    throw <| IO.userError "SDK manifest records a dirty VIR source tree; only clean exact source identities may be installed"
  if expectCurrentLean then
    let toolchain ← jsonField manifest "leanToolchain" Json.getStr?
    if toolchain.isEmpty then
      throw <| IO.userError "SDK Lean toolchain token must not be empty"
    let version ← jsonField manifest "leanVersionString" Json.getStr?
    if version != Lean.versionString then
      throw <| IO.userError s!"SDK Lean version mismatch: expected {Lean.versionString}, got {version}"
    let githash ← jsonField manifest "leanGithash" Json.getStr?
    if githash != Lean.githash then
      throw <| IO.userError s!"SDK Lean git hash mismatch: expected {Lean.githash}, got {githash}"
  verifySdkFiles sdkDir manifest

partial def copyDirectoryContents (source dest : FilePath) : IO Unit := do
  IO.FS.createDirAll dest
  for entry in ← source.readDir do
    let target := dest / entry.fileName
    if ← entry.path.isDir then
      copyDirectoryContents entry.path target
    else
      IO.FS.writeBinFile target (← IO.FS.readBinFile entry.path)

def replaceInstalledDirectory (source outDir : FilePath) : IO Unit := do
  let parent := outDir.parent.getD "."
  IO.FS.createDirAll parent
  let stamp ← IO.monoMsNow
  let stageDir := parent / s!".lean-vir-sdk-install-{stamp}"
  if ← stageDir.pathExists then
    IO.FS.removeDirAll stageDir
  try
    copyDirectoryContents source stageDir
    if ← outDir.pathExists then
      IO.FS.removeDirAll outDir
    IO.FS.rename stageDir outDir
  catch error =>
    if ← stageDir.pathExists then
      IO.FS.removeDirAll stageDir
    throw error

def installArchive
    (archive : FilePath)
    (outDir : FilePath)
    (expectVersion : String)
    (expectCommit? : Option String)
    (expectCurrentLean : Bool) : IO Unit := do
  let tmpRoot ← IO.FS.createTempDir
  let unpackDir := tmpRoot / "unpack"
  let sdkDir := unpackDir / "lean-vir-sdk"
  try
    IO.FS.createDirAll unpackDir
    discard <| run "tar" #["-xzf", archive.toString, "-C", unpackDir.toString]
    verifyInstalledSdk sdkDir expectVersion expectCommit? expectCurrentLean
    replaceInstalledDirectory sdkDir outDir
  finally
    try
      IO.FS.removeDirAll tmpRoot
    catch _ =>
      pure ()

def fetchArchive (url : String) (dest : FilePath) : IO Unit :=
  fetchUrl url dest

def installLocalSdk
    (sourceDir outDir : FilePath)
    (expectVersion : String)
    (expectCommit? : Option String)
    (expectCurrentLean : Bool) : IO Unit := do
  let some expectCommit := expectCommit?
    | throw <| IO.userError "a local SDK build requires --expect-commit"
  unless expectCurrentLean do
    throw <| IO.userError "a local SDK build requires --expect-current-lean"
  let script := sourceDir / "scripts/packages/build-local-sdk.mjs"
  unless (← script.pathExists) do
    throw <| IO.userError s!"resolved lean_vir package is missing local SDK builder: {script}"
  let tmpRoot ← IO.FS.createTempDir
  let sdkDir := tmpRoot / "lean-vir-sdk"
  let cacheDir := outDir.parent.getD "." / "sdk-build-cache"
  try
    IO.FS.createDirAll tmpRoot
    discard <| run "node" #[
      script.toString,
      "--out", sdkDir.toString,
      "--cache", cacheDir.toString,
      "--expect-version", expectVersion,
      "--expect-commit", expectCommit,
      "--lean-toolchain", Lean.toolchain,
      "--lean-version", Lean.versionString,
      "--lean-githash", Lean.githash
    ]
    verifyInstalledSdk sdkDir expectVersion expectCommit? expectCurrentLean
    replaceInstalledDirectory sdkDir outDir
  finally
    try
      IO.FS.removeDirAll tmpRoot
    catch _ =>
      pure ()

def installCommitSdk
    (opts : Options)
    (commit : String)
    (archive : FilePath)
    (expectCommit? : Option String) : IO Unit := do
  try
    IO.println s!"trying GitHub Actions artifact {opts.artifactName} for {opts.repo}@{commit}"
    fetchCommitArchive opts commit archive
    installArchive archive opts.out opts.expectVersion expectCommit? opts.expectCurrentLean
  catch artifactError =>
    let some fallbackSource := opts.fallbackLocalSource?
      | throw artifactError
    IO.eprintln <| s!"commit artifact unavailable ({artifactError}); " ++
      "building the exact Lean-toolchain-compatible SDK locally"
    installLocalSdk (FilePath.mk fallbackSource) opts.out opts.expectVersion expectCommit?
      opts.expectCurrentLean

def runMain (args : List String) : IO UInt32 := do
  match parseArgs args with
  | .error err =>
      IO.eprintln err
      return if err == usage then (0 : UInt32) else (2 : UInt32)
  | .ok opts => do
      try
        let expectCommit? ← expectedCommitFromOptions opts
        if opts.verifyInstalled then
          verifyInstalledSdk opts.out opts.expectVersion expectCommit? opts.expectCurrentLean
          IO.println s!"verified {opts.out}"
          return (0 : UInt32)
        let source ← sourceFromOptions opts
        match source with
        | .archive path =>
            installArchive (FilePath.mk path) opts.out opts.expectVersion expectCommit?
              opts.expectCurrentLean
        | .url url =>
            let tmpRoot ← IO.FS.createTempDir
            let archive := tmpRoot / "lean-vir-sdk.tar.gz"
            try
              IO.println s!"downloading {url}"
              fetchArchive url archive
              installArchive archive opts.out opts.expectVersion expectCommit? opts.expectCurrentLean
            finally
              try IO.FS.removeDirAll tmpRoot catch _ => pure ()
        | .commit commit =>
            let tmpRoot ← IO.FS.createTempDir
            let archive := tmpRoot / "lean-vir-sdk.tar.gz"
            try
              installCommitSdk opts commit archive expectCommit?
            finally
              try IO.FS.removeDirAll tmpRoot catch _ => pure ()
        | .local sourceDir =>
            IO.println s!"building Lean-toolchain-compatible SDK from {sourceDir}"
            installLocalSdk sourceDir opts.out opts.expectVersion expectCommit? opts.expectCurrentLean
        IO.println s!"installed {opts.out}"
        return (0 : UInt32)
      catch error =>
        IO.eprintln s!"error: {error}"
        return (1 : UInt32)

end Vir.FetchSdk

unsafe def main (args : List String) : IO UInt32 :=
  Vir.FetchSdk.runMain args
