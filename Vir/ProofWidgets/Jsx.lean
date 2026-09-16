/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Authors: Emilio J. Gallego Arias, Wojciech Nawrocki, Sebastian Ullrich,
  Eric Wieser
-/

module

public import Vir.ProofWidgets.Html

public section

/-!
JSX syntax for VIR's native, client-executed ProofWidgets HTML facade.

The parser follows the familiar ProofWidgets JSX surface, but its lowering is
deliberately native: lowercase tags lower directly to React-node construction
actions and uppercase tags lower to Lean-authored component actions. It does
not construct upstream ProofWidgets' serializable RPC `Html` tree.

The parser structure is adapted under Apache-2.0 from
`ProofWidgets/Data/Html.lean` at ProofWidgets4 commit
`ef8377f31b5535430b6753a974d685b0019d0681`. VIR owns the rewritten lowering
to native React values.
-/

namespace Lean.Vir.ProofWidgets.Jsx

open Lean Parser PrettyPrinter

/-- Emit an ordinary identity term after checking the relevant child/props shape.
No private runtime constant or unsafe implementation must escape this module. -/
private meta def phantomCast (value : Term) : MacroM Term :=
  `((fun (nativeValue : Lean.Vir.Js _) =>
      (show Lean.Vir.Js _ from by
        unfold Lean.Vir.Js at *
        exact nativeValue)) $value)

-- Verbose names avoid collisions with other packages' unscoped parser categories.
declare_syntax_cat virProofWidgetsJsxElement
declare_syntax_cat virProofWidgetsJsxChild
declare_syntax_cat virProofWidgetsJsxAttr
declare_syntax_cat virProofWidgetsJsxAttrVal
declare_syntax_cat virProofWidgetsJsxTag

meta def jsxTag : Parser :=
  withAntiquot (mkAntiquot "jsxTag" `Lean.Vir.ProofWidgets.Jsx.jsxTag) {
    fn := fun c s =>
      let startPos := s.pos
      let s := takeWhile1Fn (fun c =>
        c.isAlphanum || c == '_' || c == '-' || c == '.' || c == ':')
        "expected JSX tag" c s
      mkNodeToken `Lean.Vir.ProofWidgets.Jsx.jsxTag startPos true c s }

meta def getJsxTag : TSyntax ``jsxTag → String
  | stx => stx.raw[0].getAtomVal

@[combinator_formatter Lean.Vir.ProofWidgets.Jsx.jsxTag]
meta def jsxTag.formatter : Formatter :=
  Formatter.visitAtom ``jsxTag

@[combinator_parenthesizer Lean.Vir.ProofWidgets.Jsx.jsxTag]
meta def jsxTag.parenthesizer : Parenthesizer :=
  Parenthesizer.visitToken

scoped syntax jsxTag : virProofWidgetsJsxTag

/-- Reads one declared field from a typed native props object. -/
scoped syntax:max "js_field% " term:arg str : term

scoped syntax str : virProofWidgetsJsxAttrVal
/-- Interpolates an expression into a JSX attribute value. -/
scoped syntax group("{" term "}") : virProofWidgetsJsxAttrVal
scoped syntax jsxTag "=" virProofWidgetsJsxAttrVal : virProofWidgetsJsxAttr
/-- Supplies a complete native props object; cannot be combined with other attributes. -/
scoped syntax group(" @props={" term "}") : virProofWidgetsJsxAttr
/-- Recognized only to diagnose the removed, misleading exact-props spelling. -/
scoped syntax group(" {..." term "}") : virProofWidgetsJsxAttr

/-- Characters not allowed inside JSX plain text. -/
meta def jsxTextForbidden : String := "{<>}$"

/-- A plain text literal lowered to `Html.text`. -/
meta def jsxText : Parser :=
  withAntiquot (mkAntiquot "jsxText" `Lean.Vir.ProofWidgets.Jsx.jsxText) {
    fn := fun c s =>
      let startPos := s.pos
      let s := takeWhile1Fn (fun c => !jsxTextForbidden.contains c)
        "expected JSX text" c s
      mkNodeToken `Lean.Vir.ProofWidgets.Jsx.jsxText startPos true c s }

meta def getJsxText : TSyntax ``jsxText → String
  | stx => stx.raw[0].getAtomVal

@[combinator_formatter Lean.Vir.ProofWidgets.Jsx.jsxText]
meta def jsxText.formatter : Formatter :=
  Formatter.visitAtom ``jsxText

@[combinator_parenthesizer Lean.Vir.ProofWidgets.Jsx.jsxText]
meta def jsxText.parenthesizer : Parenthesizer :=
  Parenthesizer.visitToken

scoped syntax "<" virProofWidgetsJsxTag virProofWidgetsJsxAttr* "/>" : virProofWidgetsJsxElement
scoped syntax "<" virProofWidgetsJsxTag virProofWidgetsJsxAttr* ">" virProofWidgetsJsxChild* "</"
  virProofWidgetsJsxTag ">" :
  virProofWidgetsJsxElement

scoped syntax jsxText : virProofWidgetsJsxChild
/-- Retained only to diagnose the removed Lean-array child spread. -/
scoped syntax "{..." term "}" : virProofWidgetsJsxChild
/-- Inserts a supported native React child value, or executes its construction action. -/
scoped syntax "{" term "}" : virProofWidgetsJsxChild
scoped syntax virProofWidgetsJsxElement : virProofWidgetsJsxChild

scoped syntax:max virProofWidgetsJsxElement : term

-- Internal elaboration node: only JSX interpolation inserts this syntax.
syntax (name := nativeChild) "vir_native_child% " term : term

-- React's key is element metadata, not a field in the component's props schema.
syntax (name := nativeKey) "vir_native_key% " term : term

private meta partial def isNativeKeyShape (type : Lean.Expr) : Lean.MetaM Bool := do
  let type ← Lean.Meta.whnf type
  if #[``String, ``Float, ``Nat, ``Lean.Vir.Js.Undefined.Value].any type.isConstOf then
    return true
  for constructor in #[``Lean.Vir.Js.Nullable.Value, ``Lean.Vir.Js.UndefinedOr.Value] do
    if type.isAppOfArity constructor 1 then
      return ← isNativeKeyShape type.appArg!
  return false

elab_rules : term
  | `(vir_native_key% $key) => do
    let value ← Lean.Elab.Term.elabTerm key none
    let type ← Lean.Meta.whnf (← Lean.Meta.inferType value)
    unless type.isAppOfArity ``Lean.Vir.Js 1 && (← isNativeKeyShape type.appArg!) do
      throwErrorAt key "JSX key expects a native string, number or bigint, optionally null or undefined"
    return value

elab_rules : term
  | `(vir_native_child% $child) => do
    let value ← Lean.Elab.Term.elabTerm child none
    let type ← Lean.Meta.whnf (← Lean.Meta.inferType value)
    let valueSyntax ← Lean.Elab.Term.exprToSyntax value
    let node := Lean.mkApp (Lean.mkConst ``Lean.Vir.Js) (Lean.mkConst ``Lean.Vir.React.Node)
    let action := Lean.mkApp (Lean.mkConst ``Lean.Vir.React.ReactM) node
    let lowered ← if type.isAppOfArity ``Lean.Vir.Js 1 then do
        Lean.Elab.liftMacroM `(pure (Lean.Vir.React.Node.ofJs $valueSyntax))
      else
        let shape ← Lean.Meta.mkFreshTypeMVar
        let result := Lean.mkApp (Lean.mkConst ``Lean.Vir.Js) shape
        let runtimeAction := Lean.mkApp (Lean.mkConst ``Lean.Vir.RuntimeM) result
        unless ← Lean.Meta.isDefEq type runtimeAction do
          throwErrorAt child "JSX children must be native values or actions returning native values; Lean arrays are not supported"
        Lean.Elab.liftMacroM `(do
          let nativeValue ← ($valueSyntax)
          vir_native_child% nativeValue)
    Lean.Elab.Term.elabTermEnsuringType lowered action

private meta def trailingWhitespace (stx : Syntax) : String :=
  if let .original _ _ trailing _ := stx.getTailInfo then
    trailing.toString
  else
    ""

private meta def tagName (tag : TSyntax `virProofWidgetsJsxTag) : MacroM String :=
  match tag with
  | `(virProofWidgetsJsxTag| $name:jsxTag) => return getJsxTag name
  | stx => Macro.throwErrorAt stx "unknown JSX tag syntax"

private meta def nameFromDotted (text : String) : Name :=
  text.splitOn "." |>.foldl (fun name part =>
    if part.isEmpty then name else .str name part) .anonymous

private meta def componentIdent (tag : TSyntax `virProofWidgetsJsxTag) : MacroM Ident := do
  let name ← tagName tag
  if name.contains '-' || name.contains ':' then
    Macro.throwErrorAt tag "expected a Lean component identifier"
  -- This is a reference written by the user, not a generated identifier. Keep
  -- its original range so Lean's reference tools and unused-variable linter
  -- see the component use in the macro expansion.
  return ⟨Syntax.ident tag.raw.getHeadInfo name.toRawSubstring (nameFromDotted name) []⟩

