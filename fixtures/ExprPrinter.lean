/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Lean

namespace Vir.Fixtures.ExprPrinter

open Lean

def constNatExpr : Expr :=
  .const `Nat []

def twoLitExpr : Expr :=
  .lit (.natVal 2)

def appExpr : Expr :=
  .app (.const `Nat.succ []) twoLitExpr

def sortParamExpr : Expr :=
  .sort (.succ (.param `u))

def fvarExpr : Expr :=
  .fvar ⟨`x⟩

def mvarExpr : Expr :=
  .mvar ⟨`m⟩

def lambdaExpr : Expr :=
  .lam `x (.const `Nat []) (.bvar 0) .default

def forallExpr : Expr :=
  .forallE `x (.const `Nat []) (.bvar 0) .implicit

def letExpr : Expr :=
  .letE `x (.const `Nat []) twoLitExpr (.bvar 0) false

def stringLitExpr : Expr :=
  .lit (.strVal "hi")

def mdataExpr : Expr :=
  .mdata MData.empty (.bvar 0)

def projExpr : Expr :=
  .proj `Prod 1 (.const `p [])

def exprKindScore : Expr → Nat
  | .bvar idx => idx + 1
  | .fvar _ => 20
  | .mvar _ => 30
  | .sort _ => 40
  | .const _ _ => 50
  | .app _ _ => 60
  | .lam .. => 70
  | .forallE .. => 80
  | .letE .. => 90
  | .lit (.natVal n) => n + 100
  | .lit (.strVal _) => 200
  | .mdata _ e => exprKindScore e + 300
  | .proj _ idx _ => idx + 400

def sampleScore : Nat :=
  exprKindScore appExpr

def exprCoverageScore : Nat :=
  exprKindScore sortParamExpr
    + exprKindScore fvarExpr
    + exprKindScore mvarExpr
    + exprKindScore lambdaExpr
    + exprKindScore forallExpr
    + exprKindScore letExpr
    + exprKindScore stringLitExpr
    + exprKindScore mdataExpr
    + exprKindScore projExpr

def bumpBVar : Expr → Expr
  | .bvar idx => .bvar (idx + 1)
  | e => e

private def alphaLam (binderName : Name) (binderInfo : BinderInfo) : Expr :=
  .lam binderName (.sort .zero) (.app (.const `Nat.succ []) (.bvar 0)) binderInfo

private def nestedApp (arg : Nat) : Expr :=
  .app (.app (.const `Nat.add []) (.lit (.natVal 1))) (.lit (.natVal arg))

private def syntaxMData (atom : String) : MData :=
  MData.empty.setSyntax `source (.atom SourceInfo.none atom)

private def checkEqv (expected actual : Bool) (weight : Nat) : Nat :=
  if actual == expected then weight else 0

/--
Exercises the upstream `Lean.Expr.eqv` boundary, including alpha equivalence,
nested expressions, levels, literals, and metadata backed by `DataValue.ofSyntax`.
-/
def exprEqvScore : Nat :=
  checkEqv true (Expr.eqv (alphaLam `x .default) (alphaLam `y .implicit)) 1
    + checkEqv false
      (Expr.eqv (alphaLam `x .default) (.lam `y (.sort .zero) (.bvar 1) .implicit)) 2
    + checkEqv true (Expr.eqv (nestedApp 2) (nestedApp 2)) 4
    + checkEqv false (Expr.eqv (nestedApp 2) (nestedApp 3)) 8
    + checkEqv true
      (Expr.eqv (.const `Array [Level.succ (.param `u)])
        (.const `Array [Level.succ (.param `u)])) 16
    + checkEqv false
      (Expr.eqv (.const `Array [Level.succ (.param `u)])
        (.const `Array [Level.succ (.param `v)])) 32
    + checkEqv true
      (Expr.eqv (.mdata (syntaxMData "token") (.bvar 0))
        (.mdata (syntaxMData "token") (.bvar 0))) 64
    + checkEqv false
      (Expr.eqv (.mdata (syntaxMData "token") (.bvar 0))
        (.mdata (syntaxMData "other") (.bvar 0))) 128

