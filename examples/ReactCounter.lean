/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Lean.Vir.React

namespace ReactCounter

open Lean.Vir.React

def label (value : Nat) : String :=
  "react:" ++ toString value

partial def renderInto (root : Root) (value : Nat) : IO Unit := do
  Root.render root <|
    Html.buttonWith
      #[Property.id "react-counter-button"]
      #[EventHandler.onClick (renderInto root (value + 1))]
      #[.text (label value)]

def mount (selector : String) : IO Bool :=
  Root.mountFromSelector selector fun root => renderInto root 0

def mountDefault : IO Bool :=
  mount "#react-counter-root"

def staticTree : Html :=
  Html.spanWith #[Property.id "react-static-label"] #[] #[.text "react:static"]

def renderStatic (selector : String) : IO Bool :=
  Root.mountFromSelector selector fun root => Root.render root staticTree

def mountAndUnmount (selector : String) : IO Bool :=
  Root.mountFromSelector selector fun root => do
    renderInto root 0
    Root.unmount root

partial def mountAndUnmountLoopAux (selector : String) (remaining acc : Nat) : IO Nat := do
  match remaining with
  | 0 => pure acc
  | n + 1 => do
      let mounted ← mountAndUnmount selector
      mountAndUnmountLoopAux selector n (if mounted then acc + 1 else acc)

def mountAndUnmountLoop (selector : String) (count : Nat) : IO Nat :=
  mountAndUnmountLoopAux selector count 0

def renderAfterUnmount (selector : String) : IO Bool :=
  Root.mountFromSelector selector fun root => do
    Root.unmount root
    renderInto root 0

def nestedDivs (depth : Nat) : Html :=
  match depth with
  | 0 => .text "deep"
  | n + 1 => Html.div #[nestedDivs n]

def renderTooDeep (selector : String) : IO Bool :=
  Root.mountFromSelector selector fun root => Root.render root (nestedDivs 129)

end ReactCounter
