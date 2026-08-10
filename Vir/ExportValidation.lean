/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.IRDependencies
import Lean.Compiler.InitAttr
import Vir.GeneratePackage.NativeExterns

public section

open Lean

namespace Vir.ExportValidation

open Lean.IR
open Vir.GeneratePackage

private def underExternFallbackPrefix : Name → Name
  | .anonymous => `_virExternFallback
  | .str pre part => .str (underExternFallbackPrefix pre) part
  | .num pre part => .num (underExternFallbackPrefix pre) part

/-- Deterministic private declaration name used for an extern reference-body clone. -/
def externFallbackCloneName (original : Name) : Name :=
  underExternFallbackPrefix original

/-- Return whether a declaration name belongs to the private extern-fallback namespace. -/
def isExternFallbackCloneName : Name → Bool
  | `_virExternFallback => true
  | .str pre _ => isExternFallbackCloneName pre
  | .num pre _ => isExternFallbackCloneName pre
  | .anonymous => false

/-- Return the deterministic compiled reference-body clone for an extern, if present. -/
def externFallbackClone? (env : Environment) (original : Name) : Option Name := do
  let clone := externFallbackCloneName original
  let .fdecl .. ← Lean.IR.findEnvDecl env clone | none
  return clone

/-!
# Attribute-time VIR entrypoint validation

This check walks only IR visible after Lean compiles the marked declaration. It
reports conclusive local blockers and records opaque import boundaries as
deferrals; package collection later decides whether those dependency bodies
were supplied as package inputs.
-/

inductive ClosureBlockerKind where
  | missingDecl
  | missingExtern
  | unsupportedInitGlobal

structure ClosureBlocker where
  kind : ClosureBlockerKind
  dependency : ClosureDependency

inductive ClosureDeferredKind where
  | opaqueImport
  | compilerPostponed

structure ClosureDeferred where
  kind : ClosureDeferredKind
  dependency : ClosureDependency

structure ClosureCheck where
  blockers : Array ClosureBlocker := #[]
  deferred : Array ClosureDeferred := #[]

private structure ClosureState where
  seen : NameSet := {}
  blockers : Array ClosureBlocker := #[]
  deferred : Array ClosureDeferred := #[]

private def ClosureBlocker.description (blocker : ClosureBlocker) : String :=
  match blocker.kind with
  | .missingDecl => s!"missing IR declaration `{blocker.dependency.name}`"
  | .missingExtern =>
      s!"unsupported runtime dependency `{blocker.dependency.name}`: \
        no native extern implementation is registered"
  | .unsupportedInitGlobal => s!"unsupported initializer global `{blocker.dependency.name}`"

def ClosureBlocker.message (blocker : ClosureBlocker) : String :=
  s!"compiled closure reaches {blocker.description}{blocker.dependency.pathSuffix}"

def ClosureDeferred.message (deferred : ClosureDeferred) : String :=
  match deferred.kind with
  | .opaqueImport =>
      s!"deferred validation of imported dependency `{deferred.dependency.name}`\
        {deferred.dependency.pathSuffix} because its compiled IR is opaque in this module; \
        `:vir` package generation loads and validates the owning module's compiled IR"
  | .compilerPostponed =>
      s!"could not validate `{deferred.dependency.name}` because `compiler.postponeCompile` is \
        enabled; disable it for modules built with `:vir`"

private def pushBlocker
    (kind : ClosureBlockerKind) (name : Name) (path : Array Name) (state : ClosureState) : ClosureState :=
  { state with blockers := state.blockers.push { kind, dependency := { name, path } } }

private def pushDeferred
    (kind : ClosureDeferredKind) (name : Name) (path : Array Name) (state : ClosureState) : ClosureState :=
  { state with deferred := state.deferred.push { kind, dependency := { name, path } } }

private partial def collectVisibleClosure
    (env : Environment)
    (name : Name)
    (path : Array Name)
    (state : ClosureState := {}) : ClosureState :=
  if state.seen.contains name then
    state
  else
    let state := { state with seen := state.seen.insert name }
    if let some clone := externFallbackClone? env name then
      collectVisibleClosure env clone (path.push clone) state
    else
      match nativeExternSpec? name with
      | some spec =>
          spec.deps.foldl
            (fun state dep => collectVisibleClosure env dep (path.push dep) state) state
      | none =>
        match Lean.IR.findEnvDecl env name with
        | none =>
            if isNativeExternCandidate name then
              pushBlocker .missingExtern name path state
            else
              pushBlocker .missingDecl name path state
        | some decl@(.extern ..) =>
            if isOpaqueExternDecl decl && (env.getModuleIdxFor? name).isSome then
              pushDeferred .opaqueImport name path state
            else if isVirJsDecl decl || (env.getModuleIdxFor? name).isNone then
              state
            else if isNativeExternCandidate name then
              pushBlocker .missingExtern name path state
            else
              pushBlocker .missingDecl name path state
        | some decl@(.fdecl ..) =>
            if isUnsupportedInitGlobal decl then
              match getInitFnNameFor? env name with
              | some initName => collectVisibleClosure env initName (path.push initName) state
              | none => pushBlocker .unsupportedInitGlobal name path state
            else
              refsOfDecl decl |>.foldl
                (fun state dep => collectVisibleClosure env dep (path.push dep) state) state

def checkVisibleClosure (env : Environment) (root : Name) : ClosureCheck :=
  let state := collectVisibleClosure env root #[root]
  { blockers := state.blockers, deferred := state.deferred }

end Vir.ExportValidation
