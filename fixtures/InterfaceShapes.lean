namespace Vir.Fixtures.InterfaceShapes

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

def interfaceShapeScore : Nat :=
  arrayStringTotalLength #["a", "bc"]
    + listUInt32Sum [1, 2, 3]
    + optionNatScore none
    + prodNatNatSum (4, 5)

end Vir.Fixtures.InterfaceShapes
