/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Authors: Emilio J. Gallego Arias, Wojciech Nawrocki, Sebastian Ullrich,
  Eric Wieser
-/

module

public import Vir.ProofWidgets.Html
public meta import Lean.Data.Html.Syntax
public meta import Lean.Data.Html.Elab

public section

/-!
JSX syntax for VIR's native, client-executed ProofWidgets HTML facade.

A `jsx%{...}` literal contains a single root element. Elements are parsed with
Lean's HTML syntax (`Lean.Html.Syntax`), so tag names, attributes, text, HTML
comments and character references follow its rules.

The lowering is deliberately native: lowercase tags lower directly to
React-node construction actions and uppercase tags lower to Lean-authored
component actions. It does not construct upstream ProofWidgets' serializable
RPC `Html` tree, nor Lean's `Lean.Html` document tree.
-/

namespace Lean.Vir.ProofWidgets.Jsx

open Lean Parser
open Lean.Html.Syntax (Content Element ElementView TagName Attr rawSymbol content
  decodeCharacterReferences)

/-- Marks a schema projection as optional in JSX. Its declared type describes
present values; reading it with `js_field%` additionally admits `undefined`.
This is schema metadata only: omitted fields are not written or defaulted. -/
meta initialize jsOptionalAttr : TagAttribute ←
  registerTagAttribute `js_optional "optional native JSX props schema field" fun name => do
    unless (← getEnv).getProjectionFnInfo? name |>.isSome do
      throwError "`js_optional` applies only to a props schema field projection"

/-- Emit an ordinary identity term after checking the relevant child/props shape.
No private runtime constant or unsafe implementation must escape this module. -/
private meta def phantomCast (value : Term) : MacroM Term :=
  `((fun (nativeValue : Lean.Vir.Js _) =>
      (show Lean.Vir.Js _ from by
        unfold Lean.Vir.Js at *
        exact nativeValue)) $value)

/-- The body `{ <element> }` of a `jsx%{...}` literal. As in `html%{...}`, the
opening brace does not consume whitespace, so HTML content receives it. -/
@[run_parser_attribute_hooks]
meta def jsxBody : Parser :=
  rawSymbol "{" >> content >> symbol "}"

/-- A JSX literal `jsx%{<tag attr*>content</tag>}` with a single root element.

Attributes are `name="text"`, `name={value}` or `name` (JavaScript `true`).
Children are text, elements and `{value}` interpolations. -/
syntax:max (name := jsx) "jsx%" jsxBody : term

/-- Reads one declared field from a typed native props object. -/
scoped syntax:max "js_field% " term:arg str : term

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

private meta def nameFromDotted (text : String) : Name :=
  text.splitOn "." |>.foldl (fun name part =>
    if part.isEmpty then name else .str name part) .anonymous

private meta def isComponentName (text : String) : Bool :=
  text.splitOn "." |>.all fun part =>
    !part.isEmpty && isIdFirst part.front && part.all isIdRest

private meta def componentIdent (tag : TagName) : CoreM Ident := do
  let name ← tag.view
  unless isComponentName name do
    throwErrorAt tag "expected a Lean component identifier"
  -- This is a reference written by the user, not a generated identifier. Keep
  -- its original range so Lean's reference tools and unused-variable linter
  -- see the component use in the macro expansion.
  return ⟨Syntax.ident tag.raw.getHeadInfo name.toRawSubstring (nameFromDotted name) []⟩

/-- Unlike HTML, JSX tag names are case-sensitive, so end tags must match exactly. -/
private meta def checkEndTag (elem : ElementView) : CoreM Unit := do
  let some endTag := elem.endTag? | return
  let startName ← elem.startTag.name.view
  let endName ← endTag.name.view
  if endName != startName then
    let hint ← MessageData.hint m!"Replace with start tag" #[startName] (ref? := endTag.name)
    throwErrorAt endTag.name m!"Mismatched end tag, expected `{startName}` but got `{endName}`{hint}"

/-- A named JSX attribute and the construction term for its native value. -/
private meta structure NamedAttr where
  /-- The whole attribute, for error reporting. -/
  ref : Syntax
  name : String
  value : Term

/-- The props written on a start tag. -/
private meta inductive AttrsView where
  /-- A complete native props object supplied with `@props={value}`. -/
  | exact (props : Term)
  | named (attrs : Array NamedAttr)

