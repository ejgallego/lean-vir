/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.GeneratePackage

open Lean
open Vir.GeneratePackage

inductive TargetFlag where
  | explicit
  | packageOnly
  | all
  | marked
  | markedModule

namespace TargetFlag

def option : TargetFlag → String
  | .explicit => "--target"
  | .packageOnly => "--package-target"
  | .all => "--target-all"
  | .marked => "--target-marked"
  | .markedModule => "--target-marked-module"

def values : Array TargetFlag := #[.explicit, .packageOnly, .all, .marked, .markedModule]

def parse? (text : String) : Option TargetFlag :=
  values.find? fun flag => flag.option == text

def alternatives : String :=
  ", ".intercalate (values.map (fun flag => s!"`{flag.option}`")).toList

end TargetFlag

def takeTargetRoots : List String -> List String -> List String × List String
  | [], roots => (roots.reverse, [])
  | arg :: rest, roots =>
      if arg.startsWith "--" then
        (roots.reverse, arg :: rest)
      else
        takeTargetRoots rest (arg :: roots)

partial def parseTargets.go
    (args : List String) (targets : Array Vir.GeneratePackage.Target) :
    Except String (Array Vir.GeneratePackage.Target) := do
  let flagText :: rest := args | return targets
  let some flag := TargetFlag.parse? flagText
    | throw s!"expected {TargetFlag.alternatives}, got `{flagText}`"
  match flag, rest with
  | .explicit, source :: rest =>
      let (roots, remaining) := takeTargetRoots rest []
      if roots.isEmpty then
        throw s!"target `{source}` has no roots"
      let roots ← roots.toArray.mapM Vir.parseDottedName
      let target : Vir.GeneratePackage.Target :=
        {
          source := source
          mode := .explicit roots
        }
      go remaining (targets.push target)
  | .packageOnly, source :: rest =>
      let (roots, remaining) := takeTargetRoots rest []
      if roots.isEmpty then
        throw s!"package target `{source}` has no roots"
      let roots ← roots.toArray.mapM Vir.parseDottedName
      let target : Vir.GeneratePackage.Target :=
        {
          source := source
          mode := .packageOnly roots
        }
      go remaining (targets.push target)
  | .all, source :: remaining =>
      let target : Vir.GeneratePackage.Target :=
        {
          source := source
          mode := .all
        }
      go remaining (targets.push target)
  | .marked, source :: remaining =>
      let target : Vir.GeneratePackage.Target :=
        {
          source := source
          mode := .marked
        }
      go remaining (targets.push target)
  | .markedModule, source :: moduleName :: remaining =>
      let moduleName ← Vir.parseDottedName moduleName
      let target : Vir.GeneratePackage.Target := {
        source := source
        mode := .markedModule moduleName
      }
      go remaining (targets.push target)
  | _, _ => throw s!"{flag.option} is missing its source or module argument"

def parseTargets (args : List String) : Except String (Array Vir.GeneratePackage.Target) :=
  parseTargets.go args #[]

unsafe def main (args : List String) : IO UInt32 := do
  match args with
  | [packagePath, reportPath] =>
      Vir.GeneratePackage.run Vir.GeneratePackage.defaultTargets packagePath reportPath
  | packagePath :: reportPath :: targetArgs =>
      match targetArgs with
      | "--module-set-output" :: descriptorPath :: shardDir :: moduleName ::
          rootRelativePath :: shardRelativeDir :: targetArgs =>
          match Vir.parseDottedName moduleName, parseTargets targetArgs with
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
