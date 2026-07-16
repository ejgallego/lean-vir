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

structure Options where
  out : FilePath := "web/public/vendor/lean-vir"
  archive? : Option String := none
  url? : Option String := none
  tag? : Option String := none
  commit? : Option String := none
  expectCommit? : Option String := none
  expectVersion : String := sdkVersion
  artifactName : String := "lean-vir-sdk"
  repo : String := "ejgallego/lean-vir"
  verifyInstalled : Bool := false

def usage : String :=
  "usage: lake exe lean_vir/vir_fetch_sdk [--out DIR] [--archive FILE | --url URL | --tag TAG | --commit SHA [--repo OWNER/REPO]]\n" ++
  "       lake exe lean_vir/vir_fetch_sdk --verify-installed DIR [--expect-version VERSION] [--expect-commit SHA]\n\n" ++
  "Installs a lean-vir-sdk.tar.gz archive into DIR and verifies lean-vir-artifact.json checksums.\n\n" ++
  s!"The default source is release v{sdkVersion}. Use --expect-version VERSION or --expect-commit SHA to reject a mismatched SDK.\n\n" ++
  "Environment fallbacks: VIR_SDK_ARCHIVE, VIR_SDK_URL, VIR_SDK_TAG, VIR_SDK_COMMIT, VIR_SDK_EXPECT_COMMIT, VIR_SDK_REPO."

partial def parseArgs (args : List String) (opts : Options := {}) : Except String Options :=
  match args with
  | [] => .ok opts
  | "--out" :: value :: rest => parseArgs rest { opts with out := FilePath.mk value }
  | "--archive" :: value :: rest => parseArgs rest { opts with archive? := some value }
  | "--url" :: value :: rest => parseArgs rest { opts with url? := some value }
  | "--tag" :: value :: rest => parseArgs rest { opts with tag? := some value }
  | "--commit" :: value :: rest => parseArgs rest { opts with commit? := some value }
  | "--expect-commit" :: value :: rest => parseArgs rest { opts with expectCommit? := some value }
  | "--expect-version" :: value :: rest => parseArgs rest { opts with expectVersion := value }
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

def findCommitArtifactUrl (json : Json) (artifactName : String) (commit : String) : IO String := do
  let artifacts ← jsonField json "artifacts" Json.getArr?
  let mut found? := none
  let mut sawExpired := false
  for artifact in artifacts do
    let name ← jsonField artifact "name" Json.getStr?
    if name == artifactName then
      let workflowRun ←
        match artifact.getObjVal? "workflow_run" with
        | .ok value => pure value
        | .error err => throw <| IO.userError s!"invalid artifact workflow_run field: {err}"
      let headSha ← jsonField workflowRun "head_sha" Json.getStr?
      if headSha == commit then
        let expired ← jsonField artifact "expired" Json.getBool?
        if expired then
          sawExpired := true
        else
          found? := some (← jsonField artifact "archive_download_url" Json.getStr?)
  match found? with
  | some url => return url
  | none =>
      if sawExpired then
        throw <| IO.userError s!"GitHub Actions artifact `{artifactName}` for commit {commit} has expired"
      throw <| IO.userError s!"no GitHub Actions artifact `{artifactName}` found for commit {commit} in this repository"

def fetchCommitArchive (opts : Options) (commit : String) (dest : FilePath) : IO Unit := do
  let stamp ← IO.monoMsNow
  let tmpRoot := FilePath.mk s!"/tmp/lean-vir-sdk-github-artifact-{stamp}"
  let listingPath := tmpRoot / "artifacts.json"
  let zipPath := tmpRoot / "artifact.zip"
  let unpackDir := tmpRoot / "artifact"
  try
    IO.FS.createDirAll tmpRoot
    let listUrl := s!"https://api.github.com/repos/{opts.repo}/actions/artifacts?name={opts.artifactName}&per_page=100"
    fetchUrl listUrl listingPath
    let listing ← readJsonFile listingPath
    let downloadUrl ← findCommitArtifactUrl listing opts.artifactName commit
    fetchUrl downloadUrl zipPath
    IO.FS.createDirAll unpackDir
    discard <| run "unzip" #["-q", zipPath.toString, "-d", unpackDir.toString]
    let archive := unpackDir / "lean-vir-sdk.tar.gz"
    unless (← archive.pathExists) do
      throw <| IO.userError s!"GitHub Actions artifact `{opts.artifactName}` did not contain lean-vir-sdk.tar.gz"
    if let some parent := dest.parent then
      IO.FS.createDirAll parent
    discard <| run "mv" #[archive.toString, dest.toString]
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
    let hashLine ← run "sha256sum" #[filePath.toString]
    let actual := (hashLine.splitOn " ").head?.getD ""
    if actual != expected then
      throw <| IO.userError s!"checksum mismatch for {relPath}: expected {expected}, got {actual}"