/-- Exercises four small native boundaries selected by the runtime surface report. -/
unsafe def smallRuntimeFrontierScore : Nat :=
  let usizeOk := (USize.ofNat 513).toUInt64.toNat == 513
  let boolOk := (Bool.toUInt64 true).toNat == 1 && (Bool.toUInt64 false).toNat == 0
  let voidValue : Unit := unsafeCast (Void.mk ())
  let voidOk := match voidValue with | () => true
  let levelOk :=
    Level.beq (.succ (.param `u)) (.succ (.param `u)) &&
      !Level.beq (.succ (.param `u)) (.succ (.param `v))
  (if usizeOk then 1 else 0) +
    (if boolOk then 2 else 0) +
    (if voidOk then 4 else 0) +
    (if levelOk then 8 else 0)

/-- Exercises six primitives whose implementations are already linked into the VIR runtime. -/
def linkedPrimitiveFrontierScore : Nat :=
  let exprA := Expr.forallE `x (.sort .zero) (.bvar 0) .default
  let exprB := Expr.forallE `y (.sort .zero) (.bvar 0) .default
  let exprOk := Expr.equal exprA exprA && !Expr.equal exprA exprB
  let stringOk := String.Internal.get "é" ⟨0⟩ == 'é'
  let emodOk := (-12 : Int).emod 7 == 2
  let tmodOk := (-12 : Int).tmod 7 == -5
  let landOk := Nat.land 13 11 == 9
  let platformOk := System.Platform.getIsWindows () == false
  (if exprOk then 1 else 0) +
    (if stringOk then 2 else 0) +
    (if emodOk then 4 else 0) +
    (if tmodOk then 8 else 0) +
    (if landOk then 16 else 0) +
    (if platformOk then 32 else 0)

private def renderName : Name -> String
  | .anonymous => "_"
  | .str .anonymous s => s
  | .str p s => renderName p ++ "." ++ s
  | .num p n => renderName p ++ "." ++ toString n

private def renderLevel : Level -> String
  | .zero => "0"
  | .succ u => renderLevel u ++ "+1"
  | .max u v => "max " ++ renderLevel u ++ " " ++ renderLevel v
  | .imax u v => "imax " ++ renderLevel u ++ " " ++ renderLevel v
  | .param n => renderName n
  | .mvar n => "?" ++ renderName n.name

private def renderLevels : List Level -> String
  | [] => ""
  | [u] => renderLevel u
  | u :: us => renderLevel u ++ ", " ++ renderLevels us

private partial def renderExpr : Expr -> String
  | .bvar i => "#" ++ toString i
  | .fvar fvarId => "fvar " ++ renderName fvarId.name
  | .mvar mvarId => "?" ++ renderName mvarId.name
  | .sort u => "Sort " ++ renderLevel u
  | .const n [] => renderName n
  | .const n us => renderName n ++ ".{" ++ renderLevels us ++ "}"
  | .app f a => "(" ++ renderExpr f ++ " " ++ renderExpr a ++ ")"
  | .lam n t b _ =>
      "(fun " ++ renderName n ++ " : " ++ renderExpr t ++ " => " ++ renderExpr b ++ ")"
  | .forallE n t b _ =>
      "(forall " ++ renderName n ++ " : " ++ renderExpr t ++ ", " ++ renderExpr b ++ ")"
  | .letE n t v b _ =>
      "(let " ++ renderName n ++ " : " ++ renderExpr t ++ " := " ++ renderExpr v ++ "; " ++ renderExpr b ++ ")"
  | .lit (.natVal n) => toString n
  | .lit (.strVal s) => "\"" ++ s ++ "\""
  | .mdata _ e => renderExpr e
  | .proj typeName idx e => "(" ++ renderExpr e ++ ")." ++ renderName typeName ++ "." ++ toString idx

def minimalExpr : Expr :=
  .forallE `x (.sort (.succ .zero)) (mkApp (mkConst ``Nat.succ) (mkRawNatLit 41)) .default

def expectedMinimalExpr : String :=
  "(forall x : Sort 0+1, (Nat.succ 41))"

def minimalExprPrinterScore : Nat :=
  let rendered := renderExpr minimalExpr
  rendered.length + if rendered == expectedMinimalExpr then 1000 else 0

end Vir.Fixtures.ExprPrinter
