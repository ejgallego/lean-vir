/-
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
-/

import Vir.React

namespace Lean.Vir.TypeAnchors

/-!
This module is not application code. It is a small descriptor-forcing surface
used by `scripts/generate-lean-type-anchor-manifest.mjs`.

Each exported wrapper keeps one real `Vir.React` type visible to the package
manifest. Future generated React bindings should be able to replace or extend
this hand-curated anchor source with generated wrappers.
-/

def reactStylePropertyIdentity
    (value : Lean.Vir.React.StyleProperty) :
    Lean.Vir.React.StyleProperty :=
  value

def reactPropValueIdentity
    (value : Lean.Vir.React.PropValue) :
    Lean.Vir.React.PropValue :=
  value

def reactPropertyIdentity
    (value : Lean.Vir.React.Property) :
    Lean.Vir.React.Property :=
  value

def reactEventHandlerIdentity
    (value : Lean.Vir.React.EventHandler) :
    Lean.Vir.React.EventHandler :=
  value

def browserEventIdentity
    (value : Lean.Vir.Js Lean.Vir.Browser.Event) :
    Lean.Vir.Js Lean.Vir.Browser.Event :=
  value

def reactNodeIdentity
    (value : Lean.Vir.Js Lean.Vir.React.Node) :
    Lean.Vir.Js Lean.Vir.React.Node :=
  value

def reactElementTypeIdentity
    (value : Lean.Vir.Js Lean.Vir.React.ElementType) :
    Lean.Vir.Js Lean.Vir.React.ElementType :=
  value

def reactPropsIdentity
    (value : Lean.Vir.Js Lean.Vir.React.Props) :
    Lean.Vir.Js Lean.Vir.React.Props :=
  value

def reactNodeChildrenIdentity
    (value : Lean.Vir.Js Lean.Vir.React.NodeChildren) :
    Lean.Vir.Js Lean.Vir.React.NodeChildren :=
  value

def reactDependencyListIdentity
    (value : Lean.Vir.Js Lean.Vir.React.DependencyList) :
    Lean.Vir.Js Lean.Vir.React.DependencyList :=
  value

def reactRefIdentity
    (value : Lean.Vir.Js (Lean.Vir.React.Ref (Lean.Vir.Js String))) :
    Lean.Vir.Js (Lean.Vir.React.Ref (Lean.Vir.Js String)) :=
  value

def reactStateIdentity
    (value : Lean.Vir.React.State (Lean.Vir.Js String)) :
    Lean.Vir.React.State (Lean.Vir.Js String) :=
  value

def reactStateSetterIdentity
    (value : Lean.Vir.Js (Lean.Vir.React.StateSetter (Lean.Vir.Js String))) :
    Lean.Vir.Js (Lean.Vir.React.StateSetter (Lean.Vir.Js String)) :=
  value

def reactReducerStateIdentity
    (value : Lean.Vir.React.ReducerState String String) :
    Lean.Vir.React.ReducerState String String :=
  value

def reactReducerDispatchIdentity
    (value : Lean.Vir.Js (Lean.Vir.React.ReducerDispatch String String)) :
    Lean.Vir.Js (Lean.Vir.React.ReducerDispatch String String) :=
  value

def reactComponentCall
    (component : Lean.Vir.React.Component Unit) :
    Lean.Vir.React.ReactM (Lean.Vir.Js Lean.Vir.React.Node) :=
  component ()

def reactRootIdentity
    (value : Lean.Vir.Js Lean.Vir.React.Root) :
    Lean.Vir.Js Lean.Vir.React.Root :=
  value

def reactRootCreateCall
    (container : Lean.Vir.Js Lean.Vir.Browser.Element) :
    Lean.Vir.Browser.DomM (Lean.Vir.Js Lean.Vir.React.Root) :=
  Lean.Vir.React.Root.create container

def reactRootRenderCall
    (root : Lean.Vir.Js Lean.Vir.React.Root)
    (node : Lean.Vir.React.ReactM (Lean.Vir.Js Lean.Vir.React.Node)) :
    Lean.Vir.Browser.DomM Unit :=
  Lean.Vir.React.Root.render root node

def reactRootUnmountCall
    (root : Lean.Vir.Js Lean.Vir.React.Root) :
    Lean.Vir.Browser.DomM Unit :=
  Lean.Vir.React.Root.unmount root

end Lean.Vir.TypeAnchors