def verifyInstalledSdk
    (sdkDir : FilePath)
    (expectVersion : String)
    (expectCommit? : Option String) : IO Unit := do
  let manifestPath := sdkDir / "lean-vir-artifact.json"
  let manifest ← readJsonFile manifestPath
  let name ← jsonField manifest "name" Json.getStr?
  if name != "lean-vir-sdk" then
    throw <| IO.userError s!"expected SDK manifest name `lean-vir-sdk`, got `{name}`"
  let version ← jsonField manifest "version" Json.getStr?
  if version != expectVersion then
    throw <| IO.userError s!"SDK version mismatch: expected {expectVersion}, got {version}"
  let abi ← jsonField manifest "runtimeAbiVersion" Json.getNat?
  if abi != 1 then
    throw <| IO.userError s!"unsupported SDK runtime ABI version: {abi}"
  let actualCommit ← jsonField manifest "gitCommit" Json.getStr?
  if actualCommit.isEmpty then
    throw <| IO.userError "SDK manifest gitCommit must not be empty"
  if let some expectCommit := expectCommit? then
    if actualCommit != expectCommit then
      throw <| IO.userError s!"SDK commit mismatch: expected {expectCommit}, got {actualCommit}"
  verifySdkFiles sdkDir manifest

def installArchive
    (archive : FilePath)
    (outDir : FilePath)
    (expectVersion : String)
    (expectCommit? : Option String) : IO Unit := do
  let stamp ← IO.monoMsNow
  let tmpRoot := FilePath.mk s!"/tmp/lean-vir-sdk-fetch-{stamp}"
  let unpackDir := tmpRoot / "unpack"
  let sdkDir := unpackDir / "lean-vir-sdk"
  try
    IO.FS.createDirAll unpackDir
    discard <| run "tar" #["-xzf", archive.toString, "-C", unpackDir.toString]
    verifyInstalledSdk sdkDir expectVersion expectCommit?
    if ← outDir.pathExists then
      IO.FS.removeDirAll outDir
    if let some parent := outDir.parent then
      IO.FS.createDirAll parent
    discard <| run "mv" #[sdkDir.toString, outDir.toString]
  finally
    try
      IO.FS.removeDirAll tmpRoot
    catch _ =>
      pure ()

def fetchArchive (url : String) (dest : FilePath) : IO Unit :=
  fetchUrl url dest

def runMain (args : List String) : IO UInt32 := do
  match parseArgs args with
  | .error err =>
      IO.eprintln err
      return if err == usage then (0 : UInt32) else (2 : UInt32)
  | .ok opts => do
      try
        let expectCommit? ← expectedCommitFromOptions opts
        if opts.verifyInstalled then
          verifyInstalledSdk opts.out opts.expectVersion expectCommit?
          IO.println s!"verified {opts.out}"
          return (0 : UInt32)
        let source ← sourceFromOptions opts
        let (archive, cleanup?) ←
          match source with
          | .archive path => pure (FilePath.mk path, none)
          | .url url =>
              let stamp ← IO.monoMsNow
              let archive := FilePath.mk s!"/tmp/lean-vir-sdk-download-{stamp}.tar.gz"
              IO.println s!"downloading {url}"
              fetchArchive url archive
              pure (archive, some archive)
          | .commit commit =>
              let stamp ← IO.monoMsNow
              let archive := FilePath.mk s!"/tmp/lean-vir-sdk-download-{stamp}.tar.gz"
              IO.println s!"downloading GitHub Actions artifact {opts.artifactName} for {opts.repo}@{commit}"
              fetchCommitArchive opts commit archive
              pure (archive, some archive)
        try
          installArchive archive opts.out opts.expectVersion expectCommit?
        finally
          if let some cleanup := cleanup? then
            try
              IO.FS.removeFile cleanup
            catch _ =>
              pure ()
        IO.println s!"installed {opts.out}"
        return (0 : UInt32)
      catch error =>
        IO.eprintln s!"error: {error}"
        return (1 : UInt32)

end Vir.FetchSdk

unsafe def main (args : List String) : IO UInt32 :=
  Vir.FetchSdk.runMain args
