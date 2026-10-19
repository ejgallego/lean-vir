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

/-- Compiler-private preparation contract. The model and its instantiated Lean
expression travel together; only closed expressions can enter a helper plan.
Closed aliases retain the classifier's identity. No Expr enters the manifest. -/
private structure PreparedType where
  type : Expr
  model : InterfaceType
  closed : (type.hasLooseBVars || type.hasFVar || type.hasMVar) = false

private def prepareType (type : Expr) (model : InterfaceType) : CoreM PreparedType := do
  let type ← reduceConstructorFieldType type
  if closed : (type.hasLooseBVars || type.hasFVar || type.hasMVar) = false then
    return { type, model, closed }
  else
    throwError "JSON-safe writer requires a closed helper type; unresolved constructor-field dependency"

-- Recursive owners need names before their bodies are complete. Pending entries
-- never reach emission: prepare finalizes the entire graph first.
private structure PendingHelper where
  source : PreparedType
  name : Name
  body : Option Term := none
private structure State where
  helperPrefix : Name
  entries : Array PendingHelper := #[]
private abbrev BuildM := StateT State TermElabM

private structure PreparedHelper where
  source : PreparedType
  name : Name
  body : Term
private structure PreparedWriter where
  source : PreparedType
  root : Name
  helpers : Array PreparedHelper

private def append (out : Term) (text : String) : BuildM Term :=
  `(String.append $out $(quote text))
private def invoke (name : Name) (value out : Term) : BuildM Term :=
  `($(mkIdent name) $value $out)

private def fieldVar (index : Nat) : Term := ⟨mkIdent (.str .anonymous s!"field{index}")⟩

private def pattern (name : Name) (count : Nat) : BuildM Term := do
  let .ctorInfo ctor ← getConstInfo name | throwError "missing constructor {name}"
  let params ← (Array.replicate ctor.numParams ()).mapM fun _ => `(_)
  let fields := (Array.range count).map fieldVar
  `(@$(mkCIdent name) $params* $fields*)

/-- Resolve logical fields and instantiated types together, before planning any
child helper. Keep all source binders in the pattern, including erased proofs. -/
private def prepareConstructor (source : PreparedType) (name : Name)
    (models : Array InterfaceType) : BuildM (Array PreparedType × Term) := do
  let type ← reduceTypeAliases source.type
  let fields ← match instantiateConstructorFields (← getEnv) type name with
    | .ok fields => pure fields
    | .error error => throwError error.toMessageData
  if fields.size < models.size then throwError "writer constructor field/model mismatch: {name}"
  let prepared ← (fields.zip models).mapM fun (field, model) => prepareType field.type model
  return (prepared, ← pattern name fields.size)

private def preparedField (fields : Array PreparedType) (index : Nat) : BuildM PreparedType := do
  let some field := fields[index]? | throwError "missing prepared writer field {index}"
  return field

mutual
private partial def plan (source : PreparedType) (owners : Array Nat) : BuildM Name := do
  let model := source.model
  if let .recursiveRef _ _ depth := model then
    if depth >= owners.size then throwError "unbound writer recursive owner"
    let some owner := owners[owners.size - depth - 1]? | throwError "unbound writer recursive owner"
    let some entry := (← get).entries[owner]? | throwError "missing writer owner"
    return entry.name
  let state ← get
  if let some entry := state.entries.find? (fun entry =>
      (⟨entry.source.type⟩ : ExprStructEq) == ⟨source.type⟩ && entry.source.model == model) then
    return entry.name
  let index := state.entries.size
  let name := state.helperPrefix.str s!"write{index}"
  modify fun state => { state with entries := state.entries.push {source, name} }
  let nextOwners := match model with
    | .customInductive .. | .structure .. => owners.push index
    | _ => owners
  let body ← bodyFor source nextOwners ⟨mkIdent `value⟩ ⟨mkIdent `out⟩
  modify fun state => { state with entries := state.entries.modify index (fun entry => {entry with body := some body}) }
  return name

