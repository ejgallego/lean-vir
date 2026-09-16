/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

module

public import Vir.React.Generated

/-!
Native React operations and small compositions over exact JavaScript values.
Native JSX notation lives in `Vir.ProofWidgets.Jsx`.
-/

public section

namespace Lean.Vir.React

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
def functionComponent
    (component : @& FunctionComponent props)
    (props : @& Lean.Vir.Js props)
    (children : @& Lean.Vir.Js.Array Node) :
    ReactM (Lean.Vir.Js Node) :=
  createElement (FunctionComponent.asElementType component) (componentProps props) children

end Node

end Lean.Vir.React
