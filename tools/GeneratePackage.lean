/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.GeneratePackage

open Lean
open Vir.GeneratePackage

partial def takeTargetRoots : List String -> List String -> List String × List String
  | [], roots => (roots.reverse, [])
  | "--target" :: rest, roots => (roots.reverse, "--target" :: rest)
  | "--package-target" :: rest, roots => (roots.reverse, "--package-target" :: rest)
  | "--target-all" :: rest, roots => (roots.reverse, "--target-all" :: rest)
  | "--target-marked" :: rest, roots => (roots.reverse, "--target-marked" :: rest)
  | "--target-marked-module" :: rest, roots => (roots.reverse, "--target-marked-module" :: rest)
  | root :: rest, roots => takeTargetRoots rest (root :: roots)

partial def parseTargets : List String -> Except String (Array Vir.GeneratePackage.Target)
  | [] => pure #[]
  | "--target" :: source :: rest => do
      let (roots, rest) := takeTargetRoots rest []
      if roots.isEmpty then
        throw s!"target `{source}` has no roots"
      let roots ← roots.toArray.mapM parseDottedName
      let target : Vir.GeneratePackage.Target :=
        {
          source := source
          mode := .explicit roots
        }
      return (#[target] ++ (← parseTargets rest))
  | "--package-target" :: source :: rest => do
      let (roots, rest) := takeTargetRoots rest []
      if roots.isEmpty then
        throw s!"package target `{source}` has no roots"
      let roots ← roots.toArray.mapM parseDottedName
      let target : Vir.GeneratePackage.Target :=
        {
          source := source
          mode := .packageOnly roots
        }
      return (#[target] ++ (← parseTargets rest))
  | "--target-all" :: source :: rest => do
      let target : Vir.GeneratePackage.Target :=
        {
          source := source
          mode := .all
        }
      return (#[target] ++ (← parseTargets rest))
  | "--target-marked" :: source :: rest => do
      let target : Vir.GeneratePackage.Target :=
        {
          source := source
          mode := .marked
        }
      return (#[target] ++ (← parseTargets rest))
  | "--target-marked-module" :: source :: moduleName :: rest => do
      let moduleName ← parseDottedName moduleName
      let target : Vir.GeneratePackage.Target := {
        source := source
        mode := .markedModule moduleName
      }
      return (#[target] ++ (← parseTargets rest))
  | arg :: _ =>
      throw s!"expected `--target`, `--package-target`, `--target-all`, `--target-marked`, or `--target-marked-module`, got `{arg}`"

unsafe def main (args : List String) : IO UInt32 := do
  match args with
  | [packagePath, reportPath] =>
      Vir.GeneratePackage.run Vir.GeneratePackage.defaultTargets packagePath reportPath
  | packagePath :: reportPath :: targetArgs =>
      match targetArgs with
      | "--module-set-output" :: descriptorPath :: shardDir :: moduleName ::
          rootRelativePath :: shardRelativeDir :: targetArgs =>
          match parseDottedName moduleName, parseTargets targetArgs with
          | .ok rootModule, .ok targets =>
              Vir.GeneratePackage.runModuleSet targets rootModule
                packagePath descriptorPath shardDir rootRelativePath shardRelativeDir reportPath
          | .error err, _ | _, .error err =>
              IO.eprintln err
              return 2
      | _ =>
          match parseTargets targetArgs with
          | .ok targets => Vir.GeneratePackage.run targets packagePath reportPath
          | .error err =>
              IO.eprintln err
              return 2
  | _ =>
      IO.eprintln "usage: lean --run tools/GeneratePackage.lean <package.irpkg> <report.md> [--module-set-output <set.json> <shard-dir> <root-module> <root-relative-path> <shard-relative-dir>] [--target <source.lean> <root>... | --package-target <source.lean> <root>... | --target-all <source.lean> | --target-marked <source.lean> | --target-marked-module <driver.lean> <module>]"
      return 2
