/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.Browser

namespace Lean.Vir.React

/-- Effect used by Lean-authored React render construction. -/
@[irreducible] def ReactM (α : Type) : Type :=
  Lean.Vir.RuntimeM α

namespace ReactM

/-- Explicitly lowers a render-construction action at a browser/DOM boundary. -/
def run (action : ReactM α) : Lean.Vir.Browser.DomM α :=
  by
    unfold ReactM at action
    unfold Lean.Vir.Browser.DomM
    exact action

instance : Monad ReactM where
  pure value :=
    by
      unfold ReactM
      exact pure value
  bind action next :=
    by
      unfold ReactM at action
      unfold ReactM
      exact action >>= fun value => by
        unfold ReactM at next
        exact next value

instance : MonadLift Lean.Vir.RuntimeM ReactM where
  monadLift action :=
    by
      unfold ReactM
      exact action

instance : MonadLift ReactM Lean.Vir.Browser.DomM where
  monadLift := ReactM.run

instance : Nonempty (ReactM α) :=
  by
    unfold ReactM
    infer_instance

end ReactM

/-- React root object class created from a browser container element. -/
opaque Root : Type

/-- React element type accepted by `React.createElement`. -/
opaque ElementType : Type

/-- React state setter function returned by `useState`. -/
opaque StateSetter (α : Type) : Type

/-- React reducer dispatch function returned by `useReducer`. -/
opaque ReducerDispatch (state action : Type) : Type

/-- React ref object returned by `useRef`. -/
opaque Ref (α : Type) : Type

/-- Marker for a JavaScript-owned React props object. -/
opaque Props : Type

/-- A single React `style` object entry. Use camelCase property names. -/
structure StyleProperty where
  name : String
  value : String

/-- Conservative set of React property values supported by the host protocol. -/
inductive PropValue where
  | string (value : String)
  | bool (value : Bool)
  | int (value : Int)
  | float (value : Float)
  | style (entries : Array StyleProperty)
  | classList (classes : Array String)

/-- A non-event React property. -/
structure Property where
  name : String
  value : PropValue

/-- A DOM-like React event handler containing an ordinary Lean-backed JavaScript callback. -/
structure EventHandler where
  name : String
  callback : Lean.Vir.Js Lean.Vir.Browser.Event → Lean.Vir.Browser.DomM Unit

namespace Props

/-- One public React props entry. -/
inductive Entry where
  | key (value : String)
  | ref {α : Type} (value : Lean.Vir.Js (Ref (Lean.Vir.Js α)))
  | property (value : Property)
  | eventHandler (value : EventHandler)

end Props

/-- React state value and setter returned by `useState`. -/
structure State (α : Type) where
  value : α
  setter : Lean.Vir.Js (StateSetter α)

/-- React reducer value and dispatch function returned by `useReducer`. -/
structure ReducerState (state action : Type) where
  value : Lean.Vir.Js state
  dispatch : Lean.Vir.Js (ReducerDispatch state action)

/-- React node object created by the JavaScript host through React's public API. -/
opaque Node : Type

/-- JavaScript-owned React child list. -/
opaque NodeChildren : Type

/-- JavaScript-owned React hook dependency list. -/
opaque DependencyList : Type

/-- A React function component authored in Lean. -/
abbrev Component (props : Type := Unit) : Type :=
  props → ReactM (Lean.Vir.Js Node)

end Lean.Vir.React
