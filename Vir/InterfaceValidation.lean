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

The package generator's full interface classifier is a legacy Lean module and
cannot be imported by `Vir.Attributes`, which uses the module system. This file
contains the small, representation-independent checks that both layers need so
attribute-time feedback and final package validation do not drift apart.
-/

/-- Module-safe identity of a supported exported effect constructor. -/
public inductive EffectKind where
  | runtime
  | io
  | dom
  | react

/-- Classify a type constructor as one of VIR's supported exported effects. -/
public def effectKind? : Lean.Name → Option EffectKind
  | `Lean.Vir.RuntimeM => some .runtime
  | `IO => some .io
  | `Lean.Vir.Browser.DomM => some .dom
  | `Lean.Vir.React.ReactM => some .react
  | _ => none

private def isEffectHead (name : Lean.Name) : Bool :=
  (effectKind? name).isSome

private def startupArgumentsDiagnostic (name? : Option String := none) : String :=
  let parameter := name?.map (fun name => s!" (`{name}`)") |>.getD ""
  s!"VIR startup hooks cannot declare parameters{parameter}; \
    define a zero-argument wrapper instead"

private def startupResultDiagnostic : String :=
  "VIR startup hooks must return `Unit`; supported effectful forms are `RuntimeM Unit`, \
    `IO Unit`, `DomM Unit`, and `ReactM Unit`"

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

private def preserveStartupTypeHead (name : Lean.Name) : Bool :=
  name == `Unit || isEffectHead name

private def isUnitType (type : Lean.Expr) : Lean.CoreM Bool := do
  let type ← reduceTypeAliases preserveStartupTypeHead type
  return type.getAppFn.constName? == some `Unit && type.getAppArgs.isEmpty

/--
Return a diagnostic when a declaration type does not satisfy the VIR startup
contract. Startup hooks take no arguments and return either `Unit` or a
supported effect applied to `Unit`.
-/
public def startupSignatureDiagnostic? (type : Lean.Expr) : Lean.CoreM (Option String) := do
  let type ← reduceTypeAliases preserveStartupTypeHead type
  if let .forallE name .. := type then
    return some (startupArgumentsDiagnostic (some name.toString))
  let (fn, args) := type.getAppFnArgs
  if fn == `Unit && args.isEmpty then
    return none
  if !isEffectHead fn || args.size != 1 then
    return some startupResultDiagnostic
  let some result := args[0]? | return some startupResultDiagnostic
  if ← isUnitType result then
    return none
  return some startupResultDiagnostic

end Vir.InterfaceValidation