private meta def viewAttrs (attrs : Array Attr) : Lean.Elab.Term.TermElabM AttrsView := do
  let mut named := #[]
  for attr in attrs do
    match ← attr.view with
    | .val { name := nameStx, val, .. } =>
      let name ← nameStx.view
      if name == "@props" then
        let .interp value ← val.view |
          throwErrorAt val "`@props` expects an interpolated native props object `@props=\{value}`"
        unless attrs.size == 1 do
          throwErrorAt attr "`@props` must be supplied alone; construct or update the object explicitly"
        return .exact (← value.view).term
      let value ← match ← val.view with
        | .str text =>
          `(← Lean.Vir.JsValue.ofString $(quote (← decodeCharacterReferences text)))
        | .interp value =>
          Lean.Elab.liftMacroM (Lean.Vir.Js.liftConstructionString (← value.view).term)
      named := named.push { ref := attr, name, value }
    | .bool nameStx =>
      let name ← nameStx.view
      if name == "@props" then
        throwErrorAt attr "`@props` expects an interpolated native props object `@props=\{value}`"
      -- As in React JSX, an attribute without a value is `true`.
      let value ← `(← Lean.Vir.JsValue.ofBool true)
      named := named.push { ref := attr, name, value }
    | .interp true _ =>
      throwErrorAt attr "JSX object spread is not implemented; use @props=\{value} to pass exact native props"
    | .interp false _ =>
      throwErrorAt attr "JSX attributes must be named; use @props=\{value} to pass exact native props"
  for attr in named do
    if attr.name == "__proto__" then
      throwErrorAt attr.ref "JSX attributes do not support `__proto__`; use explicit property operations for prototype semantics"
  return .named named

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

private meta def schemaFields (schema : Name) :
    Lean.Elab.Term.TermElabM (Array (String × Lean.Expr × Bool)) := do
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
      pure (field.getString!, result, jsOptionalAttr.hasTag (← Lean.getEnv) projection)

private meta def typedAttributes (schema : Name) (attrs : Array NamedAttr) :
    Lean.Elab.Term.TermElabM (Array NamedAttr) := do
  let fields ← schemaFields schema
  let mut names : Array String := #[]
  let mut checked := #[]
  for attr in attrs do
    let name := attr.name
    if names.contains name then
      throwErrorAt attr.ref s!"duplicate JSX prop `{name}`"
    names := names.push name
    if name == "key" then
      checked := checked.push { attr with value := ← `(vir_native_key% $(attr.value)) }
      continue
    if name == "children" then
      throwErrorAt attr.ref "supply children between the JSX tags, or use the native exact-props escape hatch"
    let some (_, expected, _) := fields.find? fun (field, _, _) => field == name |
      throwErrorAt attr.ref s!"unknown JSX prop `{name}` for schema `{schema}`"
    -- Constrain the actual emitted expression, including monadic lifts. A
    -- separate preflight elaboration could choose different implicit types.
    let expectedSyntax ← Lean.Elab.Term.exprToSyntax expected
    checked := checked.push { attr with value := ← `(($(attr.value) : $expectedSyntax)) }
  for (field, _, isOptional) in fields do
    unless isOptional || names.contains field do
      throwError "missing required JSX prop `{field}` for schema `{schema}`"
  return checked

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
    let some (_, fieldType, isOptional) := fields.find? fun (candidate, _, _) => candidate == name |
      throwErrorAt field s!"unknown declared JSX prop `{name}` for schema `{schema}`"
    let shape ← Lean.Meta.whnf fieldType.appArg!
    let fieldType := if isOptional && !shape.isAppOfArity ``Lean.Vir.Js.UndefinedOr.Value 1 then
        Lean.mkApp (Lean.mkConst ``Lean.Vir.Js)
          (Lean.mkApp (Lean.mkConst ``Lean.Vir.Js.UndefinedOr.Value) fieldType.appArg!)
      else fieldType
    let resultType := Lean.mkApp (Lean.mkConst ``Lean.Vir.RuntimeM) fieldType
    let objectType ← Lean.Elab.Term.exprToSyntax
      (Lean.mkApp (Lean.mkConst ``Lean.Vir.Js) (Lean.mkConst schema))
    let valueId ← Lean.Elab.liftMacroM (mkIdent <$> Macro.addMacroScope `value)
    let narrowed ← Lean.Elab.liftMacroM (phantomCast valueId)
    Lean.Elab.Term.elabTermEnsuringType (← Lean.Elab.liftMacroM `(term| do
      let $valueId ← Lean.Vir.Js.Object.get ($object : $objectType) (← Lean.Vir.JsValue.ofString $(quote name))
      pure $narrowed)) resultType

/-- A `jsx%{...}` literal wrapping `element`, for elaborating nested elements. -/
private meta def mkJsx (element : Element) : Term :=
  ⟨mkNode ``jsx #[mkAtom "jsx%", mkAtom "{", mkNode Lean.Html.Syntax.contentKind #[element],
    mkAtom "}"]⟩

