/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Lean.Compiler.IR.CompilerM
public import Vir.GeneratePackage.NativeExterns
public import Vir.Interface.Model
public import Vir.IRDependencies

public section

open Lean

namespace Vir.GeneratePackage

open Lean.IR
open Vir.Interface

def maxHostImportSlots : Nat := 128

def maxHostImportArity : Nat := 6

inductive TargetMode where
  | explicit (roots : Array Name)
  | packageOnly (roots : Array Name)
  | all
  | marked
  | markedModule (moduleName : Name)

namespace TargetMode

def roots : TargetMode → Array Name
  | .explicit roots | .packageOnly roots => roots
  | .all | .marked | .markedModule _ => #[]

def markedModule? : TargetMode → Option Name
  | .markedModule moduleName => some moduleName
  | _ => none

def selectsMarked : TargetMode → Bool
  | .marked | .markedModule _ => true
  | _ => false

def metadataName : TargetMode → String
  | .explicit _ => "explicit"
  | .packageOnly _ => "packageOnly"
  | .all => "all"
  | .marked => "marked"
  | .markedModule _ => "markedModules"

end TargetMode

/--
A package input and its single, explicit selection mode. Keeping the mode as a
sum type prevents contradictory states such as selecting both all declarations
and marked declarations, or accidentally changing manifest metadata with an
unrelated loading flag.
-/
structure Target where
  source : System.FilePath
  mode : TargetMode

/-- Resolve a package input to the file identity used by frontend caches. -/
def Target.canonicalSourceKey (target : Target) : IO String := do
  return (← IO.FS.realPath target.source).normalize.toString

structure LoadedDecl where
  source : String
  module? : Option Name := none
  decl : Decl

structure DeclIndexDiagnostic where
  name : Name
  source : String
  reason : String

structure DeclIndex where
  localDecls : NameMap LoadedDecl := {}
  envs : Array (String × Environment) := #[]
  sourceDecls : Array (String × Array Name) := #[]
  sourceKeys : Array (String × String) := #[]
  clientNativeExternSpecs : Array NativeExternSpec := #[]
  virExports : NameSet := {}
  virStartups : NameSet := {}
  loadedModules : NameSet := {}
  diagnostics : Array DeclIndexDiagnostic := #[]

def DeclIndex.sourceKeyFor (index : DeclIndex) (target : Target) : String :=
  index.sourceKeys.findSome? (fun (source, key) =>
    if source == target.source.toString then some key else none) |>.getD target.source.normalize.toString

/-- Preserve the first caller-supplied spelling for diagnostics and manifests. -/
def DeclIndex.displaySourceForKey (index : DeclIndex) (sourceKey : String) : String :=
  index.sourceKeys.findSome? (fun (source, key) =>
    if key == sourceKey then some source else none) |>.getD sourceKey

structure InitGlobal where
  name : Name
  initName : Name

structure Closure where
  seen : NameSet := {}
  initGlobalSeen : NameSet := {}
  decls : Array LoadedDecl := #[]
  externs : Array NativeExtern := #[]
  initGlobals : Array InitGlobal := #[]
  missingDecls : Array ClosureDependency := #[]
  missingExterns : Array ClosureDependency := #[]
  unsupportedInitGlobals : Array ClosureDependency := #[]

structure InterfaceExport where
  id : String
  jsName : String
  entry : Name
  source : String
  args : Array InterfaceArg
  result : InterfaceType
  effect : InterfaceEffect := .pure
  startup : Bool := false

structure HostImport where
  slot : Nat
  name : Name
  source : String
  target : String
  boundary : HostImportBoundary
  symbol : String
  arity : Nat
  erasedPrefixArgs : Nat := 0
  args : Array InterfaceArg
  result : InterfaceType
  effect : InterfaceEffect

structure PackageDiagnostic where
  name : Name
  source : String
  reason : String

def DeclIndexDiagnostic.toPackageDiagnostic (diagnostic : DeclIndexDiagnostic) : PackageDiagnostic :=
  {
    name := diagnostic.name
    source := diagnostic.source
    reason := diagnostic.reason
  }

structure PackageTargetMetadata where
  source : String
  mode : String
  roots : Array Name
  resolvedRoots : Array Name

structure PackageMetadata where
  generator : String
  packageFormatVersion : Nat
  manifestVersion : Nat
  leanVersion : String
  leanToolchain : String
  leanGithash : String
  targets : Array PackageTargetMetadata

structure InterfaceManifest where
  metadata : PackageMetadata
  exports : Array InterfaceExport := #[]
  hostImports : Array HostImport := #[]
  diagnostics : Array PackageDiagnostic := #[]

def defaultTargets : Array Target := #[
  {
    source := "examples/Fib.lean",
    mode := .explicit #[`fib]
  },
  {
    source := "examples/Tamagotchi.lean",
    mode := .explicit #[
      `Tamagotchi.step
    ]
  },
  {
    source := "examples/Tamagotchi.lean",
    mode := .packageOnly #[
      `Tamagotchi.run,
      `Tamagotchi.trace,
      `Tamagotchi.demoScript
    ]
  },
  {
    source := "examples/MergeSort.lean",
    mode := .explicit #[`SortDemo.demo, `SortDemo.demoFromArray]
  }
]

end Vir.GeneratePackage
