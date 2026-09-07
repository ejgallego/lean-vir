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

/-- Property values accepted by native JSX attributes. -/
class AttributeValue (α : Type) where
  toProperty : String → α → Lean.Vir.React.Property

instance : AttributeValue String where
  toProperty := Lean.Vir.React.Property.string

instance : AttributeValue Bool where
  toProperty := Lean.Vir.React.Property.bool

instance : AttributeValue Int where
  toProperty := Lean.Vir.React.Property.int

instance : AttributeValue Nat where
  toProperty name value := Lean.Vir.React.Property.int name (Int.ofNat value)

instance : AttributeValue Float where
  toProperty := Lean.Vir.React.Property.float

private def normalizeAttributeName : String → String
  | "inputName" | "formName" => "name"
  | "inputValue" => "value"
  | "ariaLabel" => "aria-label"
  | "ariaHidden" => "aria-hidden"
  | "ariaControls" => "aria-controls"
  | "ariaCurrent" => "aria-current"
  | "ariaDescribedBy" => "aria-describedby"
  | "ariaExpanded" => "aria-expanded"
  | "ariaLabelledBy" => "aria-labelledby"
  | "ariaLive" => "aria-live"
  | "ariaPressed" => "aria-pressed"
  | "ariaSelected" => "aria-selected"
  | "dataTestId" => "data-testid"
  | name => name

def property [AttributeValue α] (name : String) (value : α) : PropEntry :=
  .property <| AttributeValue.toProperty (normalizeAttributeName name) value

def style (entries : Array (String × String)) : PropEntry :=
  Lean.Vir.React.Props.stylePairs entries

def classList (classes : Array String) : PropEntry :=
  Lean.Vir.React.Props.classList classes

def key (value : String) : PropEntry :=
  Lean.Vir.React.Props.key value

def ref {α : Type}
    (value : Lean.Vir.Js (Lean.Vir.React.Ref (Lean.Vir.Js α))) : PropEntry :=
  Lean.Vir.React.Props.ref value

def event
    (name : String)
    (callback : Lean.Vir.Js Lean.Vir.Browser.Event → Lean.Vir.Browser.DomM Unit) : PropEntry :=
  Lean.Vir.React.Props.on name callback

def eventUnit (name : String) (callback : Lean.Vir.Browser.DomM Unit) : PropEntry :=
  Lean.Vir.React.Props.onUnit name callback

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

scoped syntax str : virProofWidgetsJsxAttrVal
/-- Interpolates an expression into a JSX attribute value. -/
scoped syntax group("{" term "}") : virProofWidgetsJsxAttrVal
scoped syntax ident "=" virProofWidgetsJsxAttrVal : virProofWidgetsJsxAttr
/-- Interpolates an array of props, or a base structure for component props. -/
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
/-- Interpolates an array of HTML values into JSX children. -/
scoped syntax "{..." term "}" : virProofWidgetsJsxChild
/-- Interpolates one HTML value into JSX children. -/
scoped syntax "{" term "}" : virProofWidgetsJsxChild
scoped syntax virProofWidgetsJsxElement : virProofWidgetsJsxChild

scoped syntax:max virProofWidgetsJsxElement : term

