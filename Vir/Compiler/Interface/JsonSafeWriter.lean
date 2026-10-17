/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
-/
module
public import Vir.Compiler.Interface.Classify.Core
import Vir.Compiler.Interface.Classify.Reduce
import Vir.Compiler.Interface.Classify.Basic
public import Vir.Package.JsonSafeWriter
public import Lean
public section
open Lean Elab Vir.Interface
open Lean.Parser.Term (matchAlt matchAltExpr)
namespace Vir.Interface.JsonSafeWriter

private structure Entry where
  type : Expr
  model : InterfaceType
  name : Name
  body : Term := ⟨.missing⟩
private structure State where
  helperPrefix : Name
  entries : Array Entry := #[]
private abbrev BuildM := StateT State TermElabM

private def append (out : Term) (text : String) : BuildM Term :=
  `(String.append $out $(quote text))
private def invoke (name : Name) (value out : Term) : BuildM Term :=
  `($(mkIdent name) $value $out)

/-- Use the constructor's instantiated type, including private fields. Types
remain Exprs until elaboration; no pretty-printing or reparsing is involved. -/
private def ctorFields (type : Expr) (name : Name) : MetaM (Array Expr) := do
  let type ← reduceTypeAliases type
  let fields ← match instantiateConstructorFields (← getEnv) type name with
    | .ok fields => pure fields
    | .error error => throwError error.toMessageData
  return fields.map (·.type)

private def fieldVar (index : Nat) : Term := ⟨mkIdent (.str .anonymous s!"field{index}")⟩

private def pattern (name : Name) (count : Nat) : BuildM Term := do
  let .ctorInfo ctor ← getConstInfo name | throwError "missing constructor {name}"
  let params ← (Array.replicate ctor.numParams ()).mapM fun _ => `(_)
  let fields := (Array.range count).map fieldVar
  `(@$(mkCIdent name) $params* $fields*)

mutual
private partial def plan (type : Expr) (model : InterfaceType) (owners : Array Nat) : BuildM Name := do
  -- Constructor domains may mention preceding binders even when beta/alias
  -- reduction exposes a closed type. Standalone helpers cannot retain them.
  let type ← reduceTypeAliases type
  if type.hasLooseBVars || type.hasFVar || type.hasMVar then
    throwError "JSON-safe writer requires a closed helper type; unresolved constructor-field dependency"
  if let .recursiveRef _ _ depth := model then
    if depth >= owners.size then throwError "unbound writer recursive owner"
    let some owner := owners[owners.size - depth - 1]? | throwError "unbound writer recursive owner"
    let some entry := (← get).entries[owner]? | throwError "missing writer owner"
    return entry.name
  let state ← get
  if let some entry := state.entries.find? (fun entry =>
      (⟨entry.type⟩ : ExprStructEq) == ⟨type⟩ && entry.model == model) then
    return entry.name
  let index := state.entries.size
  let name := state.helperPrefix.str s!"write{index}"
  modify fun state => { state with entries := state.entries.push {type, model, name} }
  let nextOwners := match model with
    | .customInductive .. | .structure .. => owners.push index
    | _ => owners
  let body ← bodyFor type model nextOwners ⟨mkIdent `value⟩ ⟨mkIdent `out⟩
  modify fun state => { state with entries := state.entries.modify index (fun entry => {entry with body}) }
  return name