/-- Lowers the children of an element to child construction actions. -/
private meta def childActions (elem : ElementView) : Lean.Elab.Term.TermElabM (Array Term) := do
  let some children := elem.children? | return #[]
  let mut actions := #[]
  for child in ← children.view do
    match child with
    | .textComments text =>
      let value ← text.getText
      if value.isEmpty then continue
      actions := actions.push
        (← `(Lean.Vir.React.Node.text (← Lean.Vir.JsValue.ofString $(quote value))))
    | .interp false value =>
      actions := actions.push (← `(vir_native_child% $((← value.view).term)))
    | .interp true value =>
      throwErrorAt value "JSX child spread has been removed; insert a native array of supported React child values with \{children}"
    | .element element =>
      actions := actions.push (mkJsx element)
  return actions

private meta def transformElement (elem : ElementView) (attrs : AttrsView)
    (sealProps : Bool) : Lean.Elab.Term.TermElabM Term := do
  let tag ← elem.startTag.name.view
  let propsId := mkIdent (← MonadQuotation.addMacroScope `props)
  let childrenId := mkIdent (← MonadQuotation.addMacroScope `children)
  let mut writes : Array (TSyntax `doElem) := #[]
  match attrs with
  | .exact value =>
    writes := writes.push <| ← `(doElem| let $propsId := $value)
  | .named attrs =>
    let fields ← attrs.mapM fun attr =>
      `(term| ($(quote attr.name), Lean.Vir.Js.erase $(attr.value)))
    -- One host call batches construction, but changes failure ordering:
    -- all attribute effects run before any field is defined. If definition
    -- fails, later attribute effects have already run; children have not.
    writes := writes.push <| ← `(doElem|
      let $propsId ← Lean.Vir.Js.Construction.objectFromFields #[$[$fields],*])
  let childValues ← (← childActions elem).mapM fun action => `(← ($action))
  -- Likewise, all child effects run before structural lifting defines any
  -- child-array index. A lifting failure can follow later child effects than
  -- the former per-child path. Keep this policy explicit in JSX tests.
  writes := writes.push <| ← `(doElem|
    let $childrenId ← Lean.Vir.Js.Construction.arrayFromValues #[$[$childValues],*])
  let result ← if tag.front.isUpper then
      let component ← componentIdent elem.startTag.name
      let closingComponent ← componentIdent (elem.endTag?.getD elem.startTag).name
      let props ← if sealProps then
          Lean.Elab.liftMacroM (phantomCast propsId)
        else pure (propsId : Term)
      `(Lean.Vir.React.Node.functionComponent
        (with_annotate_term $closingComponent $component) $props $childrenId)
    else
      `(Lean.Vir.React.Node.createElement
        (← Lean.Vir.React.ElementType.tag (← Lean.Vir.JsValue.ofString $(quote tag)))
        $propsId $childrenId)
  `(show Lean.Vir.React.ReactM (Lean.Vir.Js Lean.Vir.React.Node) from do
    $[$writes:doElem]*
    ($result))

private meta def elabElement (stx : Element) : Lean.Elab.Term.TermElabM Lean.Expr := withRef stx do
  let elem ← stx.view
  checkEndTag elem
  let tag ← elem.startTag.name.view
  let isComponent := tag.front.isUpper
  unless isComponent do
    stx.checkNoVoidChildren
  let attrs ← viewAttrs elem.startTag.attrs
  let (attrs, sealProps) ← match attrs with
    | .named named =>
      if isComponent then
        if let some schema ← propsSchema? (← componentIdent elem.startTag.name) then
          pure (.named (← typedAttributes schema named), true)
        else pure (attrs, false)
      else pure (attrs, false)
    | .exact _ => pure (attrs, false)
  Lean.Elab.Term.elabTerm (← transformElement elem attrs sealProps) none

/-- Returns the root element of a `jsx%{...}` literal. Surrounding whitespace and
HTML comments are allowed; any other content is an error. -/
private meta def rootElement (stx : Content) : CoreM Element := do
  let mut root? := none
  for item in ← stx.view do
    match item with
    | .element element =>
      if root?.isSome then
        throwErrorAt element "`jsx%\{...}` must contain a single root element"
      root? := some element
    | .textComments text =>
      unless (← text.getText).trimAscii.isEmpty do
        throwErrorAt text.getSyntax "`jsx%\{...}` must contain a single root element, not text"
    | .interp _ value =>
      throwErrorAt value "`jsx%\{...}` must contain a single root element, not an interpolation"
  let some root := root? |
    throwErrorAt stx "`jsx%\{...}` must contain a single root element"
  return root

/-- Elaborates a JSX literal to a `ReactM (Js Node)` construction action. -/
@[term_elab jsx]
meta def elabJsx : Lean.Elab.Term.TermElab := fun stx _ => do
  elabElement (← rootElement ⟨stx[2]⟩)

end Lean.Vir.ProofWidgets.Jsx
