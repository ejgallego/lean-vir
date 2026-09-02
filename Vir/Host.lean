/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Lean
public import Lean.Compiler.ExternAttr
public import Vir.HostValidation

public section

open Lean

/--
Marks an opaque Lean declaration as a JavaScript host import for VIR package
generation.

The string parameter is the JavaScript target name that the VIR runtime resolves
through `hostBindings`, for example:

```lean
import Vir.Js

@[vir_js "demo.bumpNat"]
opaque jsBumpNat (n : @& Lean.Vir.Js Nat) :
  Lean.Vir.RuntimeM (Lean.Vir.Js Nat)
```

The declaration is not implemented by Lean itself. It is callable when the
declaration is packaged into a `.irpkg` and executed through the VIR JavaScript
runtime. The attribute validates the declaration's complete interface signature
and JavaScript host-boundary policy immediately; package generation repeats the
same typed analysis as a final guard for raw extern metadata.
-/
syntax (name := vir_js) "vir_js " str : attr
syntax (name := vir_js_explicit_conversion) "vir_js_explicit_conversion " str : attr

namespace Lean.Vir

/-- Metadata stored for a declaration marked with `@[vir_js]`. -/
structure JsImport where
  /-- JavaScript host target name, such as `"browser.document.getTitle"`. -/
  target : String
  deriving Inhabited

private partial def firstStringLiteral? (stx : Syntax) : Option String :=
  match stx.isStrLit? with
  | some value => some value
  | none => stx.getArgs.findSome? firstStringLiteral?

private def parseNonEmptyStringAttr (attrName : Name) (stx : Syntax) : AttrM String := do
  let some value := firstStringLiteral? stx
    | throwError s!"invalid `[{attrName}]` attribute syntax; expected `[{attrName} \"value\"]`"
  if value.isEmpty then
    throwError s!"invalid `[{attrName}]` attribute syntax; value must not be empty"
  return value

private def validateVirJsAttr
    (marker : Vir.HostMetadata.HostImportMarker) (declName : Name)
    (data : JsImport) (stx : Syntax) :
    AttrM Unit := do
  let env ← getEnv
  let some info := env.find? declName
    | throwErrorAt stx s!"invalid `@[{marker.attributeName}]` declaration `{declName}`: \
        Lean could not find the declaration"
  match ← Vir.HostValidation.analyzeHostImport marker data.target info.type with
  | .error error =>
      throwErrorAt stx m!"invalid `@[{marker.attributeName}]` declaration `{declName}`: \
        {error.toMessageData}"
  | .ok _ => pure ()

private def setVirJsExtern
    (marker : Vir.HostMetadata.HostImportMarker) (declName : Name) (data : JsImport) :
    AttrM Unit := do
  let env ← getEnv
  let externData : ExternAttrData := {
    entries := [ExternEntry.standard `all (marker.externSymbol data.target)]
  }
  match externAttr.setParam env declName externData with
  | .ok env => setEnv env
  | .error error => throwError error

/--
Parse and validate before the parametric attribute is stored. Lean intentionally
swallows `ParametricAttribute.afterSet` exceptions, so user-facing checks and
extern installation must happen in this propagating phase.
-/
private def parseVirJsAttr
    (marker : Vir.HostMetadata.HostImportMarker)
    (declName : Name) (stx : Syntax) : AttrM JsImport := do
  let target ← parseNonEmptyStringAttr marker.attributeName stx
  let data := { target : JsImport }
  validateVirJsAttr marker declName data stx
  setVirJsExtern marker declName data
  return data

end Lean.Vir

initialize virJsAttr : ParametricAttribute Lean.Vir.JsImport ←
  registerParametricAttribute {
    name := `vir_js
    descr := "mark an opaque declaration as a Lean.Vir JavaScript host import"
    getParam := fun declName stx =>
      Lean.Vir.parseVirJsAttr .hostImport declName stx
  }

initialize virJsExplicitConversionAttr : ParametricAttribute Lean.Vir.JsImport ←
  registerParametricAttribute {
    name := `vir_js_explicit_conversion
    descr := "mark a Lean.Vir JavaScript host import as an explicit conversion intrinsic"
    getParam := fun declName stx =>
      Lean.Vir.parseVirJsAttr .explicitConversion declName stx
  }