private partial def bodyFor (type : Expr) (model : InterfaceType) (owners : Array Nat)
    (value out : Term) : BuildM Term := do
  match model with
  | .unit => append out "null"
  | .nat => `(Vir.JsonSafeWriter.nat $value $out)
  | .int => `(Vir.JsonSafeWriter.int $value $out)
  | .uint64 => `(Vir.JsonSafeWriter.nat ($value).toNat $out)
  | .string => `(String.append $out (Lean.Json.renderString $value))
  | .bool => `(String.append $out (if $value then "true" else "false"))
  | .uint8 | .uint16 | .uint32 => `(Vir.JsonSafeWriter.unsigned ($value).toNat $out)
  | .byteArray => `(Vir.JsonSafeWriter.bytes $value $out)
  | .array element =>
      let type ← reduceTypeAliases type
      let some actualElement := type.getAppArgs[0]? | throwError "missing array type"
      let fn ← plan actualElement element owners
      `(Vir.JsonSafeWriter.array $(mkIdent fn) $value $out)
  | .simpleEnum name constructors =>
      let alternatives ← constructors.mapM fun ctor => do
        let output ← append out (Json.renderString (constructorLabel name ctor))
        `(Parser.Term.matchAltExpr| | $(mkCIdent ctor) => $output)
      `(match ($value) with $alternatives:matchAlt*)
  | .structure _ _ descriptor =>
      let fields ← ctorFields type descriptor.constructorName
      let mut output ← append out "{"
      for h : index in [:descriptor.fields.size] do
        let field := descriptor.fields[index]
        if field.isSubobject then
          throwError "inherited record fields are not yet supported by this writer"
        -- Classification preserves constructor order; only the trailing
        -- Char/Fin proof field is omitted from supported record descriptors.
        let fn ← plan fields[index]! field.type owners
        let fieldPrefix := (if index == 0 then "" else ",") ++ Json.renderString field.name ++ ":"
        output ← invoke fn (fieldVar index) (← append output fieldPrefix)
      output ← append output "}"
      let pat ← pattern descriptor.constructorName fields.size
      `(match ($value) with | $pat => $output)
  | .libraryAdapter _ _ descriptor =>
      let signature ← Meta.whnf (← getConstInfo descriptor.encode).type
      let .forallE _ _ actualWire _ := signature | throwError "unexpected adapter encoder"
      let fn ← plan actualWire descriptor.wire #[]
      invoke fn (← `($(mkCIdent descriptor.encode) $value)) out
  | .customInductive name _ constructors =>
      if let some element := linkedListElement? name constructors then
        let fields ← ctorFields type `List.cons
        let fn ← plan fields[0]! element owners
        return ← `(Vir.JsonSafeWriter.list $(mkIdent fn) $value $out)
      let mut alternatives := #[]
      for h : index in [:constructors.size] do
        let ctor := constructors[index]
        let kind := constructorLabel name ctor.constructorName
        let payload := constructorPayload ctor.fields
        let fields ← ctorFields type ctor.constructorName
        let mut output ← append out ("{\"kind\":" ++ Json.renderString kind)
        if let .value field := payload then
          let fn ← plan fields[0]! field.type owners
          output ← invoke fn (fieldVar 0) (← append output ",\"value\":")
        else if let .fields payloadFields := payload then
          output ← append output ",\"fields\":{"
          for h : fieldIndex in [:payloadFields.size] do
            let field := payloadFields[fieldIndex]
            let fn ← plan fields[fieldIndex]! field.type owners
            let fieldPrefix := (if fieldIndex == 0 then "" else ",") ++ Json.renderString field.name ++ ":"
            output ← invoke fn (fieldVar fieldIndex) (← append output fieldPrefix)
          output ← append output "}"
        output ← append output "}"
        let pat ← pattern ctor.constructorName fields.size
        alternatives := alternatives.push (← `(Parser.Term.matchAltExpr| | $pat => $output))
      `(match ($value) with $alternatives:matchAlt*)
  | _ => throwError "unsupported JSON-safe writer domain: {model.label}"
end

/-- Generate a typed JSON-safe String writer
from the ordinary classified boundary. Traversal helpers are private; the named
root can be used by an application wrapper. Call from `run_elab` with a fully
qualified declaration name and a closed source type. Unsupported domains fail
generation instead of selecting a `ToJson` fallback. -/
def generate (name : Name) (type : Expr) : TermElabM Unit := do
  if (← getEnv).contains name then throwError "writer declaration already exists: {name}"
  let model ← match ← interfaceType type with
    | .ok model => pure model
    | .error error => throwError error.toMessageData
  let (root, state) ← (plan type model #[]).run { helperPrefix := name.str "_codec" }
  let mut views := #[]
  for entry in state.entries do
    let definition ← `(Parser.Command.definition|
      def $(mkIdent <| `_root_ ++ entry.name)
        ($(mkIdent `value) : $(← Term.exprToSyntax entry.type))
        ($(mkIdent `out) : String) : String := $(entry.body))
    views := views.push (Command.mkDefViewOfDef
      { visibility := .private, recKind := .partial } definition)
  Term.elabMutualDef #[] { header := "" } views
  let definition ← `(Parser.Command.definition|
    def $(mkIdent <| `_root_ ++ name)
      ($(mkIdent `value) : $(← Term.exprToSyntax type)) : String :=
        $(mkIdent root) $(mkIdent `value) "")
  Term.elabMutualDef #[] { header := "" }
    #[Command.mkDefViewOfDef { visibility := .public } definition]

end Vir.Interface.JsonSafeWriter
