/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.GeneratePackage.Frontend
import Vir.GeneratePackage.NativeExterns

open Lean

namespace Vir.GeneratePackage

open Lean.IR

def refsOfExpr (expr : IR.Expr) (refs : Array Name) : Array Name :=
  match expr with
  | .fap f _ => refs.push f
  | .pap f _ => refs.push f
  | _ => refs

partial def refsOfBody : FnBody -> Array Name -> Array Name
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

def refsOfDecl : Decl -> Array Name
  | .fdecl (body := body) .. => refsOfBody body #[]
  | .extern .. => #[]

def addInitGlobal (name initName : Name) (state : Closure) : Closure :=
  if state.initGlobalSeen.contains name then
    state
  else
    { state with
      initGlobalSeen := state.initGlobalSeen.insert name
      initGlobals := state.initGlobals.push { name, initName } }

partial def collectName (index : DeclIndex) (name : Name) (state : Closure) : Closure :=
  if state.seen.contains name then
    state
  else
    let state := { state with seen := state.seen.insert name }
    match nativeExtern? name with
    | some ext =>
        let state := { state with externs := state.externs.push ext }
        ext.deps.foldl (fun state dep => collectName index dep state) state
    | none =>
        match index.find? name with
        | none =>
            if isNativeExternCandidate name then
              { state with missingExterns := state.missingExterns.push name }
            else
              { state with missingDecls := state.missingDecls.push name }
        | some loaded =>
            if isUnsupportedInitGlobal loaded.decl then
              match index.initFnNameFor? name with
              | some initName =>
                  let state := { state with decls := state.decls.push loaded }
                  let state := collectName index initName state
                  addInitGlobal name initName state
              | none =>
                  { state with
                    decls := state.decls.push loaded
                    unsupportedInitGlobals := state.unsupportedInitGlobals.push name }
            else
              let state := { state with decls := state.decls.push loaded }
              refsOfDecl loaded.decl |>.foldl (fun state dep => collectName index dep state) state

def rootsForTarget (index : DeclIndex) (target : Target) : Array Name :=
  if target.includeAll then
    index.sourceDecls.findSome? (fun (source, names) =>
      if source == target.source.toString then some names else none) |>.getD #[]
  else
    target.roots

def boxedBaseName? : Name -> Option Name
  | .str pre "_boxed" => some pre
  | _ => none

def boxedName (name : Name) : Name :=
  .str name "_boxed"

def resolvedRootsForTarget (index : DeclIndex) (target : Target) : Array Name :=
  rootsForTarget index target |>.foldl (fun roots root =>
    let roots := if roots.contains root then roots else roots.push root
    match boxedBaseName? root with
    | some _ => roots
    | none =>
        let boxed := boxedName root
        if (index.find? boxed).isSome && !roots.contains boxed then
          roots.push boxed
        else
          roots) #[]

def collectClosure (targets : Array Target) (index : DeclIndex) : Closure :=
  targets.foldl (fun state target =>
    (resolvedRootsForTarget index target).foldl (fun state root => collectName index root state) state) {}

end Vir.GeneratePackage
