/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.GeneratePackage.Closure
public import Vir.HostValidation
public import Vir.InterfaceValidation

public section

open Lean

namespace Vir.GeneratePackage

open Lean.IR
open Vir.Interface

def DeclIndex.envForSource? (index : DeclIndex) (source : String) : Option Environment :=
  index.envs.findSome? fun (candidate, env) =>
    if candidate == source then some env else none

def isInterfaceDeclInfo : ConstantInfo → Bool
  | .defnInfo _ => true
  | .opaqueInfo _ => true
  | _ => false

private def DeclIndex.hasCompiledDefinition (index : DeclIndex) (name : Name) : Bool :=
  match index.find? name with
  | some loaded =>
      match loaded.decl with
      | .fdecl .. => true
      | _ => false
  | _ => false

def isGeneratedAuxName (n : Name) : Bool :=
  match boxedBaseName? n with
  | some _ => true
  | none =>
      let text := n.toString
      (text.splitOn "._").length > 1 ||
        text.endsWith ".elim" ||
        text.endsWith ".ctorElim" ||
        text.endsWith ".rec" ||
        text.endsWith ".casesOn" ||
        text.endsWith ".ctorIdx" ||
        text.endsWith ".toCtorIdx" ||
        text.endsWith ".noConfusion" ||
        text.endsWith ".noConfusionType"

def sourceDeclNamesFor (index : DeclIndex) (target : Target) : Array Name :=
  index.sourceDecls.findSome? (fun (source, names) =>
    if source == target.source.toString then some names else none) |>.getD #[]

def publicSourceDeclsFor (index : DeclIndex) (target : Target) : Array Name :=
  match index.envForSource? target.source.toString with
  | none => #[]
  | some env =>
      sourceDeclNamesFor index target |>.filter fun n =>
        !isPrivateName n &&
        !isGeneratedAuxName n &&
        match env.find? n with
        | some info => isInterfaceDeclInfo info
        | none => false

def exportCandidatesFor (index : DeclIndex) (target : Target) : Array Name :=
  match target.mode with
  | .packageOnly _ => #[]
  | .all => publicSourceDeclsFor index target
  | .marked | .markedModule _ => markedDeclNamesFor index target
  | .explicit roots =>
    roots.foldl (fun acc root =>
      let n := (boxedBaseName? root).getD root
      if acc.contains n then acc else acc.push n) #[]

def sanitizeJsNameChar (c : Char) : Char :=
  if c.isAlphanum || c == '_' then c else '_'

def jsNameFor (n : Name) : String :=
  let text := n.toString
  let sanitized := text.map sanitizeJsNameChar
  if sanitized.isEmpty then "entry" else sanitized

private partial def interfaceTypeNeedsBoxedCallBoundary : InterfaceType → Bool
  | .float | .float32 | .uint64 => true
  | .structure _ _ (some idx) _ _ _ fields =>
      match fields[idx]? with
      | some (_, fieldType, _, _) => interfaceTypeNeedsBoxedCallBoundary fieldType
      | none => false
  | _ => false

/-- Whether a classified export needs the generated boxed interpreter boundary. -/
def interfaceNeedsBoxedCallBoundary
    (args : Array InterfaceArg) (result : InterfaceType) : Bool :=
  args.any (fun arg => interfaceTypeNeedsBoxedCallBoundary arg.type) ||
    interfaceTypeNeedsBoxedCallBoundary result

private def boxedBoundaryDiagnostic (name : Name) : String :=
  s!"top-level Float, Float32, UInt64, and trivial wrappers over them require generated boxed declaration `{boxedName name}` at the wasm32 interpreter boundary"

private def renderPackageMessage (message : MessageData) : CoreM String := do
  return ← (← addMessageContext message).toString