private meta def transformTag
    (tk : Syntax)
    (opening closing : TSyntax `virProofWidgetsJsxTag)
    (attrs : Array (TSyntax `virProofWidgetsJsxAttr))
    (childrenSyntax : Array (TSyntax `virProofWidgetsJsxChild))
    (sealProps := false) : MacroM Term := do
  let openingName ← tagName opening
  let closingName ← tagName closing
  if openingName != closingName then
    Macro.throwErrorAt closing s!"expected </{openingName}>"

  let propsId ← mkIdent <$> Macro.addMacroScope `props
  let childrenId ← mkIdent <$> Macro.addMacroScope `children
  let mut writes : Array (TSyntax `doElem) := #[]
  let suppliedProps ← if attrs.size == 1 then
      match attrs[0]! with
      | `(virProofWidgetsJsxAttr| @props={ $value:term }) => pure (some value)
      | _ => pure none
    else pure none
  match suppliedProps with
  | some value =>
    writes := writes.push <| ← `(doElem| let $propsId := $value)
  | none =>
    writes := writes.push <| ← `(doElem| let $propsId ← Lean.Vir.Js.Object.empty)
    for attr in attrs do
      let (name, value) ← match attr with
        | `(virProofWidgetsJsxAttr| $name:jsxTag = $value:str) =>
          pure (getJsxTag name, ← `(← Lean.Vir.JsValue.ofString $value))
        | `(virProofWidgetsJsxAttr| $name:jsxTag = { $value:term }) =>
          pure (getJsxTag name, ← Lean.Vir.Js.liftConstructionString value)
        | `(virProofWidgetsJsxAttr| @props={ $_value:term }) =>
          Macro.throwErrorAt attr "@props must be supplied alone; construct or update the object explicitly"
        | `(virProofWidgetsJsxAttr| {... $_value:term }) =>
          Macro.throwErrorAt attr "JSX object spread is not implemented; use @props={value} to pass exact native props"
        | stx => Macro.throwErrorAt stx "unknown JSX attribute syntax"
      if name == "__proto__" then
        Macro.throwErrorAt attr "JSX attributes do not support `__proto__`; use explicit property operations for prototype semantics"
      writes := writes.push <| ← `(doElem|
        Lean.Vir.Js.Construction.field $propsId (← Lean.Vir.JsValue.ofString $(quote name)) $value)
  writes := writes.push <| ← `(doElem| let $childrenId ← Lean.Vir.Js.Array.empty)
  let mut whitespaceBefore := trailingWhitespace tk
  for child in childrenSyntax do
    let action ← match child with
      | `(virProofWidgetsJsxChild| $text:jsxText) =>
        let value := whitespaceBefore ++ getJsxText text
        whitespaceBefore := ""
        `(Lean.Vir.React.Node.text (← Lean.Vir.JsValue.ofString $(quote value)))
      | `(virProofWidgetsJsxChild| { $term }%$childToken) =>
        whitespaceBefore := trailingWhitespace childToken
        `(vir_native_child% $term)
      | `(virProofWidgetsJsxChild| $element:virProofWidgetsJsxElement) =>
        whitespaceBefore := trailingWhitespace element
        `($element:virProofWidgetsJsxElement)
      | `(virProofWidgetsJsxChild| {... $_term }%$childToken) =>
        Macro.throwErrorAt childToken "JSX child spread has been removed; insert a native array of supported React child values with {children}"
      | stx => Macro.throwErrorAt stx "unknown JSX child syntax"
    writes := writes.push <| ← `(doElem|
      Lean.Vir.Js.Construction.element $childrenId (← ($action)))
  let result ← if openingName.front.isUpper then
      let component ← componentIdent opening
      let closingComponent ← componentIdent closing
      let props ← if sealProps then
          phantomCast propsId
        else pure (propsId : Term)
      `(Lean.Vir.React.Node.functionComponent
        (with_annotate_term $closingComponent $component) $props $childrenId)
    else
      `(Lean.Vir.React.Node.createElement
        (← Lean.Vir.React.ElementType.tag (← Lean.Vir.JsValue.ofString $(quote openingName)))
        $propsId $childrenId)
  `(show Lean.Vir.React.ReactM (Lean.Vir.Js Lean.Vir.React.Node) from do
    $[$writes:doElem]*
    ($result))

private meta def propsSchema? (component : Ident) : Lean.Elab.Term.TermElabM (Option Name) := do
  let value ← Lean.Elab.Term.elabTerm component none
  let type ← Lean.Meta.whnf (← Lean.Meta.inferType value)
  if !type.isAppOfArity ``Lean.Vir.Js 1 then
    return none
  let function := type.appArg!
  if !function.isAppOfArity ``Lean.Vir.Js.Function.Unary 2 then
    return none
  let argument := function.getArg! 0
  if !argument.isAppOfArity ``Lean.Vir.Js 1 then
    return none
  let props := argument.appArg!
  if props.getAppNumArgs != 0 then
    return none
  let some name := props.constName? | return none
  if (Lean.getStructureInfo? (← Lean.getEnv) name).isNone then
    return none
  return some name

private meta def schemaFields (schema : Name) : Lean.Elab.Term.TermElabM (Array (String × Lean.Expr)) := do
  let info := Lean.getStructureInfo (← Lean.getEnv) schema
  unless info.parentInfo.isEmpty do
    throwError "JSX props schemas do not support inherited fields"
  info.fieldNames.mapIdxM fun index field => do
    let fieldText := field.getString!
    if fieldText == "__proto__" || fieldText == "key" || fieldText == "children" then
      throwError "JSX props schema `{schema}` uses reserved field `{fieldText}`"
    let some projection := info.getProjFn? index |
      throwError "JSX props schema `{schema}` has no projection for field `{fieldText}`"
    let declaration ← Lean.getConstInfo projection
    Lean.Meta.forallTelescopeReducing declaration.type fun arguments result => do
      let result ← Lean.Meta.whnf result
      if arguments.size != 1 || result.hasFVar then
        throwError "JSX props schema `{schema}` has dependent field `{field}`; dependent schemas are unsupported"
      if !result.isAppOfArity ``Lean.Vir.Js 1 then
        throwError "JSX props schema `{schema}` field `{field}` must have type `Lean.Vir.Js α`"
      pure (field.getString!, result)

private meta def typedAttributes
    (schema : Name) (attrs : Array (TSyntax `virProofWidgetsJsxAttr)) :
    Lean.Elab.Term.TermElabM (Array (TSyntax `virProofWidgetsJsxAttr)) := do
  let fields ← schemaFields schema
  let mut names : Array String := #[]
  let mut checked := #[]
  for attr in attrs do
    let (nameSyntax, value) ← match attr with
      | `(virProofWidgetsJsxAttr| $name:jsxTag = $value:str) =>
        pure (name, ← Lean.Elab.liftMacroM `(← Lean.Vir.JsValue.ofString $value))
      | `(virProofWidgetsJsxAttr| $name:jsxTag = { $value:term }) =>
        pure (name, ← Lean.Elab.liftMacroM (Lean.Vir.Js.liftConstructionString value))
      | `(virProofWidgetsJsxAttr| @props={ $_value:term }) =>
        throwErrorAt attr "`@props` is an exact native-props escape hatch and must be supplied alone"
      | `(virProofWidgetsJsxAttr| {... $_value:term }) =>
        throwErrorAt attr "JSX object spread is not implemented; use the exact native-props syntax"
      | _ => throwErrorAt attr "unknown JSX attribute syntax"
    let name := getJsxTag nameSyntax
    if names.contains name then
      throwErrorAt attr s!"duplicate JSX prop `{name}`"
    if name == "key" then
      checked := checked.push (← Lean.Elab.liftMacroM
        `(virProofWidgetsJsxAttr| $nameSyntax:jsxTag = { vir_native_key% $value }))
      names := names.push name
      continue
    if name == "children" then
      throwErrorAt attr "supply children between the JSX tags, or use the native exact-props escape hatch"
    let some (_, expected) := fields.find? fun (field, _) => field == name |
      throwErrorAt attr s!"unknown JSX prop `{name}` for schema `{schema}`"
    -- Constrain the actual emitted expression, including monadic lifts. A
    -- separate preflight elaboration could choose different implicit types.
    let expectedSyntax ← Lean.Elab.Term.exprToSyntax expected
    checked := checked.push (← Lean.Elab.liftMacroM
      `(virProofWidgetsJsxAttr| $nameSyntax:jsxTag = { ($value : $expectedSyntax) }))
    names := names.push name
  for (field, _) in fields do
    unless names.contains field do
      throwError "missing required JSX prop `{field}` for schema `{schema}`"
  return checked
private meta def isExactProps (attrs : Array (TSyntax `virProofWidgetsJsxAttr)) : Bool :=
  attrs.size == 1 && match attrs[0]! with
    | `(virProofWidgetsJsxAttr| @props={ $_value:term }) => true
    | _ => false

private meta def schemaOfObject (object : Term) : Lean.Elab.Term.TermElabM Name := do
  let value ← Lean.Elab.Term.elabTerm object none
  let type ← Lean.Meta.whnf (← Lean.Meta.inferType value)
  unless type.isAppOfArity ``Lean.Vir.Js 1 do
    throwErrorAt object "`js_field%` expects a JavaScript-owned typed props object"
  let schema := type.appArg!
  if schema.getAppNumArgs != 0 then
    throwErrorAt object "`js_field%` does not support parameterized or dependent props schemas"
  let some name := schema.constName? |
    throwErrorAt object "`js_field%` expects a declared props schema structure"
  unless (Lean.getStructureInfo? (← Lean.getEnv) name).isSome do
    throwErrorAt object "`js_field%` expects a declared props schema structure"
  return name

elab_rules : term
  | `(js_field% $object $field:str) => do
    let schema ← schemaOfObject object
    let name := field.getString
    let fields ← schemaFields schema
    let some (_, fieldType) := fields.find? fun (candidate, _) => candidate == name |
      throwErrorAt field s!"unknown declared JSX prop `{name}` for schema `{schema}`"
    let resultType := Lean.mkApp (Lean.mkConst ``Lean.Vir.RuntimeM) fieldType
    let objectType ← Lean.Elab.Term.exprToSyntax
      (Lean.mkApp (Lean.mkConst ``Lean.Vir.Js) (Lean.mkConst schema))
    let valueId ← Lean.Elab.liftMacroM (mkIdent <$> Macro.addMacroScope `value)
    let narrowed ← Lean.Elab.liftMacroM (phantomCast valueId)
    Lean.Elab.Term.elabTermEnsuringType (← Lean.Elab.liftMacroM `(term| do
      let $valueId ← Lean.Vir.Js.Object.get ($object : $objectType) (← Lean.Vir.JsValue.ofString $(quote name))
      pure $narrowed)) resultType

private meta def elabTag
    (tk : Syntax) (opening closing : TSyntax `virProofWidgetsJsxTag)
    (attrs : Array (TSyntax `virProofWidgetsJsxAttr))
    (children : Array (TSyntax `virProofWidgetsJsxChild)) : Lean.Elab.Term.TermElabM Lean.Expr := do
  let tag ← Lean.Elab.liftMacroM (tagName opening)
  let (attrs, sealProps) ← if tag.front.isUpper && !isExactProps attrs then do
      let component ← Lean.Elab.liftMacroM (componentIdent opening)
      if let some schema ← propsSchema? component then
        pure (← typedAttributes schema attrs, true)
      else
        pure (attrs, false)
    else pure (attrs, false)
  Lean.Elab.Term.elabTerm (← Lean.Elab.liftMacroM
    (transformTag tk opening closing attrs children sealProps)) none

elab_rules : term
  | `(<$name:virProofWidgetsJsxTag $[$attrs:virProofWidgetsJsxAttr]* />%$tk) =>
    elabTag tk name name attrs #[]
  | `(<$opening:virProofWidgetsJsxTag $[$attrs:virProofWidgetsJsxAttr]* >%$tk
      $children*</$closing>) =>
    elabTag tk opening closing attrs children

end Lean.Vir.ProofWidgets.Jsx
