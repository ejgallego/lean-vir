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

/-- Whether a type constructor is one of VIR's supported exported effects. -/
public def isEffectHead (name : Lean.Name) : Bool :=
  (effectKind? name).isSome

/-- Shared diagnostic for a startup hook that declares parameters. -/
public def startupArgumentsDiagnostic (name? : Option String := none) : String :=
  let parameter := name?.map (fun name => s!" (`{name}`)") |>.getD ""
  s!"VIR startup hooks cannot declare parameters{parameter}; \
    define a zero-argument wrapper instead"

/-- Shared diagnostic for a startup hook with an unsupported result or effect. -/
public def startupResultDiagnostic : String :=
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

end Vir.InterfaceValidation