private partial def bodyFor (source : PreparedType) (owners : Array Nat)
    (value out : Term) : BuildM Term := do
  match source.model with
  | .unit => append out "null"
  | .nat => `(Vir.JsonSafeWriter.nat $value $out)
  | .int => `(Vir.JsonSafeWriter.int $value $out)
  | .uint64 => `(Vir.JsonSafeWriter.nat ($value).toNat $out)
  | .string => `(String.append $out (Lean.Json.renderString $value))
  | .bool => `(String.append $out (if $value then "true" else "false"))
  | .uint8 | .uint16 | .uint32 => `(Vir.JsonSafeWriter.unsigned ($value).toNat $out)
  | .byteArray => `(Vir.JsonSafeWriter.bytes $value $out)
  | .array element =>
      let type ← reduceTypeAliases source.type
      let some actualElement := type.getAppArgs[0]? | throwError "missing array type"
      let fn ← plan (← prepareType actualElement element) owners
      `(Vir.JsonSafeWriter.array $(mkIdent fn) $value $out)
  | .simpleEnum name constructors =>
      let alternatives ← constructors.mapM fun ctor => do
        let output ← append out (Json.renderString (constructorLabel name ctor))
        `(Parser.Term.matchAltExpr| | $(mkCIdent ctor) => $output)
      `(match ($value) with $alternatives:matchAlt*)
  | .structure _ _ descriptor =>
      if descriptor.fields.any (·.isSubobject) then
        throwError "inherited record fields are not yet supported by this writer"
      let (fields, pat) ← prepareConstructor source descriptor.constructorName
        (descriptor.fields.map (·.type))
      let mut output ← append out "{"
      for h : index in [:descriptor.fields.size] do
        let field := descriptor.fields[index]
        -- Classification preserves constructor order; only the trailing
        -- Char/Fin proof field is omitted from supported record descriptors.
        let fn ← plan (← preparedField fields index) owners
        let fieldPrefix := (if index == 0 then "" else ",") ++ Json.renderString field.name ++ ":"
        output ← invoke fn (fieldVar index) (← append output fieldPrefix)
      output ← append output "}"
      `(match ($value) with | $pat => $output)
  | .libraryAdapter _ _ descriptor =>
      let signature ← Meta.whnf (← getConstInfo descriptor.encode).type
      let .forallE _ _ actualWire _ := signature | throwError "unexpected adapter encoder"
      let fn ← plan (← prepareType actualWire descriptor.wire) #[]
      invoke fn (← `(@$(mkCIdent descriptor.encode) $value)) out
  | .customInductive name _ constructors =>
      if let some element := linkedListElement? name constructors then
        let (fields, _) ← prepareConstructor source `List.cons #[element]
        let fn ← plan (← preparedField fields 0) owners
        return ← `(Vir.JsonSafeWriter.list $(mkIdent fn) $value $out)
      let mut alternatives := #[]
      for h : index in [:constructors.size] do
        let ctor := constructors[index]
        let kind := constructorLabel name ctor.constructorName
        let payload := constructorPayload ctor.fields
        let (fields, pat) ← prepareConstructor source ctor.constructorName
          (ctor.fields.map (·.type))
        let mut output ← append out ("{\"kind\":" ++ Json.renderString kind)
        if let .value _ := payload then
          let fn ← plan (← preparedField fields 0) owners
          output ← invoke fn (fieldVar 0) (← append output ",\"value\":")
        else if let .fields payloadFields := payload then
          output ← append output ",\"fields\":{"
          for h : fieldIndex in [:payloadFields.size] do
            let field := payloadFields[fieldIndex]
            let fn ← plan (← preparedField fields fieldIndex) owners
            let fieldPrefix := (if fieldIndex == 0 then "" else ",") ++ Json.renderString field.name ++ ":"
            output ← invoke fn (fieldVar fieldIndex) (← append output fieldPrefix)
          output ← append output "}"
        output ← append output "}"
        alternatives := alternatives.push (← `(Parser.Term.matchAltExpr| | $pat => $output))
      `(match ($value) with $alternatives:matchAlt*)
  | _ => throwError "unsupported JSON-safe writer domain: {source.model.label}"
end

/-- No declarations are added until every helper is closed, supported and has a
complete body. Adapter signatures and numeric choices are resolved here too;
emission only elaborates this prepared result. Native classification alone does
not promise writer capability. -/
private def prepare (name : Name) (type : Expr) : TermElabM PreparedWriter := do
  let model ← match ← interfaceType type with
    | .ok model => pure model
    | .error error => throwError error.toMessageData
  let source ← prepareType type model
  let (root, state) ← (plan source #[]).run { helperPrefix := name.str "_codec" }
  let helpers ← state.entries.mapM fun entry => do
    let some body := entry.body | throwError "incomplete writer helper: {entry.name}"
    pure { source := entry.source, name := entry.name, body : PreparedHelper }
  return { source, root, helpers }

private def emit (name : Name) (writer : PreparedWriter) : TermElabM Unit := do
  let mut views := #[]
  for entry in writer.helpers do
    let definition ← `(Parser.Command.definition|
      def $(mkIdent <| `_root_ ++ entry.name)
        ($(mkIdent `value) : $(← Term.exprToSyntax entry.source.type))
        ($(mkIdent `out) : String) : String := $(entry.body))
    views := views.push (Command.mkDefViewOfDef
      { visibility := .private, recKind := .partial } definition)
  Term.elabMutualDef #[] { header := "" } views
  let definition ← `(Parser.Command.definition|
    def $(mkIdent <| `_root_ ++ name)
      ($(mkIdent `value) : $(← Term.exprToSyntax writer.source.type)) : String :=
        $(mkIdent writer.root) $(mkIdent `value) "")
  Term.elabMutualDef #[] { header := "" }
    #[Command.mkDefViewOfDef { visibility := .public } definition]

/-- Generate a typed JSON-safe String writer from the ordinary classified boundary.
Traversal helpers are private; the named root can be used by an application
wrapper. Call from `run_elab` with a fully qualified name and closed source type.
Unsupported domains fail preparation instead of selecting a `ToJson` fallback. -/
def generate (name : Name) (type : Expr) : TermElabM Unit := do
  if (← getEnv).contains name then throwError "writer declaration already exists: {name}"
  emit name (← prepare name type)

end Vir.Interface.JsonSafeWriter
