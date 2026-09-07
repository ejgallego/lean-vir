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

inductive TargetInputKind where
  | source
  | module

namespace TargetFlag

def option : TargetFlag → TargetInputKind → String
  | .explicit, .source => "--target"
  | .packageOnly, .source => "--package-target"
  | .all, .source => "--target-all"
  | .marked, .source => "--target-marked"
  | .explicit, .module => "--target-module"
  | .packageOnly, .module => "--package-module"
  | .all, .module => "--target-all-module"
  | .marked, .module => "--target-marked-module"

def values : Array TargetFlag := #[.explicit, .packageOnly, .all, .marked]

def options : Array (TargetFlag × TargetInputKind) :=
  #[TargetInputKind.source, .module].flatMap fun kind => values.map (·, kind)

def parse? (text : String) : Option (TargetFlag × TargetInputKind) :=
  options.find? fun (flag, kind) => flag.option kind == text

def alternatives : String :=
  ", ".intercalate (options.map (fun (flag, kind) => s!"`{flag.option kind}`")).toList

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
  let some (flag, kind) := TargetFlag.parse? flagText
    | throw s!"expected {TargetFlag.alternatives}, got `{flagText}`"
  let input :: rest := rest
    | throw s!"{flag.option kind} is missing its source or module argument"
  if input.startsWith "--" then
    throw s!"{flag.option kind} is missing its source or module argument"
  let origin ← match kind with
    | .source => pure (PackageTargetOrigin.source input)
    | .module => do pure (PackageTargetOrigin.module (← Vir.parseDottedName input))
  let (mode, remaining) ← match flag with
    | .all => pure (TargetMode.all, rest)
    | .marked => pure (TargetMode.marked, rest)
    | .explicit | .packageOnly => do
        let (roots, remaining) := takeTargetRoots rest []
        if roots.isEmpty then
          throw s!"target `{input}` has no roots"
        let roots ← roots.toArray.mapM Vir.parseDottedName
        let mode := match flag with
          | .packageOnly => TargetMode.packageOnly roots
          | _ => TargetMode.explicit roots
        pure (mode, remaining)
  go remaining (targets.push { origin, mode })

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
      IO.eprintln "usage: lean --run tools/GeneratePackage.lean <package.irpkg> <report.md> [--module-set-output <set.json> <shard-dir> <root-module> <root-relative-path> <shard-relative-dir>] [--target-module <module> <root>... | --package-module <module> <root>... | --target-all-module <module> | --target-marked-module <module> | --target <source.lean> <root>... | --package-target <source.lean> <root>... | --target-all <source.lean> | --target-marked <source.lean>]"
      return 2
