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

/-- Native JavaScript reducer function accepted by `React.useReducer`. -/
opaque Reducer (state action : Type) : Type

/-- React reducer dispatch function returned by `useReducer`. -/
opaque ReducerDispatch (state action : Type) : Type

/-- Exact JavaScript array returned by `React.useState`. -/
opaque StateTuple (α : Type) : Type

/-- Exact JavaScript array returned by `React.useReducer`. -/
opaque ReducerTuple (state action : Type) : Type

/-- Native JavaScript calculation function accepted by `React.useMemo`. -/
opaque MemoCalculation (α : Type) : Type

/-- Native JavaScript setup function accepted by `React.useEffect`. -/
opaque EffectCallback : Type

/-- Native unary JavaScript callback used by React and component props. -/
opaque Callback (α : Type) : Type

/-- Native React context object carrying JavaScript values of type `α`. -/
opaque Context (α : Type) : Type

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

/-- JavaScript-owned React hook dependency list. -/
opaque DependencyList : Type

/--
An explicitly identified React function component authored in Lean.

`id` supplies the React component-type identity for VIR's small Lean-component
adapter. Values with the same ID update one component type at a stable tree
position; changing the ID asks React to unmount the old type and mount a new
one. IDs should be declaration-stable constants, not values derived from props
or keys. The render function remains subject to the same hook and purity rules
as an ordinary TypeScript React component.
-/
structure Component (props : Type := Unit) where
  id : String
  render : props → ReactM (Lean.Vir.Js Node)

namespace Component

/-- Creates a Lean-authored React component with an explicit stable type ID. -/
def named (id : String) (render : props → ReactM (Lean.Vir.Js Node)) : Component props :=
  { id, render }

end Component

end Lean.Vir.React
