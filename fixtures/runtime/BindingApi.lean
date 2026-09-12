/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/
module

public import Vir.React

open Lean.Vir
open Lean.Vir.Browser

-- The short names preserve the native value boundary, not Lean conversions.
example (console : Js Console) (message : Js String) : RuntimeM Unit :=
  Console.log console message

example (ctx : Js CanvasRenderingContext2D) (x y width height : Js Float) : DomM Unit :=
  CanvasRenderingContext2D.fillRect ctx x y width height

example (callback : DomM Unit) (delay : Js Float) : DomM (Js Timeout) :=
  Timer.setTimeout callback delay

example (array : Js.Array α) (index : Js Float) : RuntimeM (Js α) :=
  Js.Array.get array index

example (setup : Js React.EffectCallback) : React.ReactM Unit := do
  React.Hooks.useEffect setup (← Js.UndefinedOr.undefined)

example (setup : Js React.EffectCallback) (deps : Js React.DependencyList) : React.ReactM Unit :=
  React.Hooks.useEffect setup (Js.UndefinedOr.ofJs deps)

-- Removed arity implementations and conversion wrappers stay absent.
example : True := by
  fail_if_success have _ := Lean.Vir.React.Hooks.useEffectWithoutDeps
  fail_if_success have _ := Lean.Vir.React.Hooks.useEffectWithDeps
  fail_if_success have _ := Lean.Vir.Browser.CanvasRenderingContext2D.fillRectJs
  fail_if_success have _ := Lean.Vir.Browser.Document.querySelectorString
  fail_if_success have _ := Lean.Vir.React.Hooks.useLeanEffect
  trivial

example (_setup : Js React.EffectCallback) (_deps : Js React.DependencyList)
    (_null : Js.Nullable React.DependencyList) : True := by
  fail_if_success have _ := React.Hooks.useEffect _setup (some _deps)
  fail_if_success have _ := React.Hooks.useEffect _setup (none : Option (Js React.DependencyList))
  fail_if_success have _ := React.Hooks.useEffect _setup (Js.erase _deps)
  fail_if_success have _ := React.Hooks.useEffect _setup _null
  trivial

open scoped Lean.Vir.Js in
example : RuntimeM (Js String) := js#"native string"

example (_console : Js Console) (_message : String) : True := by
  fail_if_success have _ := Console.log _console _message
  trivial

example (_ctx : Js CanvasRenderingContext2D) (_x _y _width _height : Float) : True := by
  fail_if_success have _ := CanvasRenderingContext2D.fillRect _ctx _x _y _width _height
  trivial
