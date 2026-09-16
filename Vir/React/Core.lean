/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.React.Generated
import all Vir.React.Generated

/-!
Native React operations and small compositions over exact JavaScript values.
Native JSX notation lives in `Vir.ProofWidgets.Jsx`.
-/

public section

namespace Lean.Vir.React

-- Keep generated private-import references in this module: downstream inlining
-- (including automatic alias inlining) loses their private declaration metadata.
/-- Passes the exact native value or initializer to React. When no state type
is supplied, infer one initializer result layer before the value shape. -/
@[noinline] def Hooks.useState {α β : Type} [Initial.Accepts β α]
    (initial : @& Lean.Vir.Js β) : ReactM (Lean.Vir.Js (StateTuple α)) :=
  useStateNative (Initial.ofJs initial)

/-- Renders an exact native node shape, without wrapping or traversing it. -/
@[noinline] def Root.render [Node.Shape α] (root : @& Lean.Vir.Js Root)
    (children : @& Lean.Vir.Js α) : Lean.Vir.Browser.DomM Unit :=
  renderNative root (Node.ofJs children)

namespace ElementType

/-- Views the exact native string as an element type, without a host call. -/
@[inline] def tag (tag : @& Lean.Vir.Js String) : ReactM (Lean.Vir.Js ElementType) := by
  unfold Lean.Vir.Js at *
  exact pure tag

end ElementType

/-- Creates a native function component from a Lean render callback. -/
def FunctionComponent.ofLean
    (render : Lean.Vir.Js props → ReactM (Lean.Vir.Js Node)) :
    Lean.Vir.RuntimeM (FunctionComponent props) :=
  Lean.Vir.Js.Function.ofLean render

namespace Node

@[inline] private def nodeChildren [Shape α]
    (children : @& Lean.Vir.Js.Array α) : Lean.Vir.Js.Array Node := by
  unfold Lean.Vir.Js.Array Lean.Vir.Js at *
  exact children

/-- Native createElement with a child array of supported node shapes. -/
@[noinline] def createElement [Shape α]
    (elementType : @& Lean.Vir.Js ElementType) (props : @& Lean.Vir.Js Props)
    (children : @& Lean.Vir.Js.Array α) : ReactM (Lean.Vir.Js Node) :=
  createElementNative elementType props (nodeChildren children)

/-- Native Fragment with a child array of supported node shapes. -/
@[noinline] def fragment [Shape α] (props : @& Lean.Vir.Js Props)
    (children : @& Lean.Vir.Js.Array α) : ReactM (Lean.Vir.Js Node) :=
  fragmentNative props (nodeChildren children)

/-- Views the exact native string as a text node, without a host call. -/
@[inline] def text (value : @& Lean.Vir.Js String) : ReactM (Lean.Vir.Js Node) :=
  pure (ofJs value)

@[inline] private def componentProps {α : Type}
    (props : Lean.Vir.Js α) : Lean.Vir.Js Props := by
  unfold Lean.Vir.Js at *
  exact props

/--
Builds an element from a native function component and its native props.
The function and its matching native props are passed directly to React.
-/
def functionComponent [Shape α]
    (component : @& FunctionComponent props)
    (props : @& Lean.Vir.Js props)
    (children : @& Lean.Vir.Js.Array α) :
    ReactM (Lean.Vir.Js Node) :=
  createElement (FunctionComponent.asElementType component) (componentProps props) children

end Node

end Lean.Vir.React
