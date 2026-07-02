/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.GeneratePackage.Closure
import Vir.GeneratePackage.Interface.Classify.Signature

open Lean

namespace Vir.GeneratePackage

open Lean.IR

def DeclIndex.envForSource? (index : DeclIndex) (source : String) : Option Environment :=
  index.envs.findSome? fun (candidate, env) =>
    if candidate == source then some env else none

def isInterfaceDeclInfo : ConstantInfo → Bool
  | .defnInfo _ => true
  | .opaqueInfo _ => true
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
  if target.packageOnly then
    #[]
  else if target.includeAll then
    publicSourceDeclsFor index target
  else
    target.roots.foldl (fun acc root =>
      let n := (boxedBaseName? root).getD root
      if acc.contains n then acc else acc.push n) #[]

def sanitizeJsNameChar (c : Char) : Char :=
  if c.isAlphanum || c == '_' then c else '_'

def jsNameFor (n : Name) : String :=
  let text := n.toString
  let sanitized := text.map sanitizeJsNameChar
  if sanitized.isEmpty then "entry" else sanitized

def interfaceNeedsBoxedCallBoundary (args : Array InterfaceArg) (result : InterfaceType) : Bool :=
  args.any (fun arg => arg.type.needsBoxedCallBoundary) || result.needsBoxedCallBoundary

def boxedBoundaryDiagnostic (name : Name) : String :=
  s!"top-level Float, Float32, UInt64, and trivial wrappers over them require generated boxed declaration `{boxedName name}` at the wasm32 interpreter boundary"

def InterfaceType.isHostResourceWire : InterfaceType → Bool
  | .resource .. => true
  | _ => false

def isExplicitJsValueConversionTarget (target : String) : Bool :=
  target.startsWith "js.value." && target != "js.value.value"

def isExplicitJsValueUnwrapTarget (target : String) : Bool :=
  isExplicitJsValueConversionTarget target && target.endsWith ".value"

def InterfaceType.hostBoundaryKind : InterfaceType → String
  | .unit
  | .nat
  | .int
  | .bool
  | .string
  | .float
  | .float32
  | .uint8
  | .uint16
  | .uint32
  | .uint64
  | .usize
  | .byteArray
  | .expr => "raw Lean type"
  | .simpleEnum .. => "enum"
  | .taggedUnion .. => "tagged union"
  | .customInductive .. => "inductive"
  | .structure .. => "structure"
  | .recursiveSelf .. => "recursive type"
  | .array .. => "array"
  | .list .. => "list"
  | .option .. => "option"
  | .prod .. => "product"
  | .resource .. => "resource"
  | .function .. => "callback"

mutual

partial def InterfaceType.isHostWireArgType : InterfaceType → Bool
  | .unit => true
  | .resource .. => true
  | .array element => element.isHostWireArgType
  | .list element => element.isHostWireArgType
  | .option element => element.isHostWireArgType
  | .prod fst snd => fst.isHostWireArgType && snd.isHostWireArgType
  | .function args result _ =>
      args.all (fun (_, ty) => ty.isHostWireArgType) && result.isHostWireResultType
  | _ => false

partial def InterfaceType.isHostWireResultType : InterfaceType → Bool
  | .unit => true
  | .resource .. => true
  | .array element => element.isHostWireResultType
  | .list element => element.isHostWireResultType
  | .option element => element.isHostWireResultType
  | .prod fst snd => fst.isHostWireResultType && snd.isHostWireResultType
  | _ => false

end

def isJsValueConversionSignature
    (target : String)
    (args : Array InterfaceArg)
    (result : InterfaceType)
    (effect : InterfaceEffect) : Bool :=
  if effect != .runtime then
    false
  else if isExplicitJsValueUnwrapTarget target then
    match args[0]? with
    | some arg => args.size == 1 && arg.type.isHostResourceWire
    | none => false
  else if isExplicitJsValueConversionTarget target then
    args.size == 1 && result.isHostResourceWire
  else
    match target, args[0]? with
    | "js.string", some arg => args.size == 1 && arg.type == .string && result.isHostResourceWire
    | "js.string.value", some arg => args.size == 1 && arg.type.isHostResourceWire && result == .string
    | "js.nat", some arg => args.size == 1 && arg.type == .nat && result.isHostResourceWire
    | "js.nat.value", some arg => args.size == 1 && arg.type.isHostResourceWire && result == .nat
    | "js.bool", some arg => args.size == 1 && arg.type == .bool && result.isHostResourceWire
    | "js.bool.value", some arg => args.size == 1 && arg.type.isHostResourceWire && result == .bool
    | "js.float", some arg => args.size == 1 && arg.type == .float && result.isHostResourceWire
    | "js.float.value", some arg => args.size == 1 && arg.type.isHostResourceWire && result == .float
    | _, _ => false

