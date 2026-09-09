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

namespace TargetMode

def roots : TargetMode → Array Name
  | .explicit roots | .packageOnly roots => roots
  | .all | .marked => #[]

def selectsMarked : TargetMode → Bool
  | .marked => true
  | _ => false

def metadataName : TargetMode → String
  | .explicit _ => "explicit"
  | .packageOnly _ => "packageOnly"
  | .all => "all"
  | .marked => "marked"

end TargetMode

inductive PackageTargetOrigin where
  | module (name : Name)
  /-- An already elaborated module; the document is provenance, not a path to load. -/
  | snapshot (document : String) (name : Name)
  deriving BEq

namespace PackageTargetOrigin

def display : PackageTargetOrigin → String
  | .module name => s!"module {name}"
  | .snapshot document _ => document

def moduleName : PackageTargetOrigin → Name
  | .module name | .snapshot _ name => name

end PackageTargetOrigin

/-- Input identity is independent of selection. Compiled modules and prepared
live module snapshots share the same package pipeline. -/
structure Target where
  origin : PackageTargetOrigin
  mode : TargetMode

def Target.publicSource (target : Target) : String :=
  target.origin.display

/-- Preserve the existing wire spelling for marked module targets without
coupling the internal selection type to module identity. -/
def TargetMode.metadataNameFor (mode : TargetMode) (origin : PackageTargetOrigin) : String :=
  match mode, origin with
  | .marked, .module _ => "markedModule"
  | _, _ => mode.metadataName

structure LoadedDecl where
  source : String
  module? : Option Name := none
  decl : Decl

structure DeclIndexDiagnostic where
  name : Name
  source : String
  reason : String

/--
One input environment and its owned declarations. Typed identity keeps compiled
acquisition distinct from live document provenance, without filesystem aliases.
-/
structure DeclSource where
  origin : PackageTargetOrigin
  env : Environment
  decls : Array Name := #[]

def DeclSource.display (source : DeclSource) : String := source.origin.display

structure DeclIndex where
  localDecls : NameMap LoadedDecl := {}
  sources : Array DeclSource := #[]
  clientNativeExternSpecs : Array NativeExternSpec := #[]
  virExports : NameSet := {}
  virStartups : NameSet := {}
  loadedModules : NameSet := {}
  diagnostics : Array DeclIndexDiagnostic := #[]

def DeclIndex.sourceForTarget? (index : DeclIndex) (target : Target) : Option DeclSource :=
  index.sources.find? (fun source => source.origin == target.origin)

def DeclIndex.envForTarget? (index : DeclIndex) (target : Target) : Option Environment :=
  (index.sourceForTarget? target).map (·.env)

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
  origin : PackageTargetOrigin
  mode : TargetMode
  resolvedRoots : Array Name

inductive PackageSetMemberRole where
  | dependency
  | root

namespace PackageSetMemberRole

def label : PackageSetMemberRole → String
  | .dependency => "dependency"
  | .root => "root"

end PackageSetMemberRole

structure PackageSetMemberMetadata where
  moduleName : Name
  role : PackageSetMemberRole

structure PackageMetadata where
  generator : String
  packageFormatVersion : Nat
  manifestVersion : Nat
  leanVersion : String
  leanToolchain : String
  leanGithash : String
  targets : Array PackageTargetMetadata
  packageSetMember? : Option PackageSetMemberMetadata := none

structure InterfaceManifest where
  metadata : PackageMetadata
  exports : Array InterfaceExport := #[]
  hostImports : Array HostImport := #[]
  diagnostics : Array PackageDiagnostic := #[]

end Vir.GeneratePackage
