import Lean

namespace Vir.Fixtures.InterfaceShapes

open Lean

def arrayStringTotalLength (xs : Array String) : Nat :=
  xs.foldl (fun acc text => acc + text.length) 0

def listUInt32Sum (xs : List UInt32) : Nat :=
  xs.foldl (fun acc value => acc + value.toNat) 0

def optionNatBump : Option Nat → Option Nat
  | none => some 0
  | some value => some (value + 1)

def optionStringBang : Option String → Option String
  | none => some "empty"
  | some value => some (value ++ "!")

def optionNatScore : Option Nat → Nat
  | none => 7
  | some value => value + 11

def prodNatNatSwap (pair : Prod Nat Nat) : Prod Nat Nat :=
  (pair.snd, pair.fst)

def prodNatNatSum (pair : Prod Nat Nat) : Nat :=
  pair.fst + pair.snd

def optionArrayNatSum : Option (Array Nat) → Nat
  | none => 0
  | some values => values.foldl (· + ·) 0

def listProdNatStringScore (xs : List (Nat × String)) : Nat :=
  xs.foldl (fun acc pair => acc + pair.fst + pair.snd.length) 0

def prodStringNatSwap (pair : String × Nat) : Nat × String :=
  (pair.snd + 1, pair.fst ++ "!")

def arrayExprKindScore (xs : Array Expr) : Nat :=
  xs.foldl (fun acc expr =>
    acc +
      match expr with
      | .bvar idx => idx + 1
      | .const .. => 10
      | .lit (.natVal n) => n + 20
      | _ => 100) 0

def optionExprBump : Option Expr → Option Expr
  | none => some (.bvar 0)
  | some (.bvar idx) => some (.bvar (idx + 1))
  | some expr => some expr

def interfaceShapeScore : Nat :=
  arrayStringTotalLength #["a", "bc"]
    + listUInt32Sum [1, 2, 3]
    + optionNatScore none
    + prodNatNatSum (4, 5)
    + optionArrayNatSum (some #[1, 2, 3])
    + listProdNatStringScore [(4, "ab"), (5, "c")]
    + arrayExprKindScore #[.const `Nat [], .bvar 2]

end Vir.Fixtures.InterfaceShapes