def hostBoundaryTypeDiagnostic (ty : InterfaceType) : String :=
  s!"{ty.hostBoundaryKind} `{ty.label}` is not a JavaScript boundary type; use `Lean.Vir.Js ...` resources and explicit conversion calls"

def hostImportArgBoundaryDiagnostic? (_target : String) (arg : InterfaceArg) : Option String :=
  if arg.type.isHostWireArgType then
    none
  else
    some s!"unsupported JavaScript import argument `{arg.name}`: {hostBoundaryTypeDiagnostic arg.type}"

def hostImportResultBoundaryDiagnostic? (result : InterfaceType) : Option String :=
  if result.isHostWireResultType then
    none
  else
    some s!"unsupported JavaScript import result: {hostBoundaryTypeDiagnostic result}"

def hostImportBoundary
    (target : String)
    (args : Array InterfaceArg)
    (result : InterfaceType)
    (effect : InterfaceEffect) : Except String HostImportBoundary :=
  if isJsValueConversionSignature target args result effect then
    .ok .conversion
  else
    match args.findSome? (hostImportArgBoundaryDiagnostic? target) <|>
        hostImportResultBoundaryDiagnostic? result with
    | some reason => .error reason
    | none => .ok .wire

def interfaceExportFor (index : DeclIndex) (source : String) (name : Name) :
    CoreM (Except PackageDiagnostic InterfaceExport) := do
  if isPrivateName name then
    return .error { name, source, reason := "private declarations are not exported" }
  else
    let env ← getEnv
    match env.find? name with
    | none => return .error { name, source, reason := "missing elaborated Lean declaration" }
    | some info =>
        if !isInterfaceDeclInfo info then
          return .error { name, source, reason := "declaration is not a compiled definition" }
        else
          match ← interfaceSignature? info.type with
          | .ok (args, result, effect, erasedArgCount) =>
              if erasedArgCount != 0 then
                return .error {
                  name,
                  source,
                  reason := "polymorphic exported entrypoints with erased type parameters are not supported; export a concrete wrapper"
                }
              else if interfaceNeedsBoxedCallBoundary args result && (index.find? (boxedName name)).isNone then
                return .error { name, source, reason := boxedBoundaryDiagnostic name }
              else
                let jsName := jsNameFor name
                return .ok { id := jsName, jsName, entry := name, source, args, result, effect }
          | .error reason =>
              return .error { name, source, reason }

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
  let some target := virJsTargetFromDecl? loaded.decl
    | return .error { name := loaded.decl.name, source := loaded.source, reason := "declaration is not a Vir JavaScript import" }
  if slot >= maxHostImportSlots then
    return .error { name := loaded.decl.name, source := loaded.source, reason := s!"too many JavaScript imports; v1 supports at most {maxHostImportSlots}" }
  let arity := declParamCount loaded.decl
  if arity > maxHostImportArity then
    return .error { name := loaded.decl.name, source := loaded.source, reason := s!"JavaScript import arity {arity} exceeds v1 limit {maxHostImportArity}" }
  let env ← getEnv
  let some info := env.find? loaded.decl.name
    | return .error { name := loaded.decl.name, source := loaded.source, reason := "missing elaborated Lean declaration for JavaScript import" }
  match ← interfaceSignature? info.type with
  | .error reason =>
      return .error { name := loaded.decl.name, source := loaded.source, reason := s!"unsupported JavaScript import signature: {reason}" }
  | .ok (args, result, effect, erasedArgCount) =>
    let expectedArity := erasedArgCount + args.size + if effect.isEffectful then 1 else 0
    if arity != expectedArity then
      return .error {
        name := loaded.decl.name,
        source := loaded.source,
        reason := s!"JavaScript import IR arity mismatch: expected {expectedArity}, got {arity}"
      }
    match hostImportBoundary target args result effect with
    | .error reason =>
        return .error {
          name := loaded.decl.name,
          source := loaded.source,
          reason
        }
    | .ok boundary =>
        return .ok {
          slot,
          name := loaded.decl.name,
          source := loaded.source,
          target,
          boundary,
          symbol := hostImportSymbol slot arity,
          arity,
          erasedPrefixArgs := erasedArgCount,
          args,
          result,
          effect
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
