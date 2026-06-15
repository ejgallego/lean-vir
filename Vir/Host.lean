/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Lean
import Lean.Compiler.ExternAttr

open Lean

/--
Marks an opaque Lean declaration as a JavaScript host import for VIR package
generation.

The string parameter is the JavaScript target name that the VIR runtime resolves
through `hostBindings`, for example:

```lean
@[vir_js "demo.bumpNat"]
opaque jsBumpNat (n : Nat) : Nat
```

The declaration is not implemented by Lean itself. It is callable when the
declaration is packaged into a `.irpkg` and executed through the VIR JavaScript
runtime.
-/
syntax (name := vir_js) "vir_js " str : attr

namespace Lean.Vir

/-- Prefix used internally to encode `@[vir_js]` targets in Lean extern metadata. -/
def jsExternPrefix : String := "__vir_js:"

/-- Metadata stored for a declaration marked with `@[vir_js]`. -/
structure JsImport where
  /-- JavaScript host target name, such as `"browser.document.getTitle"`. -/
  target : String
  deriving Inhabited

private partial def firstStringLiteral? (stx : Syntax) : Option String :=
  match stx.isStrLit? with
  | some value => some value
  | none => stx.getArgs.findSome? firstStringLiteral?

private def parseNonEmptyStringAttr (attrName : String) (stx : Syntax) : AttrM String := do
  let some value := firstStringLiteral? stx
    | throwError s!"invalid `[{attrName}]` attribute syntax; expected `[{attrName} \"value\"]`"
  if value.isEmpty then
    throwError s!"invalid `[{attrName}]` attribute syntax; value must not be empty"
  return value

private def parseVirJsAttr (stx : Syntax) : AttrM JsImport := do
  let target ← parseNonEmptyStringAttr "vir_js" stx
  return { target }

end Lean.Vir

initialize virJsAttr : ParametricAttribute Lean.Vir.JsImport ←
  registerParametricAttribute {
    name := `vir_js
    descr := "mark an opaque declaration as a Lean.Vir JavaScript host import"
    getParam := fun _ stx => Lean.Vir.parseVirJsAttr stx
    afterSet := fun declName data => do
      let env ← getEnv
      let externData : ExternAttrData := {
        entries := [ExternEntry.standard `all (Lean.Vir.jsExternPrefix ++ data.target)]
      }
      match externAttr.setParam env declName externData with
      | .ok env => setEnv env
      | .error error => throwError error
  }

namespace Lean.Vir

/--
Returns the JavaScript host import metadata for `declName`, if the declaration
was marked with `@[vir_js]` in `env`.
-/
def getJsImport? (env : Environment) (declName : Name) : Option JsImport :=
  _root_.virJsAttr.getParam? env declName

end Lean.Vir
