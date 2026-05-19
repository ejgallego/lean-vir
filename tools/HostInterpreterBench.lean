set_option interpreter.prefer_native false

namespace HostInterpreterBench

def fib : Nat -> Nat
  | 0 => 0
  | 1 => 1
  | n + 2 => fib n + fib (n + 1)

def split : List Nat -> List Nat × List Nat
  | [] => ([], [])
  | [x] => ([x], [])
  | x :: y :: rest =>
      let halves := split rest
      (x :: halves.1, y :: halves.2)

def merge : List Nat -> List Nat -> List Nat
  | [], ys => ys
  | xs, [] => xs
  | x :: xs, y :: ys =>
      if x <= y then
        x :: merge xs (y :: ys)
      else
        y :: merge (x :: xs) ys

def mergeSortFuel : Nat -> List Nat -> List Nat
  | 0, xs => xs
  | _ + 1, [] => []
  | _ + 1, [x] => [x]
  | fuel + 1, xs =>
      let halves := split xs
      merge (mergeSortFuel fuel halves.1) (mergeSortFuel fuel halves.2)

def sortedFromArray (input : Array Nat) : List Nat :=
  mergeSortFuel 32 input.toList

def checksumAux : Nat -> List Nat -> Nat
  | _, [] => 0
  | weight, x :: xs => weight * x + checksumAux (weight + 1) xs

def sortChecksum (input : Array Nat) : Nat :=
  checksumAux 1 (sortedFromArray input)

def repeatFib : Nat -> Nat -> Nat
  | 0, _ => 0
  | n + 1, input => fib input + repeatFib n input

def repeatSort : Nat -> Array Nat -> Nat
  | 0, _ => 0
  | n + 1, input => sortChecksum input + repeatSort n input

def parseNat! (text : String) : Nat :=
  match text.toNat? with
  | some n => n
  | none => panic! s!"expected Nat, got `{text}`"

def parseArray (text : String) : Array Nat :=
  text.splitOn ","
    |>.filterMap (fun part =>
      let trimmed := part.trimAscii.toString
      if trimmed.isEmpty then none else some (parseNat! trimmed))
    |>.toArray

def measure (label : String) (iterations : Nat) (run : Unit -> Nat) : IO Unit := do
  let sink ← IO.mkRef 0
  for _ in [0:7] do
    let start ← IO.monoNanosNow
    sink.set (run ())
    let stop ← IO.monoNanosNow
    let checksum ← sink.get
    IO.println s!"host-ir {label} {iterations} {checksum} {stop - start}"

def main (args : List String) : IO UInt32 := do
  match args with
  | ["fib", iterations, input] =>
      let iterations := parseNat! iterations
      let input := parseNat! input
      measure "fib" iterations fun _ => repeatFib iterations input
      return 0
  | ["sort", iterations, input] =>
      let iterations := parseNat! iterations
      let input := parseArray input
      measure "sort" iterations fun _ => repeatSort iterations input
      return 0
  | _ =>
      IO.eprintln "usage: host-interpreter-bench <fib|sort> <iterations> <input>"
      return 2

end HostInterpreterBench

def main (args : List String) : IO UInt32 :=
  HostInterpreterBench.main args
