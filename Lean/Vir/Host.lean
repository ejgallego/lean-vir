/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Lean
import Lean.Compiler.ExternAttr

open Lean

syntax (name := vir_js) "vir_js " str : attr

namespace Lean.Vir

def jsExternPrefix : String := "__vir_js:"

structure JsImport where
  target : String
  deriving Inhabited

private partial def firstStringLiteral? (stx : Syntax) : Option String :=
  match stx.isStrLit? with
  | some value => some value
  | none => stx.getArgs.findSome? firstStringLiteral?

private def parseVirJsAttr (stx : Syntax) : AttrM JsImport := do
  let some target := firstStringLiteral? stx
    | throwError "invalid `[vir_js]` attribute syntax; expected `[vir_js \"target.name\"]`"
  if target.isEmpty then
    throwError "invalid `[vir_js]` attribute syntax; target must not be empty"
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

def getJsImport? (env : Environment) (declName : Name) : Option JsImport :=
  _root_.virJsAttr.getParam? env declName

end Lean.Vir
