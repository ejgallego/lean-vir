module

meta import Vir.Attributes
public import Vir.Js

public section
open Lean.Vir
namespace ManagedCore

def build (count : Nat) : Array Nat := (List.range count).toArray
def advance (values : Array Nat) (delta : Nat) : Array Nat :=
  values.map fun value => value + delta
def summarize (values : Array Nat) : String :=
  toString values.size ++ ":" ++ toString (values.foldl (fun sum value => sum + value) 0)

@[vir_export] def buildPlain (count : Nat) : Array Nat := build count

@[vir_export] def buildHeld (count : Nat) : RuntimeM (JSL (Array Nat)) :=
  LeanRef.toJSL (build count)
@[vir_export] def advanceHeld (held : JSL (Array Nat)) (delta : Nat)
    : RuntimeM (JSL (Array Nat)) := do
  let values ← LeanRef.fromJSL held
  LeanRef.toJSL (advance values delta)
@[vir_export] def summarizeHeld (held : JSL (Array Nat)) : RuntimeM String := do
  let values ← LeanRef.fromJSL held
  pure (summarize values)

@[vir_export] def makeSummaryHeld (held : JSL (Array Nat))
    : RuntimeM (JSL (Unit → String)) := do
  let values ← LeanRef.fromJSL held
  LeanRef.toJSL (fun () => summarize values)
@[vir_export] def invokeSummaryHeld (held : JSL (Unit → String)) : RuntimeM String := do
  let summarizeLater ← LeanRef.fromJSL held
  pure (summarizeLater ())

@[vir_js "managedCore.reenter"] opaque reenter : RuntimeM Unit
@[vir_export] def makeReentrantHeld (held : JSL (Array Nat))
    : RuntimeM (JSL (Unit → RuntimeM String)) := do
  let values ← LeanRef.fromJSL held
  LeanRef.toJSL (fun () => do
    reenter
    pure (summarize values))
@[vir_export] def invokeReentrantHeld (held : JSL (Unit → RuntimeM String))
    : RuntimeM String := do
  let invokeLater ← LeanRef.fromJSL held
  invokeLater ()

@[vir_js "managedCore.pureFailure"] opaque pureFailure (value : Js.Any) : Js.Any := value
@[vir_export] def triggerTrap (value : Js.Any) : Js.Any := pureFailure value

end ManagedCore
