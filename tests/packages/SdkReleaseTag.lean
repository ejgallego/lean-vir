/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/
import tools.VirFetchSdk

open Vir.FetchSdk

private def select (args : List String) : IO Source := do
  match parseArgs args with
  | .ok options => sourceFromOptions options
  | .error message => throw <| IO.userError message

private def expectUrl (args : List String) (expected : String) : IO Unit := do
  match ← select args with
  | .url actual =>
    unless actual == expected do
      throw <| IO.userError s!"expected SDK URL {expected}, got {actual}"
  | _ => throw <| IO.userError "expected an SDK URL"

#eval do
  for (version, expected) in [
    ("4.35.0-rc4", "4.35-rc4"), ("4.35.0", "4.35"),
    ("4.35.1", "4.35.1"), ("4.36.0-rc1", "4.36-rc1")] do
    unless releaseTagForVersion version == expected do
      throw <| IO.userError s!"wrong release tag for {version}"
  unless sdkReleaseTag == "4.36-rc1" do
    throw <| IO.userError s!"wrong pinned Lean SDK release: {sdkReleaseTag}"
  expectUrl [] "https://github.com/ejgallego/lean-vir/releases/download/4.36-rc1/lean-vir-sdk.tar.gz"
  expectUrl ["--repo", "owner/custom"] "https://github.com/owner/custom/releases/download/4.36-rc1/lean-vir-sdk.tar.gz"
  expectUrl ["--tag", "selected-release"] "https://github.com/ejgallego/lean-vir/releases/download/selected-release/lean-vir-sdk.tar.gz"
  expectUrl ["--url", "https://example.test/sdk.tar.gz"] "https://example.test/sdk.tar.gz"
  match ← select ["--archive", "/tmp/selected-sdk.tar.gz"] with
  | .archive actual => unless actual == "/tmp/selected-sdk.tar.gz" do throw <| IO.userError "archive override changed"
  | _ => throw <| IO.userError "archive override ignored"
  match ← select ["--commit", "selected-commit"] with
  | .commit actual => unless actual == "selected-commit" do throw <| IO.userError "commit override changed"
  | _ => throw <| IO.userError "commit override ignored"
  IO.println "11 SDK release-tag/source controls passed (no download)"
