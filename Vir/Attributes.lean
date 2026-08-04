/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Lean.LabelAttribute
import Lean.Compiler.Options
import Lean.OriginalConstKind
import Vir.ExportValidation

public section

/-!
# VIR package markers

These attributes select the declarations that a Lake `:vir` module facet
exports to JavaScript. Importing `Vir` also imports this module.
-/

private partial def stripVirExportMData : Lean.Expr → Lean.Expr
  | .mdata _ type => stripVirExportMData type
  | type => type

private partial def virExportBinderDiagnostic? : Lean.Expr → Option String
  | .mdata _ type => virExportBinderDiagnostic? type
  | .forallE name domain body binderInfo =>
      let domain := stripVirExportMData domain
      if domain matches .sort _ then
        some
          "polymorphic exported entrypoints with erased type parameters are not supported; \
          export a concrete wrapper"
      else if binderInfo != .default then
        some s!"unsupported implicit/instance argument `{name}`"
      else
        virExportBinderDiagnostic? body
  | _ => none

private def virExportKindDiagnostic? (env : Lean.Environment) (declName : Lean.Name) : Option String :=
  match Lean.getOriginalConstKind? env declName with
  | some .defn | some .opaque => none
  | some .thm => some "theorems do not have executable IR"
  | some .axiom => some "axioms do not have executable IR"
  | some .quot => some "quotient declarations cannot be exported as entrypoints"
  | some .induct => some "inductive type declarations cannot be exported as entrypoints"
  | some .ctor => some "constructors cannot be exported as entrypoints"
  | some .recursor => some "recursors cannot be exported as entrypoints"
  | none => some "Lean could not determine the declaration kind"

private structure VirExportCheck where
  diagnostic? : Option String := none
  deferred : Array Vir.ExportValidation.ClosureDeferred := #[]

private def checkVirExport (declName : Lean.Name) : Lean.CoreM VirExportCheck := do
  if Lean.isPrivateName declName then
    return { diagnostic? := some "private declarations are not exported" }
  let env ← Lean.getEnv
  if let some reason := virExportKindDiagnostic? env declName then
    return { diagnostic? := some reason }
  let info ← Lean.getAsyncConstInfo declName
  if let some reason := virExportBinderDiagnostic? info.sig.get.type then
    return { diagnostic? := some reason }
  if env.header.isModule && (← Lean.Compiler.compiler.postponeCompile.getM) then
    return {
      deferred := #[{
        kind := .compilerPostponed
        dependency := { name := declName, path := #[declName] }
      }]
    }
  let closure := Vir.ExportValidation.checkVisibleClosure env declName
  if let some blocker := closure.blockers[0]? then
    return { diagnostic? := some blocker.message }
  return { deferred := closure.deferred }

private def registerVirExportAttr : IO Lean.LabelExtension := do
  let ext ← Lean.mkLabelExt `vir_export
  Lean.registerBuiltinAttribute {
    ref := `vir_export
    name := `vir_export
    descr := "Marks a declaration as a JavaScript-callable VIR package export."
    applicationTime := .afterCompilation
    add := fun declName stx kind => do
      let check ← checkVirExport declName
      if let some reason := check.diagnostic? then
        let message := s!"invalid `@[vir_export]` declaration `{declName}`: {reason}"
        Lean.throwErrorAt stx message
      if let some deferred := check.deferred[0]? then
        Lean.logInfoAt stx deferred.message
      ext.add declName kind
    erase := fun declName => do
      let state := ext.getState (← Lean.getEnv)
      Lean.modifyEnv fun env => ext.modifyState env fun _ => state.erase declName
  }
  Lean.labelExtensionMapRef.modify fun extensions => extensions.insert `vir_export ext
  return ext

/--
Marks a declaration as a JavaScript-callable export in a VIR package.

The declaration is available through `vir.call(...)`. It is not selected as a
startup hook unless it is marked `@[vir_startup]`.

After Lean compiles the declaration, the attribute rejects private and
non-executable declarations, unsupported signatures, and compiled closures
whose visible dependencies are known to be unavailable. When imported IR is
opaque or compilation is postponed, it explains which compiled IR package
generation still requires. Package generation also checks the final interface
layout.
-/
initialize vir_export : Lean.LabelExtension ← registerVirExportAttr

/-- Parser for the `@[vir_export]` package-export attribute. -/
syntax (name := Lean.Parser.Attr.vir_export) "vir_export" : attr

/--
Marks a declaration as a VIR package startup hook.

Startup hooks are also JavaScript-callable exports and carry `startup: true` in
the package manifest. The browser host invokes them with
`vir.runStartupEntries()`. Package generation requires each hook to take no
JavaScript arguments and return `Unit`, possibly through a supported effect
such as `DomM`.
-/
register_label_attr vir_startup
