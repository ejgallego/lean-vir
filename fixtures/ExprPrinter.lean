import Lean

namespace Vir.Fixtures.ExprPrinter

open Lean

def constNatExpr : Expr :=
  .const `Nat []

def twoLitExpr : Expr :=
  .lit (.natVal 2)

def appExpr : Expr :=
  .app (.const `Nat.succ []) twoLitExpr

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

def bumpBVar : Expr → Expr
  | .bvar idx => .bvar (idx + 1)
  | e => e

end Vir.Fixtures.ExprPrinter
