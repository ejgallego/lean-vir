/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import tools.VirFetchSdk

open Lean
open Vir.FetchSdk

private def artifact (name url : String) (expired : Bool) : Json :=
  Json.mkObj [
    ("name", .str name),
    ("expired", .bool expired),
    ("archive_download_url", .str url)
  ]

private def artifactPage (artifacts : Array Json) : Json :=
  Json.mkObj [("artifacts", .arr artifacts)]

private def workflowPage (ids : Array Nat) : Json :=
  Json.mkObj [("workflow_runs", .arr <| ids.map fun id => Json.mkObj [("id", toJson id)])]

private def assertIO (condition : Bool) (message : String) : IO Unit :=
  unless condition do
    throw <| IO.userError message

private def runTests : IO Unit := do
  let runIds ← collectWorkflowRunPages fun page =>
    if page == 1 then
      pure <| workflowPage (Array.range 100)
    else
      pure <| workflowPage #[100, 101]
  assertIO (runIds.size == 102 && runIds.back? == some 101)
    "workflow-run lookup did not continue beyond the first API page"

  let irrelevant := Array.replicate 100 (artifact "other" "https://example.invalid/other" false)
  let (url?, sawExpired) ← findArtifactAcrossPages "lean-vir-sdk" fun page =>
    if page == 1 then
      pure <| artifactPage irrelevant
    else
      pure <| artifactPage #[artifact "lean-vir-sdk" "https://example.invalid/sdk" false]
  assertIO (url? == some "https://example.invalid/sdk" && !sawExpired)
    "artifact lookup did not continue beyond the first API page"

  let (expiredUrl?, sawExpired) ← findArtifactAcrossPages "lean-vir-sdk" fun _ =>
    pure <| artifactPage #[artifact "lean-vir-sdk" "https://example.invalid/expired" true]
  assertIO (expiredUrl?.isNone && sawExpired)
    "expired artifact was not distinguished from a missing artifact"

#eval runTests
