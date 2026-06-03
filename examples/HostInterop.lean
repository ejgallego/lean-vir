/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Lean.Vir.Browser

namespace HostInterop

@[vir_js "test.callNatCallback"]
opaque callNatCallback (input : Nat) (callback : Nat → Nat) : Nat

@[vir_js "test.recordNat"]
opaque recordNat (value : Nat) : IO Unit

def titleHandshake (label : String) : IO String := do
  let title := "Lean VIR host: " ++ label
  Lean.Vir.Browser.Document.setTitle title
  Lean.Vir.Browser.Document.getTitle

def callbackRoundTrip (n : Nat) : Nat :=
  callNatCallback n fun value => value + 7

def mountCallbackEvent (selector : String) : IO Nat := do
  match ← Lean.Vir.Browser.Document.querySelector selector with
  | some element =>
      let _ ← Lean.Vir.Browser.Element.addEventListener element "click" fun _ => do
        recordNat 101
      pure 1
  | none => pure 0

def mountAndRemoveCallbackEvent (selector : String) : IO Nat := do
  match ← Lean.Vir.Browser.Document.querySelector selector with
  | some element =>
      let listener ← Lean.Vir.Browser.Element.addEventListener element "click" fun _ => do
        recordNat 102
      Lean.Vir.Browser.Element.removeEventListener listener
      pure 1
  | none => pure 0

def mountCallbackText (selector : String) : IO Nat := do
  match ← Lean.Vir.Browser.Document.querySelector selector with
  | some element =>
      let _ ← Lean.Vir.Browser.Element.addEventListener element "click" fun _ => do
        Lean.Vir.Browser.Element.setTextContent element "callback:clicked"
      pure 1
  | none => pure 0

def mountAndRemoveCallbackText (selector : String) : IO Nat := do
  match ← Lean.Vir.Browser.Document.querySelector selector with
  | some element =>
      let listener ← Lean.Vir.Browser.Element.addEventListener element "click" fun _ => do
        Lean.Vir.Browser.Element.setTextContent element "callback:removed-fired"
      Lean.Vir.Browser.Element.removeEventListener listener
      pure 1
  | none => pure 0

def timeoutRecord (value : Nat) : IO Nat := do
  let _ ← Lean.Vir.Browser.Timer.setTimeout 0 do
    recordNat (value + 1)
  pure 1

def timeoutTitle (label : String) : IO Nat := do
  let _ ← Lean.Vir.Browser.Timer.setTimeout 0 do
    Lean.Vir.Browser.Document.setTitle ("timeout:" ++ label)
  pure 1

def delayedTimeoutTitle (label : String) : IO Nat := do
  let _ ← Lean.Vir.Browser.Timer.setTimeout 80 do
    Lean.Vir.Browser.Document.setTitle ("timeout:" ++ label)
  pure 1

def clearTimeoutTitle (label : String) : IO Nat := do
  let timeout ← Lean.Vir.Browser.Timer.setTimeout 20 do
    Lean.Vir.Browser.Document.setTitle ("timeout:" ++ label)
  Lean.Vir.Browser.Timer.clearTimeout timeout
  pure 1

def clearTimeoutRecord (value : Nat) : IO Nat := do
  let timeout ← Lean.Vir.Browser.Timer.setTimeout 20 do
    recordNat (value + 10)
  Lean.Vir.Browser.Timer.clearTimeout timeout
  pure 1

def timeoutLoop : Nat → IO Unit
  | 0 => recordNat 0
  | n + 1 => do
      recordNat (n + 1)
      let _ ← Lean.Vir.Browser.Timer.setTimeout 0 (timeoutLoop n)
      pure ()

def startTimeoutLoop (count : Nat) : IO Nat := do
  let _ ← Lean.Vir.Browser.Timer.setTimeout 0 (timeoutLoop count)
  pure 1

def animationRecord (value : Nat) : IO Nat := do
  let _ ← Lean.Vir.Browser.Animation.requestAnimationFrame fun _ => do
    recordNat (value + 2)
  pure 1

def animationTitle (label : String) : IO Nat := do
  let _ ← Lean.Vir.Browser.Animation.requestAnimationFrame fun _ => do
    Lean.Vir.Browser.Document.setTitle ("frame:" ++ label)
  pure 1

def cancelAnimationTitle (label : String) : IO Nat := do
  let frame ← Lean.Vir.Browser.Animation.requestAnimationFrame fun _ => do
    Lean.Vir.Browser.Document.setTitle ("frame:" ++ label)
  Lean.Vir.Browser.Animation.cancelAnimationFrame frame
  pure 1

def cancelAnimationRecord (value : Nat) : IO Nat := do
  let frame ← Lean.Vir.Browser.Animation.requestAnimationFrame fun _ => do
    recordNat (value + 20)
  Lean.Vir.Browser.Animation.cancelAnimationFrame frame
  pure 1

def animationLoop : Nat → Float → IO Unit
  | 0, _ => recordNat 0
  | n + 1, _ => do
      recordNat (n + 1)
      let _ ← Lean.Vir.Browser.Animation.requestAnimationFrame (animationLoop n)
      pure ()

def startAnimationLoop (count : Nat) : IO Nat := do
  let _ ← Lean.Vir.Browser.Animation.requestAnimationFrame (animationLoop count)
  pure 1

end HostInterop
