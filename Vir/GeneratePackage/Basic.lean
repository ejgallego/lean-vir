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

structure Target where
  source : System.FilePath
  roots : Array Name
  includeAll : Bool := false
  includeMarked : Bool := false
  markedModule? : Option Name := none
  resolveImportedModules : Bool := false
  packageOnly : Bool := false

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
  virExports : NameSet := {}
  virStartups : NameSet := {}
  loadedModules : NameSet := {}
  diagnostics : Array DeclIndexDiagnostic := #[]

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
  runtimeAbiVersion : Nat
  leanVersion : String
  leanToolchain : String
  leanGithash : String
  generatedAt : String
  targets : Array PackageTargetMetadata

structure InterfaceManifest where
  metadata : PackageMetadata
  exports : Array InterfaceExport := #[]
  hostImports : Array HostImport := #[]
  diagnostics : Array PackageDiagnostic := #[]

def defaultTargets : Array Target := #[
  {
    source := "examples/Fib.lean",
    roots := #[`fib]
  },
  {
    source := "examples/Tamagotchi.lean",
    roots := #[
      `Tamagotchi.step
    ]
  },
  {
    source := "examples/Tamagotchi.lean",
    roots := #[
      `Tamagotchi.run,
      `Tamagotchi.trace,
      `Tamagotchi.demoScript
    ],
    packageOnly := true
  },
  {
    source := "examples/MergeSort.lean",
    roots := #[`SortDemo.demo, `SortDemo.demoFromArray]
  }
]

end Vir.GeneratePackage
