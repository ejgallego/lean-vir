/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Lean.Vir.React

namespace ReactCounter

def label (value : Nat) : String :=
  "react:" ++ toString value

partial def renderInto (root : Lean.Vir.React.Root) (value : Nat) : IO Unit := do
  Lean.Vir.React.Root.render root <|
    .element "button" none
      #[
        Lean.Vir.React.Property.string "id" "react-counter-button",
        Lean.Vir.React.Property.string "type" "button"
      ]
      #[Lean.Vir.React.EventHandler.mkClick (renderInto root (value + 1))]
      #[.text (label value)]

def mount (selector : String) : IO Nat := do
  match ← Lean.Vir.Browser.Document.querySelector selector with
  | none => pure 0
  | some container =>
      let root ← Lean.Vir.React.Root.create container
      renderInto root 0
      pure 1

def mountDefault : IO Nat :=
  mount "#react-counter-root"

def staticTree : Lean.Vir.React.Html :=
  .element "span" none
    #[Lean.Vir.React.Property.string "id" "react-static-label"]
    #[]
    #[.text "react:static"]

def renderStatic (selector : String) : IO Nat := do
  match ← Lean.Vir.Browser.Document.querySelector selector with
  | none => pure 0
  | some container =>
      let root ← Lean.Vir.React.Root.create container
      Lean.Vir.React.Root.render root staticTree
      pure 1

def mountAndUnmount (selector : String) : IO Nat := do
  match ← Lean.Vir.Browser.Document.querySelector selector with
  | none => pure 0
  | some container =>
      let root ← Lean.Vir.React.Root.create container
      renderInto root 0
      Lean.Vir.React.Root.unmount root
      pure 1

def renderAfterUnmount (selector : String) : IO Nat := do
  match ← Lean.Vir.Browser.Document.querySelector selector with
  | none => pure 0
  | some container =>
      let root ← Lean.Vir.React.Root.create container
      Lean.Vir.React.Root.unmount root
      renderInto root 0
      pure 1

def nestedDivs (depth : Nat) : Lean.Vir.React.Html :=
  match depth with
  | 0 => .text "deep"
  | n + 1 => .element "div" none #[] #[] #[nestedDivs n]

def renderTooDeep (selector : String) : IO Nat := do
  match ← Lean.Vir.Browser.Document.querySelector selector with
  | none => pure 0
  | some container =>
      let root ← Lean.Vir.React.Root.create container
      Lean.Vir.React.Root.render root (nestedDivs 129)
      pure 1

end ReactCounter
