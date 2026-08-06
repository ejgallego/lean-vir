/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Lean

public section

namespace Vir.InterfaceValidation

/-!
# Module-safe interface validation

This file owns the representation-independent marker checks shared by
attribute-time feedback and final package validation. It deliberately stops
before runtime-layout and JavaScript-interface classification.
-/

/-- Module-safe identity of a supported exported effect constructor. -/
public inductive EffectKind where
  | runtime
  | io
  | dom
  | react
  deriving BEq, Repr

/-- User-facing name of a supported VIR effect. -/
public def EffectKind.label : EffectKind → String
  | .runtime => "RuntimeM"
  | .io => "IO"
  | .dom => "DomM"
  | .react => "ReactM"

/-- A concrete, explicit export argument found by marker preflight. -/
public structure ExportBinder where
  name : Lean.Name
  type : Lean.Expr
  deriving Repr

/-- The declaration shape that remains after validating export binders. -/
public structure ExportSignature where
  args : Array ExportBinder
  result : Lean.Expr
  deriving Repr

/-- A binder-policy violation for a declaration marked `@[vir_export]`. -/
public inductive ExportSignatureError where
  | erasedTypeParameter (name : Lean.Name)
  | implicitOrInstanceParameter (name : Lean.Name)
  deriving BEq, Repr

/-- Render an export preflight failure for users. -/
public def ExportSignatureError.message : ExportSignatureError → String
  | .erasedTypeParameter name =>
      s!"VIR exports must use concrete runtime types; type parameter `{name}` is erased; \
        export a concrete wrapper instead"
  | .implicitOrInstanceParameter name =>
      s!"VIR exports cannot have implicit or instance arguments (`{name}`); \
        export a wrapper with only explicit arguments"

/-- Whether a valid startup hook is pure or uses one supported effect. -/
public inductive StartupEffect where
  | pure
  | effect (kind : EffectKind)
  deriving BEq, Repr

/-- The representation-independent signature of a valid startup hook. -/
public structure StartupSignature where
  effect : StartupEffect
  deriving BEq, Repr

/-- A startup-contract violation found by marker preflight. -/
public inductive StartupSignatureError where
  | parameter (name : Lean.Name)
  | nonUnitResult (effect? : Option EffectKind) (result : Lean.Expr)
  | unsupportedEffect (head : Lean.Name)
  | malformedEffect (kind : EffectKind) (argumentCount : Nat)
  deriving BEq, Repr

/-- Classify a type constructor as one of VIR's supported exported effects. -/
public def effectKind? : Lean.Name → Option EffectKind
  | `Lean.Vir.RuntimeM => some .runtime
  | `IO => some .io
  | `Lean.Vir.Browser.DomM => some .dom
  | `Lean.Vir.React.ReactM => some .react
  | _ => none

private def isEffectHead (name : Lean.Name) : Bool :=
  (effectKind? name).isSome

/-- Render a startup preflight failure for users. -/
public def StartupSignatureError.message : StartupSignatureError → String
  | .parameter name =>
      s!"VIR startup hooks cannot declare parameters (`{name}`); \
        define a zero-argument wrapper instead"
  | .nonUnitResult none result =>
      s!"VIR startup hooks must return `Unit`; got `{result}`"
  | .nonUnitResult (some effect) result =>
      s!"VIR startup hooks using `{effect.label}` must return `Unit`; got `{result}`"
  | .unsupportedEffect head =>
      s!"`{head}` is not a supported VIR startup effect; use `RuntimeM`, `IO`, `DomM`, \
        or `ReactM`, each returning `Unit`"
  | .malformedEffect effect argumentCount =>
      s!"VIR startup effect `{effect.label}` expects one result type, got {argumentCount}"

/-- Remove metadata wrappers without reducing the underlying interface type. -/
public partial def stripMData : Lean.Expr → Lean.Expr
  | .mdata _ type => stripMData type
  | type => type

private def unfoldAbbrevHead?
    (preserveHead : Lean.Name → Bool) (e : Lean.Expr) : Lean.CoreM (Option Lean.Expr) := do
  let e := stripMData e
  let (_, args) := e.getAppFnArgs
  match e.getAppFn with
  | .const name levels =>
      if preserveHead name then
        return none
      else
        let env ← Lean.getEnv
        match env.find? name with
        | some (.defnInfo info) =>
            if info.hints == .abbrev then
              let value := (Lean.ConstantInfo.defnInfo info).instantiateValueLevelParams! levels
              let unfolded := stripMData (value.beta args)
              if unfolded == e then return none else return some unfolded
            else
              return none
        | _ => return none
  | _ => return none

/--
Unfold reducible abbreviation heads until reaching one the caller preserves or
a non-abbreviation. Preserving interface constructors prevents effects such as
`IO` from reducing through their runtime implementation.
-/
public partial def reduceTypeAliases
    (preserveHead : Lean.Name → Bool) (e : Lean.Expr) : Lean.CoreM Lean.Expr := do
  match ← unfoldAbbrevHead? preserveHead e with
  | some unfolded => reduceTypeAliases preserveHead unfolded
  | none => return stripMData e

private def preserveMarkerTypeHead (name : Lean.Name) : Bool :=
  name == `Unit || isEffectHead name

private def isUnitType (type : Lean.Expr) : Lean.CoreM Bool := do
  let type ← reduceTypeAliases preserveMarkerTypeHead type
  return type.getAppFn.constName? == some `Unit && type.getAppArgs.isEmpty

/--
Validate the binder policy for `@[vir_export]` and retain the concrete argument
types for package-time interface classification. Reducible aliases are unfolded
only when they expose additional function binders; result aliases remain intact.
-/
public partial def analyzeExportSignature
    (type : Lean.Expr) (args : Array ExportBinder := #[]) :
    Lean.CoreM (Except ExportSignatureError ExportSignature) := do
  let type := stripMData type
  match type with
  | .forallE name domain body binderInfo =>
      let domain := stripMData domain
      if domain matches .sort _ then
        return .error (.erasedTypeParameter name)
      else if binderInfo != .default then
        return .error (.implicitOrInstanceParameter name)
      else
        analyzeExportSignature body (args.push { name, type := domain })
  | _ =>
      let reduced ← reduceTypeAliases preserveMarkerTypeHead type
      match reduced with
      | .forallE .. => analyzeExportSignature reduced args
      | _ => return .ok { args, result := type }

/--
Analyze a VIR startup signature. Startup hooks take no arguments and return
either `Unit` or a supported effect applied to `Unit`.
-/
public def analyzeStartupSignature (type : Lean.Expr) :
    Lean.CoreM (Except StartupSignatureError StartupSignature) := do
  let type ← reduceTypeAliases preserveMarkerTypeHead type
  if let .forallE name .. := type then
    return .error (.parameter name)
  let (fn, args) := type.getAppFnArgs
  if fn == `Unit && args.isEmpty then
    return .ok { effect := .pure }
  let some effect := effectKind? fn
    | if args.isEmpty then
        return .error (.nonUnitResult none type)
      else
        return .error (.unsupportedEffect fn)
  if args.size != 1 then
    return .error (.malformedEffect effect args.size)
  let some result := args[0]? | return .error (.malformedEffect effect 0)
  if ← isUnitType result then
    return .ok { effect := .effect effect }
  return .error (.nonUnitResult (some effect) result)

end Vir.InterfaceValidation