private meta def joinArrays (parts : Array Term) : MacroM Term := do
  if parts.isEmpty then
    return ← `(term| #[])
  if parts.size == 1 then
    return parts[0]!
  return ← `(term| Array.flatten #[$parts,*])

private meta def isEventName (name : String) : Bool :=
  name.startsWith "on" && name.length > 2

private meta def unitEventName (name : String) : Bool :=
  name == "onClick" || name == "onDoubleClick" || name == "onSubmit"

private meta def transformNativeAttr (attr : Ident) (value : Term) : MacroM Term := do
  let name := attr.getId.eraseMacroScopes.toString
  if name == "key" then
    `(Jsx.key $value)
  else if name == "ref" then
    `(Jsx.ref $value)
  else if name == "style" then
    `(Jsx.style $value)
  else if name == "classList" then
    `(Jsx.classList $value)
  else if isEventName name then
    if name.endsWith "Unit" then
      `(Jsx.eventUnit $(quote <| (name.dropEnd 4).toString) $value)
    else if name.endsWith "With" then
      `(Jsx.event $(quote <| (name.dropEnd 4).toString) $value)
    else if unitEventName name then
      `(Jsx.eventUnit $(quote name) $value)
    else
      `(Jsx.event $(quote name) $value)
  else
    `(Jsx.property $(quote name) $value)

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
  return mkIdentFrom tag.raw (nameFromDotted name)

private meta def transformTag
    (tk : Syntax)
    (opening closing : TSyntax `virProofWidgetsJsxTag)
    (attrs : Array (TSyntax `virProofWidgetsJsxAttr))
    (childrenSyntax : Array (TSyntax `virProofWidgetsJsxChild)) : MacroM Term := do
  let openingName ← tagName opening
  let closingName ← tagName closing
  if openingName != closingName then
    Macro.throwErrorAt closing s!"expected </{openingName}>"

  let mut whitespaceBefore := trailingWhitespace tk
  let mut childParts : Array Term := #[]
  let mut childItems : Array Term := #[]
  for child in childrenSyntax do
    match child with
    | `(virProofWidgetsJsxChild| $text:jsxText) =>
      childItems := childItems.push <| ←
        `(term| Html.text $(quote <| whitespaceBefore ++ getJsxText text))
      whitespaceBefore := ""
    | `(virProofWidgetsJsxChild| { $term }%$childToken) =>
      childItems := childItems.push term
      whitespaceBefore := trailingWhitespace childToken
    | `(virProofWidgetsJsxChild| $element:virProofWidgetsJsxElement) =>
      childItems := childItems.push <| ← `(term| $element:virProofWidgetsJsxElement)
      whitespaceBefore := trailingWhitespace element
    | `(virProofWidgetsJsxChild| {... $term }%$childToken) =>
      if !childItems.isEmpty then
        childParts := childParts.push <| ← `(term| #[$childItems,*])
      childItems := #[]
      childParts := childParts.push term
      whitespaceBefore := trailingWhitespace childToken
    | stx => Macro.throwErrorAt stx "unknown JSX child syntax"
  if !childItems.isEmpty then
    childParts := childParts.push <| ← `(term| #[$childItems,*])
  let children ← joinArrays childParts

  let parsedAttrs : Array ((Ident × Term) ⊕ Term) ← attrs.mapM fun
    | `(virProofWidgetsJsxAttr| $attr:ident = $value:str) =>
      pure <| .inl (attr, value)
    | `(virProofWidgetsJsxAttr| $attr:ident = { $value:term }) =>
      pure <| .inl (attr, value)
    | `(virProofWidgetsJsxAttr| {... $value:term }) =>
      pure <| .inr value
    | stx => Macro.throwErrorAt stx "unknown JSX attribute syntax"

  let tag := openingName
  if tag.front.isUpper then
    let component ← componentIdent opening
    let componentAttrs := parsedAttrs.filter fun
      | .inl (attr, _) => attr.getId.eraseMacroScopes.toString != "key"
      | .inr _ => true
    let keys := parsedAttrs.filterMap fun
      | .inl (attr, value) =>
          if attr.getId.eraseMacroScopes.toString == "key" then some value else none
      | .inr _ => none
    if keys.size > 1 then
      Macro.throwErrorAt opening "component JSX accepts at most one key attribute"
    let bases : Array Term := componentAttrs.filterMap fun
      | .inr value => some value
      | .inl _ => none
    let fields : Array (TSyntax `Lean.Parser.Term.structInstField) ←
      componentAttrs.filterMapM fun
        | .inl (attr, value) =>
          return some <| ← `(Lean.Parser.Term.structInstField| $attr:ident := $value)
        | .inr _ => return none
    let props ← match bases, fields with
      | #[], #[] => `(term| ())
      | #[base], #[] => pure base
      | _, _ => `(term| { $bases,* with $fields,* })
    match keys[0]? with
    | none => `(Html.ofComponent $component $props $children)
    | some key => `(Html.keyedOfComponent $key $component $props $children)
  else
    let mut propParts : Array Term := #[]
    let mut propItems : Array Term := #[]
    for attr in parsedAttrs do
      match attr with
      | .inl (name, value) =>
        propItems := propItems.push <| ← transformNativeAttr name value
      | .inr spread =>
        if !propItems.isEmpty then
          propParts := propParts.push <| ← `(term| #[$propItems,*])
        propItems := #[]
        propParts := propParts.push spread
    if !propItems.isEmpty then
      propParts := propParts.push <| ← `(term| #[$propItems,*])
    let props ← joinArrays propParts
    `(Html.elementWithProps $(quote tag) $props $children)

/--
JSX-like syntax for VIR-native HTML. Lowercase tags are React elements and
uppercase tags are Lean `ProofWidgets.Component` values.
-/
macro_rules
  | `(<$name:virProofWidgetsJsxTag $[$attrs:virProofWidgetsJsxAttr]* />%$tk) =>
    transformTag tk name name attrs #[]
  | `(<$opening:virProofWidgetsJsxTag $[$attrs:virProofWidgetsJsxAttr]* >%$tk
      $children*</$closing>) =>
    transformTag tk opening closing attrs children

end Lean.Vir.ProofWidgets.Jsx
