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
import Vir.InterfaceValidation

public section

/-!
# VIR package markers

These attributes select the declarations that a Lake `:vir` module facet
exports to JavaScript. Importing `Vir` also imports this module.
-/

private partial def virExportBinderDiagnostic? (type : Lean.Expr) : Option String :=
  match Vir.InterfaceValidation.stripMData type with
  | .forallE name domain body binderInfo =>
      let domain := Vir.InterfaceValidation.stripMData domain
      if domain matches .sort _ then
        some s!"VIR exports must use concrete runtime types; type parameter `{name}` is erased; \
          export a concrete wrapper instead"
      else if binderInfo != .default then
        some s!"VIR exports cannot have implicit or instance arguments (`{name}`); \
          export a wrapper with only explicit arguments"
      else
        virExportBinderDiagnostic? body
  | _ => none

private def virMarkerKindDiagnostic? (env : Lean.Environment) (declName : Lean.Name) : Option String :=
  match Lean.getOriginalConstKind? env declName with
  | some .defn | some .opaque => none
  | some .thm => some "theorems do not have executable IR; export a definition instead"
  | some .axiom => some "axioms do not have executable IR; export an implemented definition instead"
  | some .quot => some "quotient declarations cannot be exported as entrypoints"
  | some .induct => some "inductive type declarations cannot be exported as entrypoints"
  | some .ctor => some "constructors cannot be exported as entrypoints"
  | some .recursor => some "recursors cannot be exported as entrypoints"
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

private def preserveVirStartupTypeHead (name : Lean.Name) : Bool :=
  name == `Unit || Vir.InterfaceValidation.isEffectHead name

private def isUnitType (type : Lean.Expr) : Lean.CoreM Bool := do
  let type ← Vir.InterfaceValidation.reduceTypeAliases preserveVirStartupTypeHead type
  return type.getAppFn.constName? == some `Unit && type.getAppArgs.isEmpty

private def isVirStartupSignature (type : Lean.Expr) : Lean.CoreM Bool := do
  let type ← Vir.InterfaceValidation.reduceTypeAliases preserveVirStartupTypeHead type
  if type matches .forallE .. then
    return false
  let (fn, args) := type.getAppFnArgs
  if fn == `Unit then
    return args.isEmpty
  if !Vir.InterfaceValidation.isEffectHead fn || args.size != 1 then
    return false
  let some result := args[0]? | return false
  isUnitType result

private def checkVirStartupSignature (type : Lean.Expr) : Lean.CoreM (Option String) := do
  if ← isVirStartupSignature type then
    return none
  return some Vir.InterfaceValidation.startupSignatureDiagnostic

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
      if let some reason := virExportBinderDiagnostic? info.sig.get.type then
        return { diagnostic? := some reason }
  | .startup =>
      if let some reason ← checkVirStartupSignature info.sig.get.type then
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
non-executable declarations, unsupported binder shapes, and compiled closures
whose visible dependencies are known to be unavailable. When imported IR is
opaque, it identifies the compiled dependency package generation still
requires. When compilation is postponed, it explains how to make IR available.
Package generation also checks the final interface layout.
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
opaque imported dependencies and interface layout.
-/
initialize vir_startup : Lean.LabelExtension ← registerVirMarkerAttr .startup

/-- Parser for the `@[vir_startup]` package-startup attribute. -/
syntax (name := Lean.Parser.Attr.vir_startup) "vir_startup" : attr
