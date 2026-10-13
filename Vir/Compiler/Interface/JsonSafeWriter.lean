/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
-/
module
public import Vir.Compiler.Interface.Classify.Core
import Vir.Compiler.Interface.Classify.Reduce
import Vir.Compiler.Interface.Classify.Basic
import Vir.Compiler.Interface.Encode
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
  `($out ++ $(quote text))
private def invoke (name : Name) (value out : Term) : BuildM Term :=
  `($(mkIdent name) $value $out)

/-- Use the constructor's instantiated type, including private fields. Types
remain Exprs until elaboration; no pretty-printing or reparsing is involved. -/
private def ctorFields (type : Expr) (name : Name) : MetaM (Array (String × Expr)) := do
  let type ← reduceTypeAliases type
  let .ctorInfo ctor ← getConstInfo name | throwError "missing constructor {name}"
  let mut ctorType := ctor.toConstantVal.instantiateTypeLevelParams type.getAppFn.constLevels!
  for parameter in type.getAppArgs do
    let .forallE _ _ body _ := ctorType | throwError "constructor parameter mismatch"
    ctorType := body.instantiate1 parameter
  let mut fields := #[]
  while let .forallE name domain body _ := ctorType do
    fields := fields.push (name.toString, domain)
    ctorType := body
  return fields

private def fieldInfo (fields : Array (String × Expr)) (name : String) : MetaM (Nat × Expr) := do
  for h : index in [:fields.size] do
    let (rawName, type) := fields[index]
    if rawName == name || binderArgName (index + 1) (.str .anonymous rawName) == name then
      return (index, type)
  throwError "writer field {name} is not a constructor argument"

private def fieldVar (index : Nat) : Term := ⟨mkIdent (.str .anonymous s!"field{index}")⟩

private def pattern (name : Name) (count : Nat) : BuildM Term := do
  let .ctorInfo ctor ← getConstInfo name | throwError "missing constructor {name}"
  let params ← (Array.replicate ctor.numParams ()).mapM fun _ => `(_)
  let fields := (Array.range count).map fieldVar
  `(@$(mkCIdent name) $params* $fields*)

mutual
private partial def plan (type : Expr) (model : InterfaceType) (owners : Array Nat) : BuildM Name := do
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
  | .nat | .int | .uint64 => `($out ++ Lean.Json.renderString (toString $value))
  | .string => `($out ++ Lean.Json.renderString $value)
  | .bool => `($out ++ (if $value then "true" else "false"))
  | .uint8 | .uint16 | .uint32 => `($out ++ toString ($value).toNat)
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
        let (actualIndex, actualType) ← fieldInfo fields field.name
        let fn ← plan actualType field.type owners
        let fieldPrefix := (if index == 0 then "" else ",") ++ Json.renderString field.name ++ ":"
        output ← invoke fn (fieldVar actualIndex) (← append output fieldPrefix)
      output ← append output "}"
      let pat ← pattern descriptor.constructorName fields.size
      `(match ($value) with | $pat => $output)
  | .libraryAdapter _ _ descriptor =>
      let encode ← getConstInfo descriptor.encode
      let .forallE _ _ actualWire _ := encode.type | throwError "unexpected adapter encoder"
      let fn ← plan actualWire descriptor.wire #[]
      invoke fn (← `($(mkCIdent descriptor.encode) $value)) out
  | .customInductive _ _ constructors =>
      -- Reuse the producer's selected view instead of assigning another payload
      -- shape or another policy for a linked List representation.
      let .ok pair := Json.parse model.toJson | throwError "invalid emitted pair"
      let view ← ofExcept (pair.getObjVal? "value")
      if (← ofExcept (view.getObjValAs? String "tag")) == "sequence" then
        let some ctor := constructors[1]? | throwError "missing linked constructor"
        let fields ← ctorFields type ctor.constructorName
        let some head := ctor.fields[0]? | throwError "missing linked element"
        let fn ← plan fields[0]!.2 head.type owners
        return ← `(Vir.JsonSafeWriter.list $(mkIdent fn) $value $out)
      let cases ← ofExcept (← ofExcept (view.getObjVal? "cases")).getArr?
      let mut alternatives := #[]
      for h : index in [:constructors.size] do
        let ctor := constructors[index]
        let case := cases[index]!
        let kind ← ofExcept (case.getObjValAs? String "kind")
        let payload ← ofExcept (case.getObjValAs? String "payload")
        let fields ← ctorFields type ctor.constructorName
        let mut output ← append out ("{\"kind\":" ++ Json.renderString kind)
        if payload == "value" then
          let some field := ctor.fields[0]? | throwError "missing variant value field"
          let (actualIndex, actualType) ← fieldInfo fields field.name
          let fn ← plan actualType field.type owners
          output ← invoke fn (fieldVar actualIndex) (← append output ",\"value\":")
        else if payload == "fields" then
          output ← append output ",\"fields\":{"
          for h : fieldIndex in [:ctor.fields.size] do
            let field := ctor.fields[fieldIndex]
            let (actualIndex, actualType) ← fieldInfo fields field.name
            let fn ← plan actualType field.type owners
            let fieldPrefix := (if fieldIndex == 0 then "" else ",") ++ Json.renderString field.name ++ ":"
            output ← invoke fn (fieldVar actualIndex) (← append output fieldPrefix)
          output ← append output "}"
        output ← append output "}"
        let pat ← pattern ctor.constructorName fields.size
        alternatives := alternatives.push (← `(Parser.Term.matchAltExpr| | $pat => $output))
      `(match ($value) with $alternatives:matchAlt*)
  | _ => throwError "unsupported JSON-safe writer domain: {model.label}"
end

/-- Internal experimental producer entry point. Generate a typed String writer
from the ordinary classified boundary. Traversal helpers are private; the named
root can be used by an application wrapper. This is not a public view-selection
syntax or a published JSON wire contract. -/
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
