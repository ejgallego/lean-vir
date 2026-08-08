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
import Vir.Interface.Classify.Signature
import Vir.InterfaceValidation

public section

/-!
# VIR package markers

These attributes select the declarations that a Lake `:vir` module facet
exports to JavaScript. Importing `Vir` also imports this module.
-/

private def virMarkerKindDiagnostic? (env : Lean.Environment) (declName : Lean.Name) : Option String :=
  match Lean.getOriginalConstKind? env declName with
  | some .defn | some .opaque => none
  | some .thm => some "theorems do not have executable IR; mark a definition instead"
  | some .axiom => some "axioms do not have executable IR; mark an implemented definition instead"
  | some .quot => some "quotient declarations cannot be used as VIR entrypoints"
  | some .induct => some "inductive type declarations cannot be used as VIR entrypoints"
  | some .ctor => some "constructors cannot be used as VIR entrypoints"
  | some .recursor => some "recursors cannot be used as VIR entrypoints"
  | none => some "Lean could not determine the declaration kind"

private structure VirMarkerCheck where
  diagnostic? : Option String := none
  deferred : Array Vir.ExportValidation.ClosureDeferred := #[]

private inductive VirMarkerKind where
  | export
  | startup

private def VirMarkerKind.attributeName : VirMarkerKind → Lean.Name
  | .export => `vir_export
  | .startup => `vir_startup

private def VirMarkerKind.description : VirMarkerKind → String
  | .export => "Marks a declaration as a JavaScript-callable VIR package export."
  | .startup => "Marks a declaration as a VIR package startup hook."

private def checkVirMarker
    (marker : VirMarkerKind) (declName : Lean.Name) : Lean.CoreM VirMarkerCheck := do
  if Lean.isPrivateName declName then
    let reason := match marker with
      | .export => "private declarations cannot be VIR exports; remove `private` or export a public wrapper"
      | .startup => "private declarations cannot be VIR startup hooks; remove `private` or use a public wrapper"
    return { diagnostic? := some reason }
  let env ← Lean.getEnv
  if let some reason := virMarkerKindDiagnostic? env declName then
    return { diagnostic? := some reason }
  let info ← Lean.getAsyncConstInfo declName
  match marker with
  | .export =>
      match ← Vir.Interface.analyzeExportInterface info.sig.get.type with
      | .error error => return { diagnostic? := some error.message }
      | .ok _ => pure ()
  | .startup =>
      match ← Vir.InterfaceValidation.analyzeStartupSignature info.sig.get.type with
      | .error error => return { diagnostic? := some error.message }
      | .ok _ => pure ()
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

private def registerVirMarkerAttr (marker : VirMarkerKind) : IO Lean.LabelExtension := do
  let attrName := marker.attributeName
  let ext ← Lean.mkLabelExt attrName
  Lean.registerBuiltinAttribute {
    ref := attrName
    name := attrName
    descr := marker.description
    applicationTime := .afterCompilation
    add := fun declName stx kind => do
      let check ← checkVirMarker marker declName
      if let some reason := check.diagnostic? then
        let message := s!"invalid `@[{attrName}]` declaration `{declName}`: {reason}"
        Lean.throwErrorAt stx message
      if let some deferred := check.deferred[0]? then
        Lean.logInfoAt stx deferred.message
      ext.add declName kind
    erase := fun declName => do
      let state := ext.getState (← Lean.getEnv)
      Lean.modifyEnv fun env => ext.modifyState env fun _ => state.erase declName
  }
  Lean.labelExtensionMapRef.modify fun extensions => extensions.insert attrName ext
  return ext

/--
Marks a declaration as a JavaScript-callable export in a VIR package.

The declaration is available through `vir.call(...)`. It is not selected as a
startup hook unless it is marked `@[vir_startup]`.

After Lean compiles the declaration, the attribute rejects private and
non-executable declarations, unsupported signatures and interface layouts, and
compiled closures whose visible dependencies are known to be unavailable. When
imported IR is opaque, it identifies the compiled dependency package generation
still requires. When compilation is postponed, it explains how to make IR
available. Package generation repeats these checks for raw marker metadata and
also validates package-wide constraints.
-/
initialize vir_export : Lean.LabelExtension ← registerVirMarkerAttr .export

/-- Parser for the `@[vir_export]` package-export attribute. -/
syntax (name := Lean.Parser.Attr.vir_export) "vir_export" : attr

/--
Marks a declaration as a VIR package startup hook.

Startup hooks are also JavaScript-callable exports and carry `startup: true` in
the package manifest. The browser host invokes them with
`vir.runStartupEntries()`. After Lean compiles the declaration, the attribute
performs the same entrypoint and closure checks as `@[vir_export]` and requires
the hook to take no JavaScript arguments and return `Unit`, possibly through a
supported effect such as `DomM`. Package generation remains the final check for
opaque imported dependencies and interface layout. Signature errors distinguish
unexpected parameters from unsupported result or effect forms.
-/
initialize vir_startup : Lean.LabelExtension ← registerVirMarkerAttr .startup

/-- Parser for the `@[vir_startup]` package-startup attribute. -/
syntax (name := Lean.Parser.Attr.vir_startup) "vir_startup" : attr