def interfaceExportFor (index : DeclIndex) (source : String) (name : Name) :
    CoreM (Except PackageDiagnostic InterfaceExport) := do
  if isPrivateName name then
    return .error {
      name,
      source,
      reason := "private declarations cannot be VIR exports; remove `private` or export a public wrapper"
    }
  else
    let env ← getEnv
    match env.find? name with
    | none => return .error { name, source, reason := "missing elaborated Lean declaration" }
    | some info =>
        if !isInterfaceDeclInfo info && !index.hasCompiledDefinition name then
          return .error { name, source, reason := "declaration is not a compiled definition" }
        else
          let startup := index.virStartups.contains name
          let classified : Except PackageDiagnostic ClassifiedSignature ←
            if startup then
              match ← Vir.InterfaceValidation.analyzeStartupSignature info.type with
              | .error error =>
                  let reason ← renderPackageMessage error.toMessageData
                  pure (.error { name, source, reason })
              | .ok signature =>
                  pure (.ok {
                    args := #[]
                    result := .unit
                    effect := InterfaceEffect.ofStartupEffect signature.effect
                  })
            else
              match ← analyzeExportInterface info.type with
              | .error error =>
                  let reason ← renderPackageMessage error.toMessageData
                  pure (.error { name, source, reason })
              | .ok signature => pure (.ok signature)
          match classified with
          | .ok signature =>
              if interfaceNeedsBoxedCallBoundary signature.args signature.result &&
                  (index.find? (boxedName name)).isNone then
                return .error { name, source, reason := boxedBoundaryDiagnostic name }
              else
                let jsName := jsNameFor name
                return .ok {
                  id := jsName
                  jsName
                  entry := name
                  source
                  args := signature.args
                  result := signature.result
                  effect := signature.effect
                  startup
                }
          | .error diagnostic => return .error diagnostic

def DeclIndex.constInfo? (index : DeclIndex) (name : Name) : Option (String × Environment × ConstantInfo) :=
  index.envs.findSome? fun (source, env) =>
    match env.find? name with
    | some info => some (source, env, info)
    | none => none

def hostImportSymbol (slot arity : Nat) : String :=
  s!"vir_js_import_{slot}_{arity}"

def declParamCount : Decl → Nat
  | .fdecl _ params _ _ _ => params.size
  | .extern _ params _ _ => params.size

def hostImportFor (slot : Nat) (loaded : LoadedDecl) :
    CoreM (Except PackageDiagnostic HostImport) := do
  let some hostMetadata := virJsMetadataFromDecl? loaded.decl
    | return .error { name := loaded.decl.name, source := loaded.source, reason := "declaration is not a VIR JavaScript import" }
  let target := hostMetadata.target
  if slot >= maxHostImportSlots then
    return .error { name := loaded.decl.name, source := loaded.source, reason := s!"too many JavaScript imports; current package format supports at most {maxHostImportSlots}" }
  let arity := declParamCount loaded.decl
  if arity > maxHostImportArity then
    return .error { name := loaded.decl.name, source := loaded.source, reason := s!"JavaScript import arity {arity} exceeds current limit {maxHostImportArity}" }
  let env ← getEnv
  let some info := env.find? loaded.decl.name
    | return .error { name := loaded.decl.name, source := loaded.source, reason := "missing elaborated Lean declaration for JavaScript import" }
  match ← Vir.HostValidation.analyzeHostImport hostMetadata.marker target info.type with
  | .error error =>
      let reason ← renderPackageMessage error.toMessageData
      return .error {
        name := loaded.decl.name
        source := loaded.source
        reason
      }
  | .ok analysis =>
    let signature := analysis.signature
    let expectedArity := signature.erasedPrefixArgs + signature.args.size +
      if signature.effect.isEffectful then 1 else 0
    if arity != expectedArity then
      return .error {
        name := loaded.decl.name,
        source := loaded.source,
        reason := s!"JavaScript import IR arity mismatch: expected {expectedArity}, got {arity}"
      }
    return .ok {
      slot,
      name := loaded.decl.name,
      source := loaded.source,
      target,
      boundary := analysis.boundary,
      symbol := hostImportSymbol slot arity,
      arity,
      erasedPrefixArgs := signature.erasedPrefixArgs,
      args := signature.args,
      result := signature.result,
      effect := signature.effect
    }

def runCoreForSource (source : String) (env : Environment) (x : CoreM α) : IO α :=
  x.toIO'
    { fileName := source, fileMap := default }
    { env := env }

def collectHostImports (index : DeclIndex) (closure : Closure) : IO (Array HostImport × Array PackageDiagnostic) := do
  let mut seen : NameSet := {}
  let mut imports : Array HostImport := #[]
  let mut diagnostics : Array PackageDiagnostic := #[]
  for loaded in closure.decls do
    if isVirJsDecl loaded.decl && !seen.contains loaded.decl.name then
      seen := seen.insert loaded.decl.name
      match index.constInfo? loaded.decl.name with
      | none =>
          diagnostics := diagnostics.push {
            name := loaded.decl.name,
            source := loaded.source,
            reason := "source environment was not loaded"
          }
      | some (source, env, _) =>
          match ← runCoreForSource source env (hostImportFor imports.size loaded) with
          | .ok hostImport => imports := imports.push hostImport
          | .error diagnostic => diagnostics := diagnostics.push diagnostic
  return (imports, diagnostics)

end Vir.GeneratePackage
