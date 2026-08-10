/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public meta import Lean.AddDecl
public meta import Lean.Compiler.ExternAttr
public meta import Lean.Elab.Command
public meta import Vir.ExportValidation

public section

open Lean

namespace Vir

private meta partial def containsConst (value : Expr) (name : Name) : Bool :=
  match value with
  | .const found _ => found == name
  | .app fn arg => containsConst fn name || containsConst arg name
  | .lam _ type body _ | .forallE _ type body _ =>
      containsConst type name || containsConst body name
  | .letE _ type value body _ =>
      containsConst type name || containsConst value name || containsConst body name
  | .mdata _ body | .proj _ _ body => containsConst body name
  | _ => false

private meta def compileExternFallback (ref : Syntax) (name : Name) : CoreM Name := do
  let env ← getEnv
  let clone := ExportValidation.externFallbackCloneName name
  if env.contains clone then
    throwErrorAt ref "extern `{name}` already has a VIR reference-body fallback `{clone}`"
  unless (getExternAttrData? env name).isSome do
    throwErrorAt ref "`{name}` is not an `@[extern]` declaration"
  let .defnInfo info ← getConstInfo name
    | throwErrorAt ref
        "extern `{name}` has no transparent Lean definition body; VIR fallbacks require an `@[extern] def`"
  if containsConst info.value name then
    throwErrorAt ref
      "extern `{name}` has a recursive reference body; recursive VIR extern fallbacks are not supported"
  addAndCompile <| .defnDecl {
    info with
    name := clone
    all := [clone]
  }
  return clone

/--
Compile the Lean definition bodies of explicitly named `@[extern] def`s for
use by VIR packages. The ordinary native backend continues to use each extern;
only VIR package closure resolution redirects the name to the compiled body.
-/
syntax (name := virExternFallbackCmd) "vir_extern_fallback " ident,+ : command

@[command_elab virExternFallbackCmd] meta def elabVirExternFallback : Elab.Command.CommandElab
  | `(vir_extern_fallback $names:ident,*) => do
      for nameStx in names.getElems do
        let name ← Elab.Command.liftCoreM <| Elab.realizeGlobalConstNoOverloadWithInfo nameStx
        discard <| Elab.Command.liftCoreM <| compileExternFallback nameStx name
  | _ => Elab.throwUnsupportedSyntax

end Vir
