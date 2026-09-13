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
scoped syntax jsxTag "=" virProofWidgetsJsxAttrVal : virProofWidgetsJsxAttr
/-- Supplies a complete native props object; cannot be combined with other attributes. -/
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

  let propsId ← mkIdent <$> Macro.addMacroScope `props
  let childrenId ← mkIdent <$> Macro.addMacroScope `children
  let mut writes : Array (TSyntax `doElem) := #[]
  let suppliedProps ← if attrs.size == 1 then
      match attrs[0]! with
      | `(virProofWidgetsJsxAttr| {... $value:term }) => pure (some value)
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
          pure (getJsxTag name, value)
        | `(virProofWidgetsJsxAttr| {... $_value:term }) =>
          Macro.throwErrorAt attr "native props must be supplied alone; construct or update the object explicitly"
        | stx => Macro.throwErrorAt stx "unknown JSX attribute syntax"
      writes := writes.push <| ← `(doElem|
        Lean.Vir.Js.Object.set $propsId (← Lean.Vir.JsValue.ofString $(quote name)) $value)
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
        pure term
      | `(virProofWidgetsJsxChild| $element:virProofWidgetsJsxElement) =>
        whitespaceBefore := trailingWhitespace element
        `($element:virProofWidgetsJsxElement)
      | `(virProofWidgetsJsxChild| {... $term }%$childToken) =>
        whitespaceBefore := trailingWhitespace childToken
        writes := writes.push <| ← `(doElem|
          for child in $term do
            let _ ← Lean.Vir.Js.Array.push $childrenId (← child))
        continue
      | stx => Macro.throwErrorAt stx "unknown JSX child syntax"
    writes := writes.push <| ← `(doElem|
      let _ ← Lean.Vir.Js.Array.push $childrenId (← ($action)))
  let result ← if openingName.front.isUpper then
      let component ← componentIdent opening
      `(Lean.Vir.React.Node.functionComponent $component $propsId $childrenId)
    else
      `(Lean.Vir.React.Node.createElement
        (← Lean.Vir.React.ElementType.tag (← Lean.Vir.JsValue.ofString $(quote openingName)))
        $propsId $childrenId)
  `(show Lean.Vir.React.ReactM (Lean.Vir.Js Lean.Vir.React.Node) from do
    $[$writes:doElem]*
    ($result))

/--
JSX-like syntax for VIR-native HTML. Lowercase tags are React elements.
Attributes interpolate exact JS values; literals convert strings.
Uppercase tags receive native props, with no implicit JSL boxing. Supply typed
props as the sole `{...props}` attribute. Child expressions remain construction
actions, evaluated left-to-right after attributes.
-/
macro_rules
  | `(<$name:virProofWidgetsJsxTag $[$attrs:virProofWidgetsJsxAttr]* />%$tk) =>
    transformTag tk name name attrs #[]
  | `(<$opening:virProofWidgetsJsxTag $[$attrs:virProofWidgetsJsxAttr]* >%$tk
      $children*</$closing>) =>
    transformTag tk opening closing attrs children

end Lean.Vir.ProofWidgets.Jsx
