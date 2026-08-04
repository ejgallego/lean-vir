/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Lean.Compiler.IR.CompilerM

public section

open Lean

namespace Vir.GeneratePackage

open Lean.IR

/-!
# Shared VIR dependency analysis

This module contains the small IR reference walker and dependency-path values
shared by package generation and the `@[vir_export]` after-compilation check.
Package collection and attribute-time validation intentionally keep separate
closure walkers because only the latter can encounter opaque imported IR.
-/

private def jsExternPrefix : String := "__vir_js:"

private def jsExplicitConversionExternPrefix : String := "__vir_js_explicit_conversion:"

private def externTargetWithPrefix? (pfx symbol : String) : Option String :=
  if symbol.startsWith pfx then
    some (symbol.drop pfx.length).toString
  else
    none

private def virJsTargetFromExternData? (data : ExternAttrData) : Option String :=
  data.entries.findSome? fun entry =>
    match entry with
    | .standard _ symbol =>
        externTargetWithPrefix? jsExternPrefix symbol <|>
          externTargetWithPrefix? jsExplicitConversionExternPrefix symbol
    | _ => none

def virJsTargetFromDecl? : Decl → Option String
  | .extern _ _ _ data => virJsTargetFromExternData? data
  | _ => none

def isVirJsDecl (decl : Decl) : Bool :=
  virJsTargetFromDecl? decl |>.isSome

private def virJsExplicitConversionTargetFromExternData? (data : ExternAttrData) : Option String :=
  data.entries.findSome? fun entry =>
    match entry with
    | .standard _ symbol => externTargetWithPrefix? jsExplicitConversionExternPrefix symbol
    | _ => none

def isVirJsExplicitConversionDecl : Decl → Bool
  | .extern _ _ _ data => virJsExplicitConversionTargetFromExternData? data |>.isSome
  | _ => false

def isOpaqueExternDecl : Decl → Bool
  | .extern _ _ _ { entries := [.opaque] } => true
  | _ => false

private def refsOfExpr (expr : IR.Expr) (refs : Array Name) : Array Name :=
  match expr with
  | .fap f _ => refs.push f
  | .pap f _ => refs.push f
  | _ => refs

private partial def refsOfBody : FnBody → Array Name → Array Name
  | .vdecl _ _ expr cont, refs => refsOfBody cont (refsOfExpr expr refs)
  | .jdecl _ _ body cont, refs => refsOfBody cont (refsOfBody body refs)
  | .set _ _ _ cont, refs => refsOfBody cont refs
  | .setTag _ _ cont, refs => refsOfBody cont refs
  | .uset _ _ _ cont, refs => refsOfBody cont refs
  | .sset _ _ _ _ _ cont, refs => refsOfBody cont refs
  | .inc _ _ _ _ cont, refs => refsOfBody cont refs
  | .dec _ _ _ _ cont, refs => refsOfBody cont refs
  | .del _ cont, refs => refsOfBody cont refs
  | .case _ _ _ alts, refs =>
      alts.foldl (fun refs alt =>
        match alt with
        | .ctor _ body => refsOfBody body refs
        | .default body => refsOfBody body refs) refs
  | .ret _, refs => refs
  | .jmp _ _, refs => refs
  | .unreachable, refs => refs

def refsOfDecl : Decl → Array Name
  | .fdecl (body := body) .. => refsOfBody body #[]
  | .extern .. => #[]

structure ClosureDependency where
  name : Name
  path : Array Name

private def ClosureDependency.pathText (dependency : ClosureDependency) : String :=
  " -> ".intercalate (dependency.path.map (·.toString)).toList

def ClosureDependency.pathSuffix (dependency : ClosureDependency) : String :=
  if dependency.path.size <= 1 then "" else s!" (via {dependency.pathText})"

end Vir.GeneratePackage
