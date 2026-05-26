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

end Vir.Fixtures.ExprPrinter
