/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Lean
import Lean.Elab.Frontend
import Lean.Compiler.IR.CompilerM
import Lean.Compiler.InitAttr
import Lean.Compiler.LCNF.Main
import Lean.Compiler.LCNF.ToImpureType

open Lean

namespace Vir.GeneratePackage

open Lean.IR

inductive StructureFieldLayout where
  | object (index : Nat)
  | usize (index : Nat)
  | scalar (size offset : Nat)
  deriving BEq, Repr

abbrev RecursiveSeen := Array (Name × String)

inductive InterfaceEffect where
  | pure
  | runtime
  | io
  | dom
  | react
  deriving BEq, Repr

def InterfaceEffect.label : InterfaceEffect → String
  | .pure => "pure"
  | .runtime => "runtime"
  | .io => "io"
  | .dom => "dom"
  | .react => "react"

def InterfaceEffect.isEffectful : InterfaceEffect → Bool
  | .pure => false
  | _ => true

def InterfaceEffect.display : InterfaceEffect → String
  | .pure => ""
  | .runtime => "RuntimeM"
  | .io => "IO"
  | .dom => "DomM"
  | .react => "ReactM"

def maxHostImportSlots : Nat := 128

def maxHostImportArity : Nat := 6

structure Target where
  source : System.FilePath
  roots : Array Name
  includeAll : Bool := false
  packageOnly : Bool := false
  /--
  Drop top-level `#eval` command lines before frontend elaboration. This keeps
  demo/example sources importable by the package generator without running local
  examples as part of generation.
  -/
  dropEvalCommands : Bool := true

structure LoadedDecl where
  source : String
  decl : Decl

structure DeclIndexDiagnostic where
  name : Name
  source : String
  reason : String

structure DeclIndex where
  localDecls : NameMap LoadedDecl := {}
  envs : Array (String × Environment) := #[]
  sourceDecls : Array (String × Array Name) := #[]
  diagnostics : Array DeclIndexDiagnostic := #[]

structure NativeExtern where
  name : Name
  params : Array Param
  resultType : IRType
  symbol : String
  deps : Array Name := #[]

structure InitGlobal where
  name : Name
  initName : Name

structure Closure where
  seen : NameSet := {}
  initGlobalSeen : NameSet := {}
  decls : Array LoadedDecl := #[]
  externs : Array NativeExtern := #[]
  initGlobals : Array InitGlobal := #[]
  missingDecls : Array Name := #[]
  missingExterns : Array Name := #[]
  unsupportedInitGlobals : Array Name := #[]

inductive InterfaceType where
  | unit
  | nat
  | int
  | bool
  | string
  | float
  | float32
  | uint8
  | uint16
  | uint32
  | uint64
  | usize
  | byteArray
  | array (element : InterfaceType)
  | list (element : InterfaceType)
  | option (element : InterfaceType)
  | prod (fst snd : InterfaceType)
  | simpleEnum (name : Name) (constructors : Array Name)
  | taggedUnion (name : Name) (label : String)
      (constructors : Array (Name × String × InterfaceType × StructureFieldLayout × Nat × Nat × Nat))
  | recursiveSelf (name : Name) (label : String)
  | customInductive (name : Name) (label : String)
      (constructors : Array (Name × String × Nat × Nat × Nat × Array (String × InterfaceType × StructureFieldLayout)))
  | structure (name : Name) (label : String) (trivialField? : Option Nat)
      (objectFields usizeFields scalarBytes : Nat)
      (fields : Array (String × InterfaceType × StructureFieldLayout × Bool))
  | resource (name : Name) (label : String)
  | function (args : Array (String × InterfaceType)) (result : InterfaceType) (effect : InterfaceEffect)
  | expr
  | leanObject
  deriving BEq, Repr

structure InterfaceArg where
  name : String
  type : InterfaceType

structure InterfaceExport where
  id : String
  jsName : String
  entry : Name
  source : String
  args : Array InterfaceArg
  result : InterfaceType
  effect : InterfaceEffect := .pure

inductive HostImportBoundary where
  | wire
  | explicitConversion
  | objectHandle
  deriving BEq, Inhabited

def HostImportBoundary.label : HostImportBoundary → String
  | .wire => "wire"
  | .explicitConversion => "explicitConversion"
  | .objectHandle => "objectHandle"

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
  packageOnly : Bool
  dropEvalCommands : Bool

structure PackageMetadata where
  generator : String
  packageFormatVersion : Nat
  manifestVersion : Nat
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
